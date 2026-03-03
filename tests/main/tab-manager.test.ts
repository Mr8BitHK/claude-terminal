import { describe, it, expect, beforeEach } from 'vitest';
import { TabManager } from '@main/tab-manager';

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  it('creates a tab with correct defaults', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab.status).toBe('new');
    expect(tab.cwd).toBe('D:\\dev\\MyApp');
    expect(tab.worktree).toBeNull();
    expect(tab.name).toBe('New Tab');
  });

  it('uses New Tab as default name for claude tabs', () => {
    manager.createTab('D:\\dev\\MyApp', null);
    const tab2 = manager.createTab('D:\\dev\\MyApp', null);
    expect(tab2.name).toBe('New Tab');
  });

  it('uses worktree name as tab name when provided', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', 'feature/auth');
    expect(tab.name).toBe('feature/auth');
  });

  it('returns all tabs', () => {
    manager.createTab('D:\\dev\\A', null);
    manager.createTab('D:\\dev\\B', null);
    expect(manager.getAllTabs()).toHaveLength(2);
  });

  it('gets tab by id', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    expect(manager.getTab(tab.id)).toBe(tab);
  });

  it('updates tab status', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.updateStatus(tab.id, 'working');
    expect(manager.getTab(tab.id)!.status).toBe('working');
  });

  it('renames a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.rename(tab.id, 'auth refactor');
    expect(manager.getTab(tab.id)!.name).toBe('auth refactor');
  });

  it('removes a tab', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null);
    manager.removeTab(tab.id);
    expect(manager.getTab(tab.id)).toBeUndefined();
  });

  it('creates a powershell tab with correct defaults', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null, 'powershell');
    expect(tab.type).toBe('powershell');
    expect(tab.status).toBe('shell');
    expect(tab.name).toBe('PowerShell');
  });

  it('creates a wsl tab with correct defaults', () => {
    const tab = manager.createTab('D:\\dev\\MyApp', null, 'wsl');
    expect(tab.type).toBe('wsl');
    expect(tab.status).toBe('shell');
    expect(tab.name).toBe('WSL');
  });

  it('shell tabs use shell-specific names', () => {
    const shell = manager.createTab('D:\\dev\\A', null, 'powershell');
    expect(shell.name).toBe('PowerShell');
    const claude = manager.createTab('D:\\dev\\B', null);
    expect(claude.name).toBe('New Tab');
  });

  it('inserts tab after the specified tab', () => {
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', null);
    const tab3 = manager.createTab('D:\\dev\\C', null, 'powershell');
    manager.removeTab(tab3.id);
    manager.insertTabAfter(tab1.id, tab3);
    const ids = manager.getAllTabs().map(t => t.id);
    expect(ids).toEqual([tab1.id, tab3.id, tab2.id]);
  });

  it('insertTabAfter appends when afterTabId not found', () => {
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', null, 'wsl');
    manager.removeTab(tab2.id);
    manager.insertTabAfter('nonexistent', tab2);
    const ids = manager.getAllTabs().map(t => t.id);
    expect(ids).toEqual([tab1.id, tab2.id]);
  });

  it('tracks active tab', () => {
    const tab1 = manager.createTab('D:\\dev\\A', null);
    const tab2 = manager.createTab('D:\\dev\\B', null);
    expect(manager.getActiveTabId()).toBe(tab1.id);
    manager.setActiveTab(tab2.id);
    expect(manager.getActiveTabId()).toBe(tab2.id);
  });

  describe('project-scoped operations', () => {
    it('createTab assigns projectId', () => {
      const tab = manager.createTab('/test', null, 'claude', undefined, 'proj-1');
      expect(tab.projectId).toBe('proj-1');
    });

    it('getTabsByProject returns only tabs for that project', () => {
      manager.createTab('/a', null, 'claude', undefined, 'proj-1');
      manager.createTab('/b', null, 'claude', undefined, 'proj-2');
      manager.createTab('/c', null, 'claude', undefined, 'proj-1');

      const proj1Tabs = manager.getTabsByProject('proj-1');
      expect(proj1Tabs).toHaveLength(2);
      expect(proj1Tabs.every(t => t.projectId === 'proj-1')).toBe(true);
    });

    it('removeTabsByProject removes all tabs for a project', () => {
      manager.createTab('/a', null, 'claude', undefined, 'proj-1');
      manager.createTab('/b', null, 'claude', undefined, 'proj-2');
      manager.createTab('/c', null, 'claude', undefined, 'proj-1');

      const removed = manager.removeTabsByProject('proj-1');
      expect(removed).toHaveLength(2);
      expect(manager.getAllTabs()).toHaveLength(1);
      expect(manager.getAllTabs()[0].projectId).toBe('proj-2');
    });

    it('removeTabsByProject updates activeTabId if needed', () => {
      const tab1 = manager.createTab('/a', null, 'claude', undefined, 'proj-1');
      const tab2 = manager.createTab('/b', null, 'claude', undefined, 'proj-2');
      manager.setActiveTab(tab1.id);

      manager.removeTabsByProject('proj-1');
      expect(manager.getActiveTabId()).toBe(tab2.id);
    });
  });
});
