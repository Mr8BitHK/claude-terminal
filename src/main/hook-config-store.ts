import fs from 'fs';
import path from 'path';
import type { RepoHookConfig, RepoHook, HookEvent } from '@shared/types';
import { log } from './logger';

const HOOKS_DIR = '.claude-terminal';
const HOOKS_FILE = 'hooks.json';

export class HookConfigStore {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private filePath(): string {
    return path.join(this.rootDir, HOOKS_DIR, HOOKS_FILE);
  }

  load(): RepoHookConfig {
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.hooks)) {
        return parsed as RepoHookConfig;
      }
      return { hooks: [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[hook-config] failed to read hooks from', this.filePath(), String(err));
      }
      return { hooks: [] };
    }
  }

  save(config: RepoHookConfig): void {
    const dir = path.join(this.rootDir, HOOKS_DIR);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath(), JSON.stringify(config, null, 2), 'utf-8');
      log.debug('[hook-config] saved', config.hooks.length, 'hooks to', this.filePath());
    } catch (err) {
      log.error('[hook-config] failed to save hooks to', this.filePath(), String(err));
    }
  }

  getHooksForEvent(event: HookEvent): RepoHook[] {
    const config = this.load();
    return config.hooks.filter(h => h.enabled && h.event === event);
  }
}
