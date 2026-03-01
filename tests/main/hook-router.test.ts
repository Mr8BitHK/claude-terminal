import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron Notification
vi.mock('electron', () => ({
  Notification: Object.assign(
    vi.fn(() => ({
      on: vi.fn(),
      show: vi.fn(),
    })),
    { isSupported: vi.fn(() => true) },
  ),
}));

// Mock logger (depends on Electron)
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { createHookRouter } from '@main/hook-router';
import type { TabManager } from '@main/tab-manager';
import type { IpcMessage } from '@shared/types';

function makeMockDeps() {
  const tabManager = {
    getTab: vi.fn(),
    getActiveTabId: vi.fn(() => 'active-tab'),
    updateStatus: vi.fn(),
    rename: vi.fn(),
    resetName: vi.fn(),
    setSessionId: vi.fn(),
    setActiveTab: vi.fn(),
  } as unknown as TabManager;

  return {
    tabManager,
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    generateTabName: vi.fn(),
    cleanupNamingFlag: vi.fn(),
    getMainWindow: vi.fn(() => ({ show: vi.fn(), focus: vi.fn() })),
    hookEngine: null,
  };
}

describe('hook-router', () => {
  let deps: ReturnType<typeof makeMockDeps>;
  let handleHookMessage: (msg: IpcMessage) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeMockDeps();
    ({ handleHookMessage } = createHookRouter(deps));
  });

  it('ignores messages for unknown tabs', () => {
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    handleHookMessage({ tabId: 'no-such-tab', event: 'tab:status:working', data: null });

    expect(deps.tabManager.updateStatus).not.toHaveBeenCalled();
    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  describe('tab:ready', () => {
    it('sets status to idle and stores sessionId', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      const data = JSON.stringify({ sessionId: 'sess-abc', source: 'startup' });
      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data });

      expect(deps.tabManager.setSessionId).toHaveBeenCalledWith('tab-1', 'sess-abc');
      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'idle');
      expect(deps.persistSessions).toHaveBeenCalled();
      expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
    });

    it('resets name on /clear', () => {
      const tab = { id: 'tab-1', name: 'Old Name' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      const data = JSON.stringify({ sessionId: 'sess-new', source: 'clear' });
      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data });

      expect(deps.tabManager.resetName).toHaveBeenCalledWith('tab-1');
      expect(deps.cleanupNamingFlag).toHaveBeenCalledWith('tab-1');
    });

    it('handles legacy data (plain sessionId string)', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data: 'sess-legacy' });

      expect(deps.tabManager.setSessionId).toHaveBeenCalledWith('tab-1', 'sess-legacy');
    });
  });

  describe('status events', () => {
    it('tab:status:working sets working status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:working', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'working');
      expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
    });

    it('tab:status:idle sets idle status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);
      (deps.tabManager.getActiveTabId as ReturnType<typeof vi.fn>).mockReturnValue('tab-1');

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:idle', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'idle');
    });

    it('tab:status:input sets requires_response status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);
      (deps.tabManager.getActiveTabId as ReturnType<typeof vi.fn>).mockReturnValue('tab-1');

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:input', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'requires_response');
    });
  });

  it('tab:closed is a no-op (waits for onExit)', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:closed', data: null });

    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  it('tab:name renames and persists', () => {
    const tab = { id: 'tab-1', name: 'New Name' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:name', data: 'New Name' });

    expect(deps.tabManager.rename).toHaveBeenCalledWith('tab-1', 'New Name');
    expect(deps.persistSessions).toHaveBeenCalled();
    expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
  });

  it('tab:generate-name delegates to generateTabName', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:generate-name', data: 'Fix the auth' });

    expect(deps.generateTabName).toHaveBeenCalledWith('tab-1', 'Fix the auth');
    // Should NOT broadcast tab:updated (async call will do it later)
    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  it('unknown events are ignored', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'unknown:event', data: null });

    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });
});
