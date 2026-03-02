import { app, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode, RemoteAccessInfo, RepoHookConfig, Tab } from '@shared/types';
import { PERMISSION_FLAGS } from '@shared/types';
import { HookConfigStore } from './hook-config-store';
import { HookEngine } from './hook-engine';
import { WorktreeManager } from './worktree-manager';
import { HookInstaller } from './hook-installer';
import type { TabManager } from './tab-manager';
import type { PtyManager } from './pty-manager';
import type { SettingsStore } from './settings-store';
import { log } from './logger';

export interface AppState {
  workspaceDir: string | null;
  permissionMode: PermissionMode;
  worktreeManager: WorktreeManager | null;
  hookInstaller: HookInstaller | null;
  hookConfigStore: HookConfigStore | null;
  hookEngine: HookEngine | null;
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
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  cleanupNamingFlag: (tabId: string) => void;
  activateRemoteAccess: () => Promise<RemoteAccessInfo>;
  deactivateRemoteAccess: () => Promise<void>;
  getRemoteAccessInfo: () => RemoteAccessInfo;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): { cleanup: () => void; wirePtyToTab: WirePtyToTabFn } {
  const { tabManager, ptyManager, settings, state } = deps;

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
    if (state.hookEngine) {
      state.hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: tab.type });
    }
  }

  // Git HEAD watcher — detects branch changes
  let gitHeadWatcher: fs.FSWatcher | null = null;
  let gitHeadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- Session ----
  ipcMain.handle(
    'session:start',
    async (_event, dir: string, mode: PermissionMode) => {
      state.workspaceDir = dir;
      state.permissionMode = mode;
      await settings.setPermissionMode(mode);
      log.init(dir);
      state.worktreeManager = new WorktreeManager(dir);
      // In dev, __dirname is .vite/build/ — go up to project root.
      // In production, hooks are copied to resources/hooks/ by forge config.
      const projectRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'hooks')
        : path.join(__dirname, '..', '..', 'src', 'hooks');
      log.debug('[session:start] __dirname:', __dirname);
      log.debug('[session:start] hooksDir:', projectRoot);
      log.debug('[session:start] hooks exist:', fs.existsSync(path.join(projectRoot, 'pipe-send.js')));
      state.hookInstaller = new HookInstaller(projectRoot);
      state.hookConfigStore = new HookConfigStore(dir);
      state.hookEngine = new HookEngine(state.hookConfigStore, (status) => {
        deps.sendToRenderer('hook:status', status);
      });

      // Watch .git/HEAD for branch changes
      if (gitHeadDebounceTimer) { clearTimeout(gitHeadDebounceTimer); gitHeadDebounceTimer = null; }
      gitHeadWatcher?.close();
      gitHeadWatcher = null;
      let lastKnownBranch = '';
      try { lastKnownBranch = await state.worktreeManager!.getCurrentBranch(); } catch {}
      const gitHeadPath = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        gitHeadWatcher = fs.watch(gitHeadPath, () => {
          if (gitHeadDebounceTimer) clearTimeout(gitHeadDebounceTimer);
          gitHeadDebounceTimer = setTimeout(async () => {
            try {
              const branch = await state.worktreeManager?.getCurrentBranch() ?? null;
              deps.sendToRenderer('git:branchChanged', branch);
              if (branch && state.hookEngine) {
                state.hookEngine.emit('branch:changed', { contextRoot: dir, from: lastKnownBranch, to: branch });
                lastKnownBranch = branch;
              }
            } catch { /* not a git repo or git error */ }
          }, 1000);
        });
        gitHeadWatcher.on('error', () => { /* ignore watch errors */ });
      }

      if (state.hookEngine) {
        state.hookEngine.emit('app:started', { contextRoot: dir, cwd: dir });
      }
    },
  );

  ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
    const saved = await settings.getSessions(dir);
    // Filter out worktree tabs whose directories no longer exist
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

  // ---- Tabs ----
  ipcMain.handle('tab:create', async (_event, worktreeName: string | null, resumeSessionId?: string, savedName?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');
    const cwd = worktreeName
      ? path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName)
      : state.workspaceDir;
    if (worktreeName && !fs.existsSync(cwd)) {
      throw new Error(`Worktree directory no longer exists: ${worktreeName}`);
    }
    const tab = tabManager.createTab(cwd, worktreeName, 'claude', savedName);

    if (savedName) {
      const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tab.id}`);
      fs.writeFileSync(flagFile, '');
    }

    if (state.hookInstaller) {
      state.hookInstaller.install(cwd);
    }

    const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? [])];
    if (worktreeName) {
      args.push('-w', worktreeName);
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

    const spawnCwd = worktreeName ? state.workspaceDir : cwd;
    const proc = ptyManager.spawn(tab.id, spawnCwd, args, extraEnv);

    await settings.addRecentDir(state.workspaceDir);

    wirePtyToTab(proc, tab, cwd);
    return tab;
  });

  ipcMain.handle('tab:createWithWorktree', async (_event, worktreeName: string) => {
    if (!state.workspaceDir || !state.worktreeManager) throw new Error('Session not started');

    // ANSI codes for progress display
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const RED = '\x1b[31m';
    const DIM = '\x1b[2m';
    const RESET = '\x1b[0m';

    // 1. Create tab immediately so renderer can mount xterm
    const cwd = path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName);
    const tab = tabManager.createTab(cwd, worktreeName, 'claude');
    deps.sendToRenderer('tab:updated', tab);
    deps.persistSessions();

    const sendProgress = (text: string) => {
      deps.sendToRenderer('tab:worktreeProgress', tab.id, text);
    };

    // 2. Fire off async worktree creation (don't block the IPC return)
    const baseBranch = await state.worktreeManager.getCurrentBranch();

    const doSetup = async () => {
      // Guard: tab may have been closed during the setTimeout delay
      if (!tabManager.getTab(tab.id)) return;

      sendProgress(`${CYAN}❯${RESET} Creating worktree "${worktreeName}"...\r\n`);
      sendProgress(`  Branch: ${worktreeName} (from ${baseBranch})\r\n`);
      sendProgress(`  Path: .claude/worktrees/${worktreeName}\r\n`);

      try {
        await state.worktreeManager!.createAsync(worktreeName, (text) => {
          sendProgress(`${DIM}${text}${RESET}`);
        });

        // Guard: tab may have been closed while git was running
        if (!tabManager.getTab(tab.id)) return;

        sendProgress(`${GREEN}✓${RESET} Worktree created\r\n\r\n`);

        // Fire worktree:created hook (matches standalone worktree:create handler)
        if (state.hookEngine) {
          state.hookEngine.emit('worktree:created', { contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName });
        }

        sendProgress(`${CYAN}❯${RESET} Starting Claude...\r\n`);

        if (state.hookInstaller) {
          state.hookInstaller.install(cwd);
        }

        const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? []), '-w', worktreeName];

        const extraEnv: Record<string, string> = {
          CLAUDE_TERMINAL_TAB_ID: tab.id,
          CLAUDE_TERMINAL_PIPE: state.pipeName,
          CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
        };

        const proc = ptyManager.spawn(tab.id, state.workspaceDir!, args, extraEnv);

        await settings.addRecentDir(state.workspaceDir!);

        wirePtyToTab(proc, tab, cwd);
      } catch (err) {
        sendProgress(`\r\n${RED}✗${RESET} Failed to create worktree\r\n`);
        if (err instanceof Error) {
          sendProgress(`${RED}${err.message}${RESET}\r\n`);
        }
        // Bug fix: clean up zombie tab on failure
        if (tabManager.getTab(tab.id)) {
          tabManager.removeTab(tab.id);
          deps.sendToRenderer('tab:removed', tab.id);
          deps.persistSessions();
        }
      }
    };

    // Small delay so the renderer has time to mount the xterm for this tab,
    // then begin sending progress
    setTimeout(doSetup, 50);

    // Return tab immediately so renderer can switch to it
    return tab;
  });

  ipcMain.handle('tab:createShell', async (_event, shellType: 'powershell' | 'wsl', afterTabId?: string, explicitCwd?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');

    let cwd = explicitCwd || state.workspaceDir;
    if (!explicitCwd && afterTabId) {
      const parentTab = tabManager.getTab(afterTabId);
      if (parentTab) {
        cwd = parentTab.cwd;
      }
    }

    const tab = tabManager.createTab(cwd, null, shellType);

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
    if (closingTab && state.hookEngine) {
      state.hookEngine.emit('tab:closed', { contextRoot: closingTab.cwd, tabId, cwd: closingTab.cwd });
    }
    ptyManager.kill(tabId);
    flowControl.delete(tabId);
    deps.cleanupNamingFlag(tabId);
    if (removeWorktree) {
      const tab = tabManager.getTab(tabId);
      if (tab?.worktree && state.worktreeManager) {
        try {
          await state.worktreeManager.remove(tab.cwd);
          if (state.hookEngine) {
            state.hookEngine.emit('worktree:removed', { contextRoot: state.workspaceDir!, name: path.basename(tab.cwd), path: tab.cwd });
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
    // Notify remote web clients of the tab switch
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
  ipcMain.handle('worktree:create', async (_event, name: string) => {
    if (!state.worktreeManager) throw new Error('Session not started');
    const worktreePath = await state.worktreeManager.create(name);
    // Fire repo hooks (fire-and-forget)
    // The worktree branch is named after `name` (see WorktreeManager.create)
    if (state.hookEngine) {
      state.hookEngine.emit('worktree:created', { contextRoot: worktreePath, name, path: worktreePath, branch: name });
    }
    return worktreePath;
  });

  ipcMain.handle('worktree:currentBranch', async () => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.getCurrentBranch();
  });

  ipcMain.handle('worktree:listDetails', async () => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.listDetails();
  });

  ipcMain.handle('worktree:remove', async (_event, worktreePath: string) => {
    if (!state.worktreeManager) throw new Error('Session not started');
    await state.worktreeManager.remove(worktreePath);
    if (state.hookEngine) {
      state.hookEngine.emit('worktree:removed', { contextRoot: state.workspaceDir!, name: path.basename(worktreePath), path: worktreePath });
    }
  });

  ipcMain.handle('worktree:checkStatus', async (_event, worktreePath: string) => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.checkStatus(worktreePath);
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
  ipcMain.handle('hookConfig:load', async () => {
    if (!state.hookConfigStore) throw new Error('Session not started');
    return state.hookConfigStore.load();
  });

  ipcMain.handle('hookConfig:save', async (_event, config: RepoHookConfig) => {
    if (!state.hookConfigStore) throw new Error('Session not started');
    await state.hookConfigStore.save(config);
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
      // Notify remote web clients so they can match the host terminal size
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
    // Flush buffered data
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

  // ---- New window ----
  ipcMain.on('window:createNew', () => {
    spawn(process.execPath, [], { detached: true, stdio: 'ignore' }).unref();
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
      if (gitHeadDebounceTimer) {
        clearTimeout(gitHeadDebounceTimer);
        gitHeadDebounceTimer = null;
      }
      if (gitHeadWatcher) {
        gitHeadWatcher.close();
        gitHeadWatcher = null;
      }
    },
    wirePtyToTab,
  };
}
