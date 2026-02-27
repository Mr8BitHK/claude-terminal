import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { PermissionMode, SavedTab } from '@shared/types';

const MAX_RECENT_DIRS = 10;

interface StoreData {
  recentDirs: string[];
  permissionMode: PermissionMode;
  sessions: Record<string, SavedTab[]>;
}

const DEFAULTS: StoreData = {
  recentDirs: [],
  permissionMode: 'bypassPermissions',
  sessions: {},
};

export class SettingsStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'claude-terminal-settings.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getRecentDirs(): string[] {
    return this.data.recentDirs;
  }

  addRecentDir(dir: string): void {
    this.data.recentDirs = this.data.recentDirs.filter(d => d !== dir);
    this.data.recentDirs.unshift(dir);
    this.data.recentDirs = this.data.recentDirs.slice(0, MAX_RECENT_DIRS);
    this.save();
  }

  getPermissionMode(): PermissionMode {
    return this.data.permissionMode;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.data.permissionMode = mode;
    this.save();
  }

  getSessions(dir: string): SavedTab[] {
    return this.data.sessions[dir] ?? [];
  }

  saveSessions(dir: string, tabs: SavedTab[]): void {
    this.data.sessions[dir] = tabs;
    this.save();
  }

  clearSessions(dir: string): void {
    delete this.data.sessions[dir];
    this.save();
  }
}
