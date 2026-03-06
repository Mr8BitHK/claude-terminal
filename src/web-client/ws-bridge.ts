/**
 * WebSocket bridge that implements the same API shape as window.claudeTerminal
 * (from src/preload.ts) but communicates over WebSocket instead of Electron IPC.
 */
import type { Tab, RemoteAccessInfo, ProjectConfig, WorkspaceConfig } from '../shared/types';

type PtyDataCallback = (tabId: string, data: string) => void;
type PtyResizedCallback = (tabId: string, cols: number, rows: number) => void;
type TabUpdateCallback = (tab: Tab) => void;
type TabRemovedCallback = (tabId: string) => void;
type TabSwitchedCallback = (tabId: string) => void;
type RemoteAccessUpdateCallback = (info: RemoteAccessInfo) => void;

export class WebSocketBridge {
  private ws: WebSocket | null = null;
  private ptyDataListeners = new Set<PtyDataCallback>();
  private ptyResizedListeners = new Set<PtyResizedCallback>();
  private tabUpdateListeners = new Set<TabUpdateCallback>();
  private tabRemovedListeners = new Set<TabRemovedCallback>();
  private tabSwitchedListeners = new Set<TabSwitchedCallback>();
  private remoteAccessUpdateListeners = new Set<RemoteAccessUpdateCallback>();
  private worktreeProgressListeners = new Set<(tabId: string, text: string) => void>();
  private disconnectListeners = new Set<() => void>();
  private pendingTabCreate: { resolve: (tab: Tab) => void; reject: (err: Error) => void } | null = null;
  private pendingBranchRequest: { resolve: (branch: string) => void } | null = null;

  /**
   * Connect to the WebSocket server, authenticate with a token, and wait for
   * the initial tabs:sync message.
   *
   * Returns the initial tab list and active tab ID.
   */
  connect(token: string): Promise<{
    tabs: Tab[];
    activeTabId: string | null;
    termSizes: Record<string, { cols: number; rows: number }>;
  }> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      let authenticated = false;
      let synced = false;

      ws.onopen = () => {
        console.log('[ws-bridge] connected, sending auth');
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          console.warn('[ws-bridge] failed to parse message:', event.data);
          return;
        }

        console.log('[ws-bridge] received:', msg.type, 'authenticated:', authenticated, 'synced:', synced);

        if (!authenticated) {
          if (msg.type === 'auth:ok') {
            authenticated = true;
            console.log('[ws-bridge] auth:ok received, waiting for tabs:sync');
            return;
          }
          if (msg.type === 'auth:fail') {
            ws.close();
            this.ws = null;
            reject(new Error('Authentication failed: invalid token'));
            return;
          }
          console.warn('[ws-bridge] unexpected message before auth:', msg.type);
          return;
        }

        // Wait for the initial tabs:sync that follows auth:ok
        if (!synced && msg.type === 'tabs:sync') {
          synced = true;
          console.log('[ws-bridge] tabs:sync received, resolving with', msg.tabs?.length, 'tabs');
          resolve({
            tabs: msg.tabs ?? [],
            activeTabId: msg.activeTabId ?? null,
            termSizes: msg.termSizes ?? {},
          });
          return;
        }

