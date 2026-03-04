import { app, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode, RemoteAccessInfo, RepoHookConfig, Tab, ProjectConfig } from '@shared/types';
import { PERMISSION_FLAGS } from '@shared/types';
import { WorktreeManager } from './worktree-manager';
import { HookInstaller } from './hook-installer';
import { ProjectManager, type ProjectContext } from './project-manager';
import type { TabManager } from './tab-manager';
import type { PtyManager } from './pty-manager';
import type { SettingsStore } from './settings-store';
import type { WorkspaceStore } from './workspace-store';
import { log } from './logger';

export interface AppState {
  // New: multi-project workspace support
  workspaceId: string | null;
  projectManager: ProjectManager | null;

  // Legacy convenience accessors (point to active project or first project)
  workspaceDir: string | null;
  worktreeManager: WorktreeManager | null;
  hookInstaller: HookInstaller | null;
  hookConfigStore: import('./hook-config-store').HookConfigStore | null;
  hookEngine: import('./hook-engine').HookEngine | null;

  permissionMode: PermissionMode;
  mainWindow: { setTitle: (title: string) => void } | null;
  cliStartDir: string | null;
  pipeName: string;
}

export type WirePtyToTabFn = (
  proc: { pid: number; onData: (cb: (data: string) => void) => void; onExit: (cb: () => void) => void },
  tab: Tab,
  cwd: string,
  opts?: { alwaysActivate?: boolean },
) => void;

export interface IpcHandlerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  settings: SettingsStore;
  workspaceStore: WorkspaceStore;
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  cleanupNamingFlag: (tabId: string) => void;
  clearPendingNotification: (tabId: string) => void;
  activateRemoteAccess: () => Promise<RemoteAccessInfo>;
  deactivateRemoteAccess: () => Promise<void>;
  getRemoteAccessInfo: () => RemoteAccessInfo;
}

/** Resolve hooksDir based on dev/production mode */
function resolveHooksDir(): string {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), '..', 'hooks')
    : path.join(__dirname, '..', '..', 'src', 'hooks');
}

