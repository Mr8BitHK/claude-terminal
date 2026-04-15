import { contextBridge, ipcRenderer } from 'electron';
import type { PermissionMode, Tab, SavedTab, RemoteAccessInfo, RepoHookConfig, HookExecutionStatus, ProjectConfig, WorkspaceConfig } from './shared/types';
import type { ShellOption } from './shared/platform';

const api = {
  // Platform info
  platform: process.platform,
  getAvailableShells: (): Promise<ShellOption[]> =>
    ipcRenderer.invoke('shell:getAvailable'),

  // Workspace / Project management
  initWorkspace: (mode: PermissionMode): Promise<string> =>
    ipcRenderer.invoke('workspace:init', mode),
  addProject: (dir: string, id?: string, colorIndex?: number): Promise<ProjectConfig> =>
    ipcRenderer.invoke('project:add', dir, id, colorIndex),
  removeProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('project:remove', projectId),
  listProjects: (): Promise<ProjectConfig[]> =>
    ipcRenderer.invoke('project:list'),

  // Workspace persistence
  listWorkspaces: (): Promise<WorkspaceConfig[]> =>
    ipcRenderer.invoke('workspace:list'),
  saveWorkspace: (ws: WorkspaceConfig): Promise<void> =>
    ipcRenderer.invoke('workspace:save', ws),
  deleteWorkspace: (wsId: string): Promise<void> =>
    ipcRenderer.invoke('workspace:delete', wsId),

  // Tab operations
  createTab: (projectId: string, worktree?: string | null, resumeSessionId?: string, savedName?: string): Promise<Tab> =>
    ipcRenderer.invoke('tab:create', projectId, worktree ?? null, resumeSessionId, savedName),
  createTabWithWorktree: (projectId: string, worktreeName: string): Promise<Tab> =>
    ipcRenderer.invoke('tab:createWithWorktree', projectId, worktreeName),
  createShellTab: (shellType: string, afterTabId?: string, cwd?: string): Promise<Tab> =>
    ipcRenderer.invoke('tab:createShell', shellType, afterTabId, cwd),
  closeTab: (tabId: string, removeWorktree?: boolean): Promise<void> =>
    ipcRenderer.invoke('tab:close', tabId, removeWorktree),
  switchTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('tab:switch', tabId),
  renameTab: (tabId: string, name: string): Promise<void> =>
    ipcRenderer.invoke('tab:rename', tabId, name),
  getTabs: (): Promise<Tab[]> =>
    ipcRenderer.invoke('tab:getAll'),
  getActiveTabId: (): Promise<string | null> =>
    ipcRenderer.invoke('tab:getActiveId'),
  reorderTabs: (tabIds: string[]): void =>
    ipcRenderer.send('tab:reorder', tabIds),

  // PTY data
  writeToPty: (tabId: string, data: string): void =>
    ipcRenderer.send('pty:write', tabId, data),
  resizePty: (tabId: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty:resize', tabId, cols, rows),
  pausePty: (tabId: string): void =>
    ipcRenderer.send('pty:pause', tabId),
  resumePty: (tabId: string): void =>
    ipcRenderer.send('pty:resume', tabId),

  // Worktree
  createWorktree: (projectId: string, name: string): Promise<string> =>
    ipcRenderer.invoke('worktree:create', projectId, name),
  getCurrentBranch: (projectId?: string): Promise<string> =>
    ipcRenderer.invoke('worktree:currentBranch', projectId),
  listWorktreeDetails: (projectId?: string): Promise<{ name: string; path: string; clean: boolean; changesCount: number }[]> =>
    ipcRenderer.invoke('worktree:listDetails', projectId),
  removeWorktree: (worktreePath: string, projectId?: string): Promise<void> =>
    ipcRenderer.invoke('worktree:remove', worktreePath, projectId),
  checkWorktreeStatus: (worktreePath: string, projectId?: string): Promise<{ clean: boolean; changesCount: number }> =>
    ipcRenderer.invoke('worktree:checkStatus', worktreePath, projectId),

  // Settings
  getRecentDirs: (): Promise<string[]> =>
    ipcRenderer.invoke('settings:recentDirs'),
  removeRecentDir: (dir: string): Promise<void> =>
    ipcRenderer.invoke('settings:removeRecentDir', dir),
  getPermissionMode: (): Promise<PermissionMode> =>
    ipcRenderer.invoke('settings:permissionMode'),
  setPermissionMode: (mode: PermissionMode): Promise<void> =>
    ipcRenderer.invoke('settings:setPermissionMode', mode),
  getDefaultShell: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:getDefaultShell'),
  setDefaultShell: (shellId: string | null): Promise<void> =>
    ipcRenderer.invoke('settings:setDefaultShell', shellId),

  // Hook config
  getHookConfig: (projectId?: string): Promise<RepoHookConfig> =>
    ipcRenderer.invoke('hookConfig:load', projectId),
  saveHookConfig: (projectIdOrConfig: string | RepoHookConfig, config?: RepoHookConfig): Promise<void> =>
    ipcRenderer.invoke('hookConfig:save', projectIdOrConfig, config),

  // Hook execution status events
  onHookStatus: (callback: (status: HookExecutionStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: HookExecutionStatus) =>
      callback(status);
    ipcRenderer.on('hook:status', handler);
    return () => {
      ipcRenderer.removeListener('hook:status', handler);
    };
  },

  // Window title
  setWindowTitle: (title: string): void =>
    ipcRenderer.send('window:setTitle', title),

  // Instance tint (PID-based hue for multi-window distinction)
  getInstanceHue: (): Promise<number> =>
    ipcRenderer.invoke('instance:getHue'),

  // New window
  createNewWindow: (): void =>
    ipcRenderer.send('window:createNew'),

  // Open external URLs in default browser
  openExternal: (url: string): void =>
    ipcRenderer.send('shell:openExternal', url),

  // Startup (legacy — kept for backward compat, wraps workspace:init + project:add)
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),
  startSession: (dir: string, mode: PermissionMode): Promise<{ projectId: string }> =>
    ipcRenderer.invoke('session:start', dir, mode),
  getSavedTabs: (dir: string): Promise<SavedTab[]> =>
    ipcRenderer.invoke('session:getSavedTabs', dir),
  getCliStartDir: (): Promise<string | null> =>
    ipcRenderer.invoke('cli:getStartDir'),

  // Remote access
  activateRemoteAccess: (): Promise<RemoteAccessInfo> =>
    ipcRenderer.invoke('remote:activate'),
  deactivateRemoteAccess: (): Promise<void> =>
    ipcRenderer.invoke('remote:deactivate'),
  getRemoteAccessInfo: (): Promise<RemoteAccessInfo> =>
    ipcRenderer.invoke('remote:getInfo'),

  // Update notification
  getUpdateInfo: (): Promise<{ version: string; url: string } | null> =>
    ipcRenderer.invoke('app:getUpdateInfo'),
  onUpdateAvailable: (callback: (info: { version: string; url: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string; url: string }) =>
      callback(info);
    ipcRenderer.on('app:updateAvailable', handler);
    return () => {
      ipcRenderer.removeListener('app:updateAvailable', handler);
    };
  },

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

  onRemoteAccessUpdate: (callback: (info: RemoteAccessInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: RemoteAccessInfo) =>
      callback(info);
    ipcRenderer.on('remote:updated', handler);
    return () => {
      ipcRenderer.removeListener('remote:updated', handler);
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

  onWorktreeProgress: (callback: (tabId: string, text: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string, text: string) =>
      callback(tabId, text);
    ipcRenderer.on('tab:worktreeProgress', handler);
    return () => {
      ipcRenderer.removeListener('tab:worktreeProgress', handler);
    };
  },

  onTabSwitched: (callback: (tabId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tabId: string) =>
      callback(tabId);
    ipcRenderer.on('tab:switched', handler);
    return () => {
      ipcRenderer.removeListener('tab:switched', handler);
    };
  },

  onBranchChanged: (callback: (branch: string, projectId?: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, branch: string, projectId?: string) =>
      callback(branch, projectId);
    ipcRenderer.on('git:branchChanged', handler);
    return () => {
      ipcRenderer.removeListener('git:branchChanged', handler);
    };
  },

  onProjectAdded: (callback: (project: ProjectConfig) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, project: ProjectConfig) =>
      callback(project);
    ipcRenderer.on('project:added', handler);
    return () => {
      ipcRenderer.removeListener('project:added', handler);
    };
  },

  onProjectRemoved: (callback: (projectId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string) =>
      callback(projectId);
    ipcRenderer.on('project:removed', handler);
    return () => {
      ipcRenderer.removeListener('project:removed', handler);
    };
  },

  onProjectSwitch: (callback: (projectId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string) =>
      callback(projectId);
    ipcRenderer.on('tab:projectSwitch', handler);
    return () => {
      ipcRenderer.removeListener('tab:projectSwitch', handler);
    };
  },
};

contextBridge.exposeInMainWorld('claudeTerminal', api);

export type ClaudeTerminalApi = typeof api;
