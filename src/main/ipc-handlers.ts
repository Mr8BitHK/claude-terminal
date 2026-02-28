import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode, RemoteAccessInfo, RepoHookConfig } from '@shared/types';
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

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { tabManager, ptyManager, settings, state } = deps;

  // Per-tab flow control state for PTY data buffering
  const flowControl = new Map<string, { paused: boolean; buffer: string[] }>();

  // Git HEAD watcher — detects branch changes
  let gitHeadWatcher: fs.FSWatcher | null = null;

  // ---- Session ----
  ipcMain.handle(
    'session:start',
    async (_event, dir: string, mode: PermissionMode) => {
      state.workspaceDir = dir;
      state.permissionMode = mode;
      settings.setPermissionMode(mode);
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
      gitHeadWatcher?.close();
      gitHeadWatcher = null;
      let lastKnownBranch = '';
      try { lastKnownBranch = state.worktreeManager!.getCurrentBranch(); } catch {}
      const gitHeadPath = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        gitHeadWatcher = fs.watch(gitHeadPath, () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            try {
              const branch = state.worktreeManager?.getCurrentBranch() ?? null;
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
    const saved = settings.getSessions(dir);
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
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
      log.info('[tab:create] resuming session', resumeSessionId, 'in cwd:', cwd);
    }

    const extraEnv: Record<string, string> = {
      CLAUDE_TERMINAL_TAB_ID: tab.id,
      CLAUDE_TERMINAL_PIPE: state.pipeName,
      CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
    };

    const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
    tab.pid = proc.pid;

    settings.addRecentDir(state.workspaceDir);

    flowControl.set(tab.id, { paused: false, buffer: [] });

    proc.onData((data: string) => {
      const fc = flowControl.get(tab.id);
      if (fc?.paused) {
        fc.buffer.push(data);
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

    if (tabManager.getAllTabs().length === 1) {
      tabManager.setActiveTab(tab.id);
    }

    deps.sendToRenderer('tab:updated', tab);
    deps.persistSessions();
    if (state.hookEngine) {
      state.hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: 'claude' });
    }
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
    tab.pid = proc.pid;

    flowControl.set(tab.id, { paused: false, buffer: [] });

    proc.onData((data: string) => {
      const fc = flowControl.get(tab.id);
      if (fc?.paused) {
        fc.buffer.push(data);
      } else {
        deps.sendToRenderer('pty:data', tab.id, data);
      }
    });

    proc.onExit(() => {
      flowControl.delete(tab.id);
      if (tabManager.getTab(tab.id)) {
        tabManager.removeTab(tab.id);
        deps.sendToRenderer('tab:removed', tab.id);
        deps.persistSessions();
      }
    });

    tabManager.setActiveTab(tab.id);

    deps.sendToRenderer('tab:updated', tab);
    if (state.hookEngine) {
      state.hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: shellType });
    }
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
          state.worktreeManager.remove(tab.cwd);
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
    const worktreePath = state.worktreeManager.create(name);
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
    state.worktreeManager.remove(worktreePath);
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
    settings.removeRecentDir(dir);
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
    state.hookConfigStore.save(config);
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
  });

  // ---- Window title (fire-and-forget) ----
  ipcMain.on('window:setTitle', (_event, title: string) => {
    if (state.mainWindow) {
      state.mainWindow.setTitle(title);
    }
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
}