export function registerIpcHandlers(deps: IpcHandlerDeps): { cleanup: () => void; wirePtyToTab: WirePtyToTabFn } {
  const { tabManager, ptyManager, settings, workspaceStore, state } = deps;

  // Per-tab flow control state for PTY data buffering
  const MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB cap per tab
  const flowControl = new Map<string, { paused: boolean; buffer: string[]; bufferBytes: number }>();

  /** Wire a spawned PTY process to a tab: flow control, exit cleanup, activation, hooks. */
  function wirePtyToTab(
    proc: { pid: number; onData: (cb: (data: string) => void) => void; onExit: (cb: () => void) => void },
    tab: Tab,
    cwd: string,
    opts?: { alwaysActivate?: boolean },
  ): void {
    tab.pid = proc.pid;
    flowControl.set(tab.id, { paused: false, buffer: [], bufferBytes: 0 });

    proc.onData((data: string) => {
      const fc = flowControl.get(tab.id);
      if (fc?.paused) {
        fc.buffer.push(data);
        fc.bufferBytes += data.length;
        while (fc.bufferBytes > MAX_BUFFER_BYTES && fc.buffer.length > 0) {
          fc.bufferBytes -= fc.buffer.shift()!.length;
        }
      } else {
        deps.sendToRenderer('pty:data', tab.id, data);
      }
    });

    proc.onExit(() => {
      flowControl.delete(tab.id);
      if (tabManager.getTab(tab.id)) {
        deps.cleanupNamingFlag(tab.id);
        tabManager.removeTab(tab.id);
        deps.sendToRenderer('tab:removed', tab.id);
        deps.persistSessions();
      }
    });

    if (opts?.alwaysActivate || tabManager.getAllTabs().length === 1) {
      tabManager.setActiveTab(tab.id);
    }

    deps.sendToRenderer('tab:updated', tab);
    deps.persistSessions();

    // Emit tab:created hook via project context
    const project = tab.projectId ? state.projectManager?.getProject(tab.projectId) : null;
    const hookEngine = project?.hookEngine ?? state.hookEngine;
    if (hookEngine) {
      hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: tab.type });
    }
  }

  // Git HEAD watchers — one per project
  const gitHeadWatchers = new Map<string, { watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();

  function setupGitHeadWatcher(projectId: string, dir: string, worktreeManager: WorktreeManager, hookEngine: import('./hook-engine').HookEngine | null) {
    // Clean up existing watcher for this project
    const existing = gitHeadWatchers.get(projectId);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.watcher.close();
      gitHeadWatchers.delete(projectId);
    }

    let lastKnownBranch = '';
    worktreeManager.getCurrentBranch().then(b => { lastKnownBranch = b; }).catch(() => {});

    const gitHeadPath = path.join(dir, '.git', 'HEAD');
    if (!fs.existsSync(gitHeadPath)) return;

    const entry: { watcher: fs.FSWatcher; timer: ReturnType<typeof setTimeout> | null } = {
      watcher: null!,
      timer: null,
    };
    entry.watcher = fs.watch(gitHeadPath, () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(async () => {
        try {
          const branch = await worktreeManager.getCurrentBranch();
          deps.sendToRenderer('git:branchChanged', branch, projectId);
          if (branch && hookEngine) {
            hookEngine.emit('branch:changed', { contextRoot: dir, from: lastKnownBranch, to: branch });
            lastKnownBranch = branch;
          }
        } catch { /* not a git repo or git error */ }
      }, 1000);
    });
    entry.watcher.on('error', () => { /* ignore watch errors */ });
    gitHeadWatchers.set(projectId, entry);
  }

  // ---- Workspace / Project ----
  ipcMain.handle('workspace:init', async (_event, mode: PermissionMode) => {
    state.permissionMode = mode;
    await settings.setPermissionMode(mode);

    const hooksDir = resolveHooksDir();
    log.debug('[workspace:init] hooksDir:', hooksDir);

    state.projectManager = new ProjectManager(hooksDir, (status) => {
      deps.sendToRenderer('hook:status', status);
    });

    state.workspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return state.workspaceId;
  });

  ipcMain.handle('project:add', async (_event, dir: string, id?: string, colorIndex?: number) => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`Invalid project directory: ${dir}`);
    }
    if (!state.projectManager) {
      // Auto-init if not already initialized (backward compat)
      const hooksDir = resolveHooksDir();
      state.projectManager = new ProjectManager(hooksDir, (status) => {
        deps.sendToRenderer('hook:status', status);
      });
      state.workspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const ctx = state.projectManager.addProject(dir, id, colorIndex);
    log.init(dir);

    // Install hooks
    ctx.hookInstaller.install(dir);

    // Set up git HEAD watcher
    if (ctx.worktreeManager) {
      setupGitHeadWatcher(ctx.id, dir, ctx.worktreeManager, ctx.hookEngine);
    }

    // Emit app:started hook
    ctx.hookEngine.emit('app:started', { contextRoot: dir, cwd: dir });

    // Keep legacy fields pointed at the first (or newly added) project
    state.workspaceDir = ctx.dir;
    state.worktreeManager = ctx.worktreeManager;
    state.hookInstaller = ctx.hookInstaller;
    state.hookConfigStore = ctx.hookConfigStore;
    state.hookEngine = ctx.hookEngine;

    await settings.addRecentDir(dir);

    const config: ProjectConfig = { id: ctx.id, dir: ctx.dir, colorIndex: ctx.colorIndex };
    deps.sendToRenderer('project:added', config);
    return config;
  });

  ipcMain.handle('project:remove', async (_event, projectId: string) => {
    if (!state.projectManager) throw new Error('No workspace initialized');
    const project = state.projectManager.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);

    // Remove all tabs for this project
    const removedTabs = tabManager.removeTabsByProject(projectId);
    for (const tab of removedTabs) {
      ptyManager.kill(tab.id);
      deps.cleanupNamingFlag(tab.id);
      deps.sendToRenderer('tab:removed', tab.id);
    }

    // Clean up git watcher
    const gw = gitHeadWatchers.get(projectId);
    if (gw) {
      if (gw.timer) clearTimeout(gw.timer);
      gw.watcher.close();
      gitHeadWatchers.delete(projectId);
    }

    state.projectManager.removeProject(projectId);
    deps.sendToRenderer('project:removed', projectId);
    deps.persistSessions();
  });

  ipcMain.handle('project:list', async () => {
    if (!state.projectManager) return [];
    return state.projectManager.getAllProjects().map(p => ({
      id: p.id, dir: p.dir, colorIndex: p.colorIndex,
    } satisfies ProjectConfig));
  });

  // ---- Legacy session:start (wraps workspace:init + project:add) ----
  ipcMain.handle(
    'session:start',
    async (_event, dir: string, mode: PermissionMode) => {
      // Initialize workspace
      state.permissionMode = mode;
      await settings.setPermissionMode(mode);

      const hooksDir = resolveHooksDir();
      log.debug('[session:start] hooksDir:', hooksDir);
      log.debug('[session:start] hooks exist:', fs.existsSync(path.join(hooksDir, 'pipe-send.js')));

      state.projectManager = new ProjectManager(hooksDir, (status) => {
        deps.sendToRenderer('hook:status', status);
      });
      state.workspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Add the single project
      const ctx = state.projectManager.addProject(dir);
      log.init(dir);
      ctx.hookInstaller.install(dir);

      // Legacy fields
      state.workspaceDir = dir;
      state.worktreeManager = ctx.worktreeManager;
      state.hookInstaller = ctx.hookInstaller;
      state.hookConfigStore = ctx.hookConfigStore;
      state.hookEngine = ctx.hookEngine;

      // Git HEAD watcher
      if (ctx.worktreeManager) {
        setupGitHeadWatcher(ctx.id, dir, ctx.worktreeManager, ctx.hookEngine);
      }

      if (ctx.hookEngine) {
        ctx.hookEngine.emit('app:started', { contextRoot: dir, cwd: dir });
      }

      await settings.addRecentDir(dir);

      return { projectId: ctx.id };
    },
  );

  ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
    const saved = await settings.getSessions(dir);
    return saved.filter(tab => {
      if (!tab.worktree) return true;
      const worktreeCwd = path.join(dir, '.claude', 'worktrees', tab.worktree);
      const exists = fs.existsSync(worktreeCwd);
      if (!exists) {
        log.info('[sessions] skipping saved worktree tab — directory no longer exists:', tab.worktree);
      }
      return exists;
    });
  });

  // ---- Workspace persistence ----
  ipcMain.handle('workspace:list', async () => {
    return workspaceStore.listWorkspaces();
  });

  ipcMain.handle('workspace:save', async (_event, ws: import('@shared/types').WorkspaceConfig) => {
    await workspaceStore.saveWorkspace(ws);
  });

  ipcMain.handle('workspace:delete', async (_event, wsId: string) => {
    await workspaceStore.deleteWorkspace(wsId);
  });

  // ---- Tabs ----
  ipcMain.handle('tab:create', async (_event, projectIdOrWorktree: string | null, worktreeNameOrResumeId?: string | null, resumeSessionIdOrSavedName?: string, savedNameArg?: string) => {
    // Support both new signature (projectId, worktree, resume, savedName)
    // and old signature (worktree, resume, savedName) for backward compat
    let projectId: string | undefined;
    let worktreeName: string | null;
    let resumeSessionId: string | undefined;
    let savedName: string | undefined;

    // Detect new vs old signature: if first arg matches a known project ID, use new signature
    const isNewSignature = projectIdOrWorktree && state.projectManager?.getProject(projectIdOrWorktree);
    if (isNewSignature) {
      projectId = projectIdOrWorktree!;
      worktreeName = (worktreeNameOrResumeId as string | null) ?? null;
      resumeSessionId = resumeSessionIdOrSavedName;
      savedName = savedNameArg;
    } else {
      // Legacy: first arg is worktreeName
      worktreeName = projectIdOrWorktree;
      resumeSessionId = worktreeNameOrResumeId as string | undefined;
      savedName = resumeSessionIdOrSavedName;
      // Use first project
      if (state.projectManager) {
        const projects = state.projectManager.getAllProjects();
        if (projects.length > 0) projectId = projects[0].id;
      }
    }

    const project = projectId ? state.projectManager?.getProject(projectId) : null;
    const workDir = project?.dir ?? state.workspaceDir;
    if (!workDir) throw new Error('Session not started');

    const cwd = worktreeName
      ? path.join(workDir, '.claude', 'worktrees', worktreeName)
      : workDir;
    if (worktreeName && !fs.existsSync(cwd)) {
      throw new Error(`Worktree directory no longer exists: ${worktreeName}`);
    }
    // Read source branch metadata for worktree tabs
    let sourceBranch: string | null = null;
    if (worktreeName) {
      try { sourceBranch = fs.readFileSync(path.join(cwd, '.source-branch'), 'utf-8').trim() || null; } catch { /* ignore */ }
    }
    const tab = tabManager.createTab(cwd, worktreeName, 'claude', savedName, projectId, sourceBranch);

    if (savedName) {
      const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tab.id}`);
      fs.writeFileSync(flagFile, '');
    }

    const installer = project?.hookInstaller ?? state.hookInstaller;
    if (installer) {
      installer.install(cwd);
    }

    const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? [])];
    if (worktreeName) {
      args.push('-w', worktreeName);
      args.push('--append-system-prompt', `IMPORTANT: You are working in a git worktree. Your working directory is "${cwd}". Only read and modify files within this directory. Do NOT access or modify files in the parent repository at "${workDir}".`);
    }
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
      log.info('[tab:create] resuming session', resumeSessionId, 'in cwd:', cwd);
    }

    const extraEnv: Record<string, string> = {
      CLAUDE_TERMINAL_TAB_ID: tab.id,
      CLAUDE_TERMINAL_PIPE: state.pipeName,
      CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
    };

    const spawnCwd = worktreeName ? workDir : cwd;
    const proc = ptyManager.spawn(tab.id, spawnCwd, args, extraEnv);

    wirePtyToTab(proc, tab, cwd);
    return tab;
  });

  ipcMain.handle('tab:createWithWorktree', async (_event, projectIdOrName: string, worktreeNameArg?: string) => {
    // Support both: (projectId, worktreeName) and (worktreeName) signatures
    let projectId: string | undefined;
    let worktreeName: string;

    const isNewSignature = state.projectManager?.getProject(projectIdOrName);
    if (isNewSignature && worktreeNameArg) {
      projectId = projectIdOrName;
      worktreeName = worktreeNameArg;
    } else {
      worktreeName = projectIdOrName;
      if (state.projectManager) {
        const projects = state.projectManager.getAllProjects();
        if (projects.length > 0) projectId = projects[0].id;
      }
    }

    const project = projectId ? state.projectManager?.getProject(projectId) : null;
    const workDir = project?.dir ?? state.workspaceDir;
    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!workDir || !wtManager) throw new Error('Session not started');

    // ANSI codes for progress display
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const RED = '\x1b[31m';
    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';

    const cwd = path.join(workDir, '.claude', 'worktrees', worktreeName);
    const baseBranch = await wtManager.getCurrentBranch();
    const tab = tabManager.createTab(cwd, worktreeName, 'claude', undefined, projectId, baseBranch);
    deps.sendToRenderer('tab:updated', tab);
    deps.persistSessions();

    const sendProgress = (text: string) => {
      deps.sendToRenderer('tab:worktreeProgress', tab.id, text);
    };

    const doSetup = async () => {
      if (!tabManager.getTab(tab.id)) return;

      sendProgress(`${CYAN}❯${RESET} Creating worktree "${worktreeName}"...\r\n`);
      sendProgress(`  Branch: ${worktreeName} (from ${baseBranch})\r\n`);
      sendProgress(`  Path: .claude/worktrees/${worktreeName}\r\n`);

      try {
        await wtManager.createAsync(worktreeName, (text) => {
          sendProgress(`${DIM}${text}${RESET}`);
        });

        if (!tabManager.getTab(tab.id)) return;

        sendProgress(`${GREEN}✓${RESET} Worktree created\r\n\r\n`);

        const hookEngine = project?.hookEngine ?? state.hookEngine;
        if (hookEngine) {
          await hookEngine.emit(
            'worktree:created',
            { contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName },
            (text) => sendProgress(`${DIM}${text}${RESET}`),
          );
        }

        sendProgress(`${CYAN}❯${RESET} Starting Claude...\r\n`);

        const installer = project?.hookInstaller ?? state.hookInstaller;
        if (installer) {
          installer.install(cwd);
        }

        const args: string[] = [
          ...(PERMISSION_FLAGS[state.permissionMode] ?? []),
          '-w', worktreeName,
          '--append-system-prompt', `IMPORTANT: You are working in a git worktree. Your working directory is "${cwd}". Only read and modify files within this directory. Do NOT access or modify files in the parent repository at "${workDir}".`,
        ];

        const extraEnv: Record<string, string> = {
          CLAUDE_TERMINAL_TAB_ID: tab.id,
          CLAUDE_TERMINAL_PIPE: state.pipeName,
          CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
        };

        const proc = ptyManager.spawn(tab.id, workDir, args, extraEnv);
        wirePtyToTab(proc, tab, cwd);
      } catch (err) {
        sendProgress(`\r\n${RED}✗${RESET} Failed to create worktree\r\n`);
        if (err instanceof Error) {
          sendProgress(`${RED}${err.message}${RESET}\r\n`);
        }
        if (tabManager.getTab(tab.id)) {
          tabManager.removeTab(tab.id);
          deps.sendToRenderer('tab:removed', tab.id);
          deps.persistSessions();
        }
      }
    };

    setTimeout(doSetup, 50);
    return tab;
  });

  ipcMain.handle('tab:createShell', async (_event, shellType: 'powershell' | 'wsl', afterTabId?: string, explicitCwd?: string) => {
    // Derive project from afterTabId or first project
    let projectId: string | undefined;
    if (afterTabId) {
      const parentTab = tabManager.getTab(afterTabId);
      if (parentTab) projectId = parentTab.projectId;
    }
    if (!projectId && state.projectManager) {
      const projects = state.projectManager.getAllProjects();
      if (projects.length > 0) projectId = projects[0].id;
    }

    const project = projectId ? state.projectManager?.getProject(projectId) : null;
    const workDir = project?.dir ?? state.workspaceDir;
    if (!workDir) throw new Error('Session not started');

    let cwd = explicitCwd || workDir;
    if (!explicitCwd && afterTabId) {
      const parentTab = tabManager.getTab(afterTabId);
      if (parentTab) cwd = parentTab.cwd;
    }

    const tab = tabManager.createTab(cwd, null, shellType, undefined, projectId);

    if (afterTabId) {
      tabManager.removeTab(tab.id);
      tabManager.insertTabAfter(afterTabId, tab);
    }

    const proc = ptyManager.spawnShell(tab.id, cwd, shellType);
    wirePtyToTab(proc, tab, cwd, { alwaysActivate: true });
    return tab;
  });

  ipcMain.handle('tab:close', async (_event, tabId: string, removeWorktree?: boolean) => {
    const closingTab = tabManager.getTab(tabId);
    const project = closingTab?.projectId ? state.projectManager?.getProject(closingTab.projectId) : null;
    const hookEngine = project?.hookEngine ?? state.hookEngine;

    if (closingTab && hookEngine) {
      hookEngine.emit('tab:closed', { contextRoot: closingTab.cwd, tabId, cwd: closingTab.cwd });
    }
    ptyManager.kill(tabId);
    flowControl.delete(tabId);
    deps.cleanupNamingFlag(tabId);
    if (removeWorktree) {
      const tab = tabManager.getTab(tabId);
      const wtManager = project?.worktreeManager ?? state.worktreeManager;
      if (tab?.worktree && wtManager) {
        try {
          await wtManager.remove(tab.cwd);
          if (hookEngine) {
            const contextRoot = project?.dir ?? state.workspaceDir ?? tab.cwd;
            hookEngine.emit('worktree:removed', { contextRoot, name: path.basename(tab.cwd), path: tab.cwd });
          }
        } catch {
          // worktree removal is best-effort
        }
      }
    }
    if (tabManager.getTab(tabId)) {
      tabManager.removeTab(tabId);
      deps.sendToRenderer('tab:removed', tabId);
      deps.persistSessions();
    }
  });

  ipcMain.handle('tab:switch', async (_event, tabId: string) => {
    tabManager.setActiveTab(tabId);
    deps.clearPendingNotification(tabId);
    deps.sendToRenderer('tab:switched', tabId);
  });

  ipcMain.handle(
    'tab:rename',
    async (_event, tabId: string, name: string) => {
      tabManager.rename(tabId, name);
      const tab = tabManager.getTab(tabId);
      if (tab) {
        deps.sendToRenderer('tab:updated', tab);
        deps.persistSessions();
      }
    },
  );

  ipcMain.handle('tab:getAll', async () => {
    return tabManager.getAllTabs();
  });

  ipcMain.handle('tab:getActiveId', async () => {
    return tabManager.getActiveTabId();
  });

  ipcMain.on('tab:reorder', (_event, tabIds: string[]) => {
    tabManager.reorderTabs(tabIds);
    deps.persistSessions();
  });

  // ---- Worktree ----
  ipcMain.handle('worktree:create', async (_event, nameOrProjectId: string, nameArg?: string) => {
    // Support (projectId, name) and (name) signatures
    let project: ProjectContext | undefined;
    let name: string;
    if (nameArg && state.projectManager?.getProject(nameOrProjectId)) {
      project = state.projectManager.getProject(nameOrProjectId);
      name = nameArg;
    } else {
      name = nameOrProjectId;
      if (state.projectManager) {
        const projects = state.projectManager.getAllProjects();
        if (projects.length > 0) project = projects[0];
      }
    }

    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!wtManager) throw new Error('Not a git repository');
    const worktreePath = await wtManager.create(name);

    const hookEngine = project?.hookEngine ?? state.hookEngine;
    if (hookEngine) {
      await hookEngine.emit('worktree:created', { contextRoot: worktreePath, name, path: worktreePath, branch: name });
    }
    return worktreePath;
  });

  ipcMain.handle('worktree:currentBranch', async (_event, projectId?: string) => {
    const project = projectId ? state.projectManager?.getProject(projectId) : undefined;
    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!wtManager) throw new Error('Not a git repository');
    return wtManager.getCurrentBranch();
  });

  ipcMain.handle('worktree:listDetails', async (_event, projectId?: string) => {
    const project = projectId ? state.projectManager?.getProject(projectId) : undefined;
    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!wtManager) throw new Error('Not a git repository');
    return wtManager.listDetails();
  });

  ipcMain.handle('worktree:remove', async (_event, worktreePath: string, projectId?: string) => {
    const project = projectId ? state.projectManager?.getProject(projectId) : undefined;
    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!wtManager) throw new Error('Not a git repository');
    await wtManager.remove(worktreePath);

    const hookEngine = project?.hookEngine ?? state.hookEngine;
    const contextRoot = project?.dir ?? state.workspaceDir ?? worktreePath;
    if (hookEngine) {
      hookEngine.emit('worktree:removed', { contextRoot, name: path.basename(worktreePath), path: worktreePath });
    }
  });

  ipcMain.handle('worktree:checkStatus', async (_event, worktreePath: string, projectId?: string) => {
    const project = projectId ? state.projectManager?.getProject(projectId) : undefined;
    const wtManager = project?.worktreeManager ?? state.worktreeManager;
    if (!wtManager) throw new Error('Not a git repository');
    return wtManager.checkStatus(worktreePath);
  });

  // ---- Settings ----
  ipcMain.handle('settings:recentDirs', async () => {
    return settings.getRecentDirs();
  });

  ipcMain.handle('settings:removeRecentDir', async (_event, dir: string) => {
    await settings.removeRecentDir(dir);
  });

  ipcMain.handle('settings:permissionMode', async () => {
    return settings.getPermissionMode();
  });

  // ---- Hook Config ----
  ipcMain.handle('hookConfig:load', async (_event, projectId?: string) => {
    const project = projectId ? state.projectManager?.getProject(projectId) : undefined;
    const store = project?.hookConfigStore ?? state.hookConfigStore;
    if (!store) throw new Error('Session not started');
    return store.load();
  });

  ipcMain.handle('hookConfig:save', async (_event, configOrProjectId: RepoHookConfig | string, configArg?: RepoHookConfig) => {
    // Support (projectId, config) and (config) signatures
    let config: RepoHookConfig;
    let project: ProjectContext | undefined;
    if (typeof configOrProjectId === 'string' && configArg) {
      project = state.projectManager?.getProject(configOrProjectId);
      config = configArg;
    } else if (typeof configOrProjectId === 'object' && configOrProjectId !== null) {
      config = configOrProjectId;
    } else {
      throw new Error('Invalid arguments for hookConfig:save');
    }
    const store = project?.hookConfigStore ?? state.hookConfigStore;
    if (!store) throw new Error('Session not started');
    await store.save(config);
  });

  // ---- Dialog ----
  ipcMain.handle('dialog:selectDirectory', async () => {
    if (!state.mainWindow) return null;
    const result = await dialog.showOpenDialog(state.mainWindow as any, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- CLI ----
  ipcMain.handle('cli:getStartDir', async () => {
    return state.cliStartDir;
  });

  // ---- PTY (fire-and-forget via ipcMain.on) ----
  ipcMain.on('pty:write', (_event, tabId: string, data: string) => {
    ptyManager.write(tabId, data);
  });

  ipcMain.on(
    'pty:resize',
    (_event, tabId: string, cols: number, rows: number) => {
      ptyManager.resize(tabId, cols, rows);
      deps.sendToRenderer('pty:resized', tabId, cols, rows);
    },
  );

  ipcMain.on('pty:pause', (_event, tabId: string) => {
    const fc = flowControl.get(tabId);
    if (fc) fc.paused = true;
  });

  ipcMain.on('pty:resume', (_event, tabId: string) => {
    const fc = flowControl.get(tabId);
    if (!fc) return;
    fc.paused = false;
    for (const chunk of fc.buffer) {
      deps.sendToRenderer('pty:data', tabId, chunk);
    }
    fc.buffer.length = 0;
    fc.bufferBytes = 0;
  });

  // ---- Window title (fire-and-forget) ----
  ipcMain.on('window:setTitle', (_event, title: string) => {
    if (state.mainWindow) {
      state.mainWindow.setTitle(title);
    }
  });

  // ---- Instance tint (PID-based hue for multi-window distinction) ----
  ipcMain.handle('instance:getHue', async () => {
    return Math.floor((process.pid * 137.508) % 360);
  });

  // ---- New window ----
  ipcMain.on('window:createNew', () => {
    const args = app.isPackaged ? [] : ['.'];
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
  });

  // ---- Open external URLs ----
  ipcMain.on('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url);
  });

  // ---- Remote access ----
  ipcMain.handle('remote:activate', async () => {
    return deps.activateRemoteAccess();
  });

  ipcMain.handle('remote:deactivate', async () => {
    return deps.deactivateRemoteAccess();
  });

  ipcMain.handle('remote:getInfo', async () => {
    return deps.getRemoteAccessInfo();
  });

  // Return cleanup function and wirePtyToTab for external use
  return {
    cleanup: () => {
      for (const [, entry] of gitHeadWatchers) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.watcher.close();
      }
      gitHeadWatchers.clear();
    },
    wirePtyToTab,
  };
}
