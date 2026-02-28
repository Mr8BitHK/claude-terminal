import { contextBridge, ipcRenderer } from 'electron';
import type { PermissionMode, Tab, TabType, SavedTab } from './shared/types';

const api = {
  // Tab operations
  createTab: (worktree: string | null, resumeSessionId?: string, savedName?: string): Promise<Tab> =>
    ipcRenderer.invoke('tab:create', worktree, resumeSessionId, savedName),
  createShellTab: (shellType: 'powershell' | 'wsl', afterTabId?: string): Promise<Tab> =>
    ipcRenderer.invoke('tab:createShell', shellType, afterTabId),
  closeTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('tab:close', tabId),
  switchTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('tab:switch', tabId),
  renameTab: (tabId: string, name: string): Promise<void> =>
    ipcRenderer.invoke('tab:rename', tabId, name),
  getTabs: (): Promise<Tab[]> =>
    ipcRenderer.invoke('tab:getAll'),
  getActiveTabId: (): Promise<string | null> =>
    ipcRenderer.invoke('tab:getActiveId'),

  // PTY data
  writeToPty: (tabId: string, data: string): void =>
    ipcRenderer.send('pty:write', tabId, data),
  resizePty: (tabId: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', tabId, cols, rows),

  // Worktree
  createWorktree: (name: string): Promise<string> =>
    ipcRenderer.invoke('worktree:create', name),
  getCurrentBranch: (): Promise<string> =>
    ipcRenderer.invoke('worktree:currentBranch'),
  listWorktreeDetails: (): Promise<{ name: string; path: string; clean: boolean; changesCount: number }[]> =>
    ipcRenderer.invoke('worktree:listDetails'),
  removeWorktree: (worktreePath: string): Promise<void> =>
    ipcRenderer.invoke('worktree:remove', worktreePath),

  // Settings
  getRecentDirs: (): Promise<string[]> =>
    ipcRenderer.invoke('settings:recentDirs'),
  removeRecentDir: (dir: string): Promise<void> =>
    ipcRenderer.invoke('settings:removeRecentDir', dir),
  getPermissionMode: (): Promise<PermissionMode> =>
    ipcRenderer.invoke('settings:permissionMode'),

  // Window title
  setWindowTitle: (title: string): void =>
    ipcRenderer.send('window:setTitle', title),

  // Startup
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),
  startSession: (dir: string, mode: PermissionMode): Promise<void> =>
    ipcRenderer.invoke('session:start', dir, mode),
  getSavedTabs: (dir: string): Promise<SavedTab[]> =>
    ipcRenderer.invoke('session:getSavedTabs', dir),
  getCliStartDir: (): Promise<string | null> =>
    ipcRenderer.invoke('cli:getStartDir'),

  // Events from main process
  onPtyData: (callback: (tabId: string, data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string, data: string) =>
      callback(tabId, data);
    ipcRenderer.on('pty:data', handler);
    return () => {
      ipcRenderer.removeListener('pty:data', handler);
    };
  },

  onTabUpdate: (callback: (tab: Tab) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tab: Tab) =>
      callback(tab);
    ipcRenderer.on('tab:updated', handler);
    return () => {
      ipcRenderer.removeListener('tab:updated', handler);
    };
  },

  onTabRemoved: (callback: (tabId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string) =>
      callback(tabId);
    ipcRenderer.on('tab:removed', handler);
    return () => {
      ipcRenderer.removeListener('tab:removed', handler);
    };
  },
};

contextBridge.exposeInMainWorld('claudeTerminal', api);

export type ClaudeTerminalApi = typeof api;
