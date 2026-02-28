import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture ipcMain registrations
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      listeners.set(channel, handler);
    }),
  },
  app: {
    isPackaged: false,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

// Mock logger
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Mock WorktreeManager and HookInstaller (constructed inside handlers)
vi.mock('@main/worktree-manager', () => ({
  WorktreeManager: vi.fn(function () {
    return {
      create: vi.fn(),
      getCurrentBranch: vi.fn(),
      listDetails: vi.fn(),
      remove: vi.fn(),
      checkStatus: vi.fn(() => ({ clean: true, changesCount: 0 })),
    };
  }),
}));

vi.mock('@main/hook-installer', () => ({
  HookInstaller: vi.fn(function () {
    return {
      install: vi.fn(),
    };
  }),
}));

import { registerIpcHandlers, type IpcHandlerDeps } from '@main/ipc-handlers';
import type { TabManager } from '@main/tab-manager';
import type { PtyManager } from '@main/pty-manager';
import type { SettingsStore } from '@main/settings-store';

function makeMockDeps(): IpcHandlerDeps {
  const mockProc = {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn(),
  };

  return {
    tabManager: {
      createTab: vi.fn(() => ({ id: 'tab-1', name: 'Tab 1', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getTab: vi.fn((id: string) => ({ id, name: 'Tab 1', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getAllTabs: vi.fn(() => []),
      removeTab: vi.fn(),
      setActiveTab: vi.fn(),
      rename: vi.fn(),
      getActiveTabId: vi.fn(() => 'tab-1'),
      insertTabAfter: vi.fn(),
    } as unknown as TabManager,
    ptyManager: {
      spawn: vi.fn(() => mockProc),
      spawnShell: vi.fn(() => mockProc),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as PtyManager,
    settings: {
      setPermissionMode: vi.fn(),
      getSessions: vi.fn(() => []),
      addRecentDir: vi.fn(),
      getRecentDirs: vi.fn(() => []),
      removeRecentDir: vi.fn(),
      getPermissionMode: vi.fn(() => 'bypassPermissions'),
      saveSessions: vi.fn(),
    } as unknown as SettingsStore,
    state: {
      workspaceDir: null,
      permissionMode: 'bypassPermissions' as const,
      worktreeManager: null,
      hookInstaller: null,
      mainWindow: null,
      cliStartDir: null,
      pipeName: '\\\\.\\pipe\\test-pipe',
    },
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    cleanupNamingFlag: vi.fn(),
    activateRemoteAccess: vi.fn(async () => ({ status: 'connecting' as const, tunnelUrl: null, token: 'test-token', error: null })),
    deactivateRemoteAccess: vi.fn(async () => {}),
    getRemoteAccessInfo: vi.fn(() => ({ status: 'inactive' as const, tunnelUrl: null, token: null, error: null })),
  };
}

describe('registerIpcHandlers', () => {
  let deps: IpcHandlerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    listeners.clear();
    deps = makeMockDeps();
    registerIpcHandlers(deps);
  });

  it('registers all expected channels', () => {
    const expectedHandlers = [
      'session:start', 'session:getSavedTabs',
      'tab:create', 'tab:createShell', 'tab:close', 'tab:switch', 'tab:rename', 'tab:getAll', 'tab:getActiveId',
      'worktree:create', 'worktree:currentBranch', 'worktree:listDetails', 'worktree:remove', 'worktree:checkStatus',
      'settings:recentDirs', 'settings:removeRecentDir', 'settings:permissionMode',
      'dialog:selectDirectory', 'cli:getStartDir',
      'remote:activate', 'remote:deactivate', 'remote:getInfo',
    ];
    for (const channel of expectedHandlers) {
      expect(handlers.has(channel), `missing handler: ${channel}`).toBe(true);
    }

    expect(listeners.has('pty:write')).toBe(true);
    expect(listeners.has('pty:resize')).toBe(true);
    expect(listeners.has('pty:pause')).toBe(true);
    expect(listeners.has('pty:resume')).toBe(true);
    expect(listeners.has('window:setTitle')).toBe(true);
  });

  it('session:start sets workspace dir and permission mode', async () => {
    const handler = handlers.get('session:start')!;
    await handler({}, '/test/dir', 'plan');

    expect(deps.state.workspaceDir).toBe('/test/dir');
    expect(deps.state.permissionMode).toBe('plan');
    expect(deps.settings.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('tab:close kills pty and removes tab', async () => {
    const handler = handlers.get('tab:close')!;
    await handler({}, 'tab-1');

    expect(deps.ptyManager.kill).toHaveBeenCalledWith('tab-1');
    expect(deps.cleanupNamingFlag).toHaveBeenCalledWith('tab-1');
  });

  it('tab:close with removeWorktree=true removes the worktree', async () => {
    // Set up a worktree tab
    deps.state.workspaceDir = '/test';
    const startHandler = handlers.get('session:start')!;
    await startHandler({}, '/test', 'bypassPermissions');
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'wt-1', worktree: 'my-feature', cwd: '/test/.claude/worktrees/my-feature',
    });

    const handler = handlers.get('tab:close')!;
    await handler({}, 'wt-1', true);

    expect(deps.state.worktreeManager!.remove).toHaveBeenCalledWith('/test/.claude/worktrees/my-feature');
  });

  it('tab:close without removeWorktree does not remove the worktree', async () => {
    deps.state.workspaceDir = '/test';
    const startHandler = handlers.get('session:start')!;
    await startHandler({}, '/test', 'bypassPermissions');
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'wt-1', worktree: 'my-feature', cwd: '/test/.claude/worktrees/my-feature',
    });

    const handler = handlers.get('tab:close')!;
    await handler({}, 'wt-1');

    expect(deps.state.worktreeManager!.remove).not.toHaveBeenCalled();
  });

  it('tab:switch delegates to tabManager', async () => {
    const handler = handlers.get('tab:switch')!;
    await handler({}, 'tab-2');

    expect(deps.tabManager.setActiveTab).toHaveBeenCalledWith('tab-2');
  });

  it('tab:rename renames and broadcasts', async () => {
    const handler = handlers.get('tab:rename')!;
    await handler({}, 'tab-1', 'New Name');

    expect(deps.tabManager.rename).toHaveBeenCalledWith('tab-1', 'New Name');
    expect(deps.sendToRenderer).toHaveBeenCalled();
    expect(deps.persistSessions).toHaveBeenCalled();
  });

  it('pty:write forwards to ptyManager', () => {
    const listener = listeners.get('pty:write')!;
    listener({}, 'tab-1', 'hello');

    expect(deps.ptyManager.write).toHaveBeenCalledWith('tab-1', 'hello');
  });

  it('pty:resize forwards to ptyManager', () => {
    const listener = listeners.get('pty:resize')!;
    listener({}, 'tab-1', 120, 40);

    expect(deps.ptyManager.resize).toHaveBeenCalledWith('tab-1', 120, 40);
  });

  it('cli:getStartDir returns cliStartDir from state', async () => {
    deps.state.cliStartDir = '/some/path';
    const handler = handlers.get('cli:getStartDir')!;
    const result = await handler({});

    expect(result).toBe('/some/path');
  });

  it('registers pty:pause and pty:resume listeners', () => {
    expect(listeners.has('pty:pause')).toBe(true);
    expect(listeners.has('pty:resume')).toBe(true);
  });

  describe('pty flow control', () => {
    it('buffers data when paused and flushes on resume', async () => {
      // Start session and create tab to set up PTY data forwarding
      deps.state.workspaceDir = '/test';
      const handler = handlers.get('tab:create')!;
      await handler({}, null);

      // Get the onData callback that was registered on the mock PTY
      const mockProc = (deps.ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
      const onDataCallback = mockProc.onData.mock.calls[0][0];

      // Pause the tab
      const pauseListener = listeners.get('pty:pause')!;
      pauseListener({}, 'tab-1');

      // Send data while paused — should NOT reach renderer
      (deps.sendToRenderer as ReturnType<typeof vi.fn>).mockClear();
      onDataCallback('buffered data');
      expect(deps.sendToRenderer).not.toHaveBeenCalledWith('pty:data', 'tab-1', 'buffered data');

      // Resume — should flush buffered data
      const resumeListener = listeners.get('pty:resume')!;
      resumeListener({}, 'tab-1');
      expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:data', 'tab-1', 'buffered data');

      // After resume, new data should flow directly
      (deps.sendToRenderer as ReturnType<typeof vi.fn>).mockClear();
      onDataCallback('live data');
      expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:data', 'tab-1', 'live data');
    });
  });
});
