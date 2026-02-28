import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode, RemoteAccessInfo } from '@shared/types';
import { PERMISSION_FLAGS } from '@shared/types';
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
    },
  );

  ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
    return settings.getSessions(dir);
  });

  // ---- Tabs ----
  ipcMain.handle('tab:create', async (_event, worktreeName: string | null, resumeSessionId?: string, savedName?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');
    const cwd = worktreeName
      ? path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName)
      : state.workspaceDir;
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
    return tab;
  });

  ipcMain.handle('tab:createShell', async (_event, shellType: 'powershell' | 'wsl', afterTabId?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');

    let cwd = state.workspaceDir;
    if (afterTabId) {
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
    return tab;
  });

  ipcMain.handle('tab:close', async (_event, tabId: string, removeWorktree?: boolean) => {
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
    return state.worktreeManager.create(name);
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
