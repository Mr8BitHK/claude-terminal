import Store from 'electron-store';
import { PermissionMode } from '@shared/types';

const MAX_RECENT_DIRS = 10;

export class SettingsStore {
  private store: Store;

  constructor() {
    this.store = new Store({ name: 'claude-terminal-settings' });
  }

  getRecentDirs(): string[] {
    return this.store.get('recentDirs', []) as string[];
  }

  addRecentDir(dir: string): void {
    const dirs = this.getRecentDirs().filter(d => d !== dir);
    dirs.unshift(dir);
    this.store.set('recentDirs', dirs.slice(0, MAX_RECENT_DIRS));
  }

  getPermissionMode(): PermissionMode {
    return this.store.get('permissionMode', 'bypassPermissions') as PermissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.store.set('permissionMode', mode);
  }
}
