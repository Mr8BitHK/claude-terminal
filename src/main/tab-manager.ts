import { Tab, TabStatus, TabType } from '@shared/types';

function generateId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private activeTabId: string | null = null;
  createTab(cwd: string, worktree: string | null, type: TabType = 'claude', savedName?: string, projectId = ''): Tab {
    const id = generateId();
    let defaultName: string;
    if (type === 'powershell') {
      defaultName = 'PowerShell';
    } else if (type === 'wsl') {
      defaultName = 'WSL';
    } else {
      defaultName = worktree ?? 'New Tab';
    }
    const name = savedName ?? defaultName;
    const status: TabStatus = type === 'claude' ? 'new' : 'shell';
    const tab: Tab = { id, type, name, defaultName, status, worktree, cwd, pid: null, sessionId: null, projectId };
    this.tabs.set(id, tab);
    if (!this.activeTabId) {
      this.activeTabId = id;
    }
    return tab;
  }

  insertTabAfter(afterTabId: string, tab: Tab): void {
    // Rebuild the Map to maintain insertion order (Map preserves insertion order in JS)
    const entries = Array.from(this.tabs.entries());
    this.tabs.clear();
    for (const [key, value] of entries) {
      this.tabs.set(key, value);
      if (key === afterTabId) {
        this.tabs.set(tab.id, tab);
      }
    }
    // If afterTabId wasn't found, the tab was already removed from the map
    // during rebuild, so add it at the end as a fallback
    if (!this.tabs.has(tab.id)) {
      this.tabs.set(tab.id, tab);
    }
  }

  getTab(id: string): Tab | undefined {
    return this.tabs.get(id);
  }

  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  updateStatus(id: string, status: TabStatus): void {
    const tab = this.tabs.get(id);
    if (tab) tab.status = status;
  }

  rename(id: string, name: string): void {
    const tab = this.tabs.get(id);
    if (tab) tab.name = name;
  }

  resetName(id: string): void {
    const tab = this.tabs.get(id);
    if (tab) tab.name = tab.defaultName;
  }

  setSessionId(id: string, sessionId: string): void {
    const tab = this.tabs.get(id);
    if (tab) tab.sessionId = sessionId;
  }

  removeTab(id: string): void {
    this.tabs.delete(id);
    if (this.activeTabId === id) {
      const remaining = this.getAllTabs();
      this.activeTabId = remaining.length > 0 ? remaining[0].id : null;
    }
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  reorderTabs(tabIds: string[]): void {
    const entries = new Map<string, Tab>();
    for (const id of tabIds) {
      const tab = this.tabs.get(id);
      if (tab) entries.set(id, tab);
    }
    for (const [id, tab] of this.tabs) {
      if (!entries.has(id)) entries.set(id, tab);
    }
    this.tabs = entries;
  }

  setActiveTab(id: string): void {
    if (this.tabs.has(id)) {
      this.activeTabId = id;
    }
  }

  getTabsByProject(projectId: string): Tab[] {
    return this.getAllTabs().filter(t => t.projectId === projectId);
  }

  removeTabsByProject(projectId: string): Tab[] {
    const removed: Tab[] = [];
    for (const [id, tab] of this.tabs) {
      if (tab.projectId === projectId) {
        removed.push(tab);
        this.tabs.delete(id);
      }
    }
    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      const remaining = this.getAllTabs();
      this.activeTabId = remaining.length > 0 ? remaining[0].id : null;
    }
    return removed;
  }
}
