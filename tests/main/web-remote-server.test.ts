import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { WebRemoteServer, type WebRemoteServerDeps } from '@main/web-remote-server';
import type { TabManager } from '@main/tab-manager';
import type { PtyManager } from '@main/pty-manager';
import type { AppState } from '@main/ipc-handlers';

function makeMockDeps(): WebRemoteServerDeps {
  const mockProc = { pid: 9999, onData: vi.fn(), onExit: vi.fn() };

  return {
    tabManager: {
      createTab: vi.fn(() => ({ id: 'tab-new', name: 'Tab', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getTab: vi.fn((id: string) => ({ id, name: 'Tab', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getAllTabs: vi.fn(() => []),
      getActiveTabId: vi.fn(() => null),
      setActiveTab: vi.fn(),
      rename: vi.fn(),
      removeTab: vi.fn(),
    } as unknown as TabManager,
    ptyManager: {
      spawn: vi.fn(() => mockProc),
      write: vi.fn(),
      getSize: vi.fn(),
    } as unknown as PtyManager,
    state: {
      workspaceDir: '/test',
      permissionMode: 'bypassPermissions',
      worktreeManager: null,
      hookInstaller: null,
      hookConfigStore: null,
      hookEngine: null,
      mainWindow: null,
      cliStartDir: null,
      pipeName: '\\\\.\\pipe\\test-pipe',
    } as AppState,
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    serializeTerminal: vi.fn(async () => ''),
    wirePtyToTab: vi.fn(),
    settings: { addRecentDir: vi.fn(async () => {}) },
  };
}

// Helper: call handleMessage directly via private method on authenticated client
function createTestClient(server: WebRemoteServer) {
  const sentMessages: any[] = [];
  const mockWs = {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn((data: string) => sentMessages.push(JSON.parse(data))),
    close: vi.fn(),
    on: vi.fn(),
  };

  return {
    sendMessage: async (msg: any) => {
      await (server as any).handleMessage({ ws: mockWs, authenticated: true, synced: true }, msg);
    },
    sentMessages,
    mockWs,
  };
}

describe('WebRemoteServer handleMessage', () => {
  let deps: WebRemoteServerDeps;
  let server: WebRemoteServer;

  beforeEach(() => {
    deps = makeMockDeps();
    server = new WebRemoteServer(deps);
  });

  describe('tab:create', () => {
    it('creates a tab and spawns a PTY', async () => {
      const { sendMessage, sentMessages } = createTestClient(server);
      await sendMessage({ type: 'tab:create' });

      expect(deps.tabManager.createTab).toHaveBeenCalledWith('/test', null, 'claude');
      expect(deps.ptyManager.spawn).toHaveBeenCalledWith(
        'tab-new', '/test', expect.any(Array), expect.any(Object),
      );
      expect(deps.wirePtyToTab).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ id: 'tab-new' }), '/test',
      );
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'tab:created', tab: expect.objectContaining({ id: 'tab-new' }) }),
      );
    });

    it('ignores when workspaceDir is null', async () => {
      deps.state.workspaceDir = null;
      const { sendMessage } = createTestClient(server);
      await sendMessage({ type: 'tab:create' });

      expect(deps.tabManager.createTab).not.toHaveBeenCalled();
    });
  });

  describe('tab:createWithWorktree', () => {
    it('ignores when worktreeManager is null', async () => {
      const { sendMessage } = createTestClient(server);
      await sendMessage({ type: 'tab:createWithWorktree', name: 'my-feature' });

      // Tab is NOT created because worktreeManager is null
      expect(deps.tabManager.createTab).not.toHaveBeenCalled();
    });

    it('creates tab immediately and responds with tab:created', async () => {
      deps.state.worktreeManager = {
        getCurrentBranch: vi.fn(async () => 'main'),
        createAsync: vi.fn(async () => '/test/.claude/worktrees/feat'),
      } as any;

      const { sendMessage, sentMessages } = createTestClient(server);
      await sendMessage({ type: 'tab:createWithWorktree', name: 'feat' });

      expect(deps.tabManager.createTab).toHaveBeenCalled();
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'tab:created' }),
      );
    });
  });

  describe('worktree:currentBranch', () => {
    it('returns empty string when worktreeManager is null', async () => {
      const { sendMessage, sentMessages } = createTestClient(server);
      await sendMessage({ type: 'worktree:currentBranch' });

      expect(sentMessages).toContainEqual({ type: 'worktree:currentBranch', branch: '' });
    });

    it('returns branch name when worktreeManager exists', async () => {
      deps.state.worktreeManager = {
        getCurrentBranch: vi.fn(async () => 'main'),
      } as any;

      const { sendMessage, sentMessages } = createTestClient(server);
      await sendMessage({ type: 'worktree:currentBranch' });

      expect(sentMessages).toContainEqual({ type: 'worktree:currentBranch', branch: 'main' });
    });
  });
});