        // Fully connected — route messages to listeners
        this.handleMessage(msg);
      };

      let settled = false;
      const settle = () => { settled = true; };
      const origResolve = resolve;
      const origReject = reject;
      resolve = (v) => { settle(); origResolve(v); };
      reject = (e) => { settle(); origReject(e); };

      ws.onerror = (err) => {
        console.error('[ws-bridge] error:', err);
        if (!settled) {
          reject(new Error('WebSocket connection error'));
        }
      };

      ws.onclose = (event) => {
        console.log('[ws-bridge] closed, code:', event.code, 'reason:', event.reason, 'settled:', settled);
        this.ws = null;
        if (!settled) {
          reject(new Error('Connection closed before sync'));
        } else {
          // Already connected — notify listeners of disconnect
          for (const cb of this.disconnectListeners) {
            cb();
          }
        }
      };
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'pty:data':
        if (msg.tabId && typeof msg.data === 'string') {
          for (const cb of this.ptyDataListeners) {
            cb(msg.tabId, msg.data);
          }
        }
        break;

      case 'tab:updated':
        if (msg.tab) {
          for (const cb of this.tabUpdateListeners) {
            cb(msg.tab);
          }
        }
        break;

      case 'tab:removed':
        if (msg.tabId) {
          for (const cb of this.tabRemovedListeners) {
            cb(msg.tabId);
          }
        }
        break;

      case 'pty:resized':
        if (msg.tabId && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          for (const cb of this.ptyResizedListeners) {
            cb(msg.tabId, msg.cols, msg.rows);
          }
        }
        break;

      case 'tab:switched':
        if (msg.tabId) {
          for (const cb of this.tabSwitchedListeners) {
            cb(msg.tabId);
          }
        }
        break;

      case 'tabs:sync':
        // Re-sync: treat each tab as an update
        if (msg.tabs) {
          for (const tab of msg.tabs) {
            for (const cb of this.tabUpdateListeners) {
              cb(tab);
            }
          }
        }
        break;

      case 'tab:worktreeProgress':
        if (msg.tabId && typeof msg.text === 'string') {
          for (const cb of this.worktreeProgressListeners) {
            cb(msg.tabId, msg.text);
          }
        }
        break;

      case 'tab:created':
        if (msg.tab && this.pendingTabCreate) {
          // Fire tab update + term size BEFORE resolving the promise so that
          // setTabs, setTermSizes, and setActiveTabId all batch in the same
          // React render — the Terminal never renders without fixedCols/fixedRows.
          for (const cb of this.tabUpdateListeners) {
            cb(msg.tab);
          }
          if (msg.termSize) {
            for (const cb of this.ptyResizedListeners) {
              cb(msg.tab.id, msg.termSize.cols, msg.termSize.rows);
            }
          }
          const pending = this.pendingTabCreate;
          this.pendingTabCreate = null;
          pending.resolve(msg.tab);
        }
        break;

      case 'worktree:currentBranch':
        if (this.pendingBranchRequest) {
          const pending = this.pendingBranchRequest;
          this.pendingBranchRequest = null;
          pending.resolve(msg.branch ?? '');
        }
        break;

      case 'remote:updated':
        if (msg.info) {
          for (const cb of this.remoteAccessUpdateListeners) {
            cb(msg.info);
          }
        }
        break;
    }
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Build an API object that matches the ClaudeTerminalApi shape from preload.ts.
   * Electron-only features are stubbed with no-ops / sensible defaults.
   */
  get api() {
    return {
      // Platform info (stubs — remote client uses its own platform)
      platform: 'linux' as NodeJS.Platform,
      getAvailableShells: async () => [],

      // Workspace / Project management (stubs — not available remotely)
      initWorkspace: async (): Promise<string> => '',
      addProject: async (): Promise<ProjectConfig> => ({ id: '', dir: '', colorIndex: 0 }),
      removeProject: async (): Promise<void> => {},
      listProjects: async (): Promise<ProjectConfig[]> => [],
      listWorkspaces: async (): Promise<WorkspaceConfig[]> => [],
      saveWorkspace: async (): Promise<void> => {},
      deleteWorkspace: async (): Promise<void> => {},

      // Tab operations (most are stubs — the server controls tab lifecycle)
      createTab: async (_projectId?: string, _worktree?: string | null): Promise<Tab> => {
        return new Promise((resolve, reject) => {
          this.pendingTabCreate = { resolve, reject };
          this.send({ type: 'tab:create' });
        });
      },
      createTabWithWorktree: async (name: string): Promise<Tab> => {
        return new Promise((resolve, reject) => {
          this.pendingTabCreate = { resolve, reject };
          this.send({ type: 'tab:createWithWorktree', name });
        });
      },
      createShellTab: async (): Promise<Tab> => {
        throw new Error('createShellTab is not available in remote mode');
      },
      closeTab: async (): Promise<void> => {
        // Not supported remotely
      },
      switchTab: async (tabId: string): Promise<void> => {
        this.send({ type: 'tab:switch', tabId });
      },
      renameTab: async (tabId: string, name: string): Promise<void> => {
        this.send({ type: 'tab:rename', tabId, name });
      },
      getTabs: async (): Promise<Tab[]> => {
        // Request a fresh sync — handled via tabs:sync message
        this.send({ type: 'tab:getAll' });
        return [];
      },
      getActiveTabId: async (): Promise<string | null> => {
        return null;
      },

      // PTY data
      writeToPty: (tabId: string, data: string): void => {
        this.send({ type: 'pty:write', tabId, data });
      },
      resizePty: (tabId: string, cols: number, rows: number): void => {
        this.send({ type: 'pty:resize', tabId, cols, rows });
      },
      pausePty: (_tabId: string): void => {
        // No-op: backpressure not applicable over WebSocket bridge
      },
      resumePty: (_tabId: string): void => {
        // No-op: backpressure not applicable over WebSocket bridge
      },

      reorderTabs: (_tabIds: string[]): void => {},

      // Worktree (stubs)
      createWorktree: async (): Promise<string> => {
        throw new Error('Worktree operations are not available in remote mode');
      },
      getCurrentBranch: async (_projectId?: string): Promise<string> => {
        return new Promise((resolve) => {
          this.pendingBranchRequest = { resolve };
          this.send({ type: 'worktree:currentBranch' });
        });
      },
      listWorktreeDetails: async (_projectId?: string): Promise<{ name: string; path: string; clean: boolean; changesCount: number }[]> => [],
      removeWorktree: async (_worktreePath: string, _projectId?: string): Promise<void> => {},
      checkWorktreeStatus: async (_worktreePath: string, _projectId?: string): Promise<{ clean: boolean; changesCount: number }> => ({ clean: true, changesCount: 0 }),

      // Settings (stubs)
      getRecentDirs: async (): Promise<string[]> => [],
      removeRecentDir: async (): Promise<void> => {},
      getPermissionMode: async () => 'default' as const,

      // Hook config (stubs — not available remotely)
      getHookConfig: async () => ({ hooks: {} }),
      saveHookConfig: async () => {},
      onHookStatus: (_callback: any) => () => {},

      // Window title (browser uses document.title)
      setWindowTitle: (title: string): void => {
        document.title = title;
      },

      // Instance tint (not meaningful for remote — each browser tab is distinct)
      getInstanceHue: async (): Promise<number> => Math.floor(Math.random() * 360),

      // New window (not available remotely)
      createNewWindow: (): void => {},

      // Startup (stubs)
      selectDirectory: async (): Promise<string | null> => null,
      startSession: async (): Promise<void> => {},
      getSavedTabs: async (): Promise<never[]> => [],
      getCliStartDir: async (): Promise<string | null> => null,

      // Remote access (stubs — doesn't make sense from the web client itself)
      activateRemoteAccess: async (): Promise<RemoteAccessInfo> => ({
        status: 'inactive', tunnelUrl: null, token: null, error: null,
      }),
      deactivateRemoteAccess: async (): Promise<void> => {},
      getRemoteAccessInfo: async (): Promise<RemoteAccessInfo> => ({
        status: 'inactive', tunnelUrl: null, token: null, error: null,
      }),

      // Open external URLs (browser can just use window.open)
      openExternal: (url: string): void => {
        window.open(url, '_blank', 'noopener');
      },

      // Event listeners
      onWorktreeProgress: (callback: (tabId: string, text: string) => void): (() => void) => {
        this.worktreeProgressListeners.add(callback);
        return () => { this.worktreeProgressListeners.delete(callback); };
      },

      onPtyData: (callback: PtyDataCallback): (() => void) => {
        this.ptyDataListeners.add(callback);
        return () => { this.ptyDataListeners.delete(callback); };
      },

      onPtyResized: (callback: PtyResizedCallback): (() => void) => {
        this.ptyResizedListeners.add(callback);
        return () => { this.ptyResizedListeners.delete(callback); };
      },

      onTabUpdate: (callback: TabUpdateCallback): (() => void) => {
        this.tabUpdateListeners.add(callback);
        return () => { this.tabUpdateListeners.delete(callback); };
      },

      onTabRemoved: (callback: TabRemovedCallback): (() => void) => {
        this.tabRemovedListeners.add(callback);
        return () => { this.tabRemovedListeners.delete(callback); };
      },

      onTabSwitched: (callback: TabSwitchedCallback): (() => void) => {
        this.tabSwitchedListeners.add(callback);
        return () => { this.tabSwitchedListeners.delete(callback); };
      },

      onRemoteAccessUpdate: (callback: RemoteAccessUpdateCallback): (() => void) => {
        this.remoteAccessUpdateListeners.add(callback);
        return () => { this.remoteAccessUpdateListeners.delete(callback); };
      },

      onBranchChanged: (_callback: (branch: string, projectId?: string) => void): (() => void) => () => {},

      // Project events (stubs — not available remotely)
      onProjectAdded: (_callback: (project: ProjectConfig) => void): (() => void) => () => {},
      onProjectRemoved: (_callback: (projectId: string) => void): (() => void) => () => {},
      onProjectSwitch: (_callback: (projectId: string) => void): (() => void) => () => {},

      // Update notification (stubs)
      getUpdateInfo: async (): Promise<null> => null,
      onUpdateAvailable: (_callback: any): (() => void) => () => {},

      onDisconnect: (callback: () => void): (() => void) => {
        this.disconnectListeners.add(callback);
        return () => { this.disconnectListeners.delete(callback); };
      },
    };
  }
}
