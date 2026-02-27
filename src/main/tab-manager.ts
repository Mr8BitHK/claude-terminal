import { Tab, TabStatus } from '@shared/types';

function generateId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private activeTabId: string | null = null;
  private nextTabNum = 1;

  createTab(cwd: string, worktree: string | null): Tab {
    const id = generateId();
    const name = worktree ?? `Tab ${this.nextTabNum++}`;
    const tab: Tab = { id, name, status: 'new', worktree, cwd, pid: null, sessionId: null };
    this.tabs.set(id, tab);
    if (!this.activeTabId) {
      this.activeTabId = id;
    }
    return tab;
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

  setActiveTab(id: string): void {
    if (this.tabs.has(id)) {
      this.activeTabId = id;
    }
  }
}
