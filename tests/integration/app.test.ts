// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TabManager } from '@main/tab-manager';

describe('integration: tab lifecycle', () => {
  it('full tab lifecycle: create, update status, rename, close', () => {
    const manager = new TabManager();

    // Create
    const tab = manager.createTab('D:\\dev\\Test', null);
    expect(tab.status).toBe('new');

    // Status updates
    manager.updateStatus(tab.id, 'working');
    expect(manager.getTab(tab.id)!.status).toBe('working');

    manager.updateStatus(tab.id, 'requires_response');
    expect(manager.getTab(tab.id)!.status).toBe('requires_response');

    // Rename
    manager.rename(tab.id, 'auth refactor');
    expect(manager.getTab(tab.id)!.name).toBe('auth refactor');

    // Close
    manager.removeTab(tab.id);
    expect(manager.getTab(tab.id)).toBeUndefined();
    expect(manager.getAllTabs()).toHaveLength(0);
  });

  it('active tab switches when current tab is closed', () => {
    const manager = new TabManager();
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', 'feature/b');

    manager.setActiveTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab2.id);

    manager.removeTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab1.id);
  });

  it('worktree tabs use worktree name', () => {
    const manager = new TabManager();
    const tab = manager.createTab('D:\\dev\\MyApp\\.claude\\worktrees\\feature-auth', 'feature-auth');
    expect(tab.name).toBe('feature-auth');
    expect(tab.worktree).toBe('feature-auth');
  });

  it('multiple tabs track independently', () => {
    const manager = new TabManager();
    const t1 = manager.createTab('D:\\dev\\A', null);
    const t2 = manager.createTab('D:\\dev\\B', null);
    const t3 = manager.createTab('D:\\dev\\C', 'feat/c');

    manager.updateStatus(t1.id, 'working');
    manager.updateStatus(t2.id, 'idle');
    manager.updateStatus(t3.id, 'requires_response');

    expect(manager.getTab(t1.id)!.status).toBe('working');
    expect(manager.getTab(t2.id)!.status).toBe('idle');
    expect(manager.getTab(t3.id)!.status).toBe('requires_response');

    expect(manager.getAllTabs()).toHaveLength(3);
  });
});
