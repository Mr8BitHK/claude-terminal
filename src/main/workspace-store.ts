import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { WorkspaceConfig } from '@shared/types';
import { log } from './logger';

export class WorkspaceStore {
  private dir: string;

  constructor(baseDir?: string) {
    this.dir = baseDir
      ? path.join(baseDir, 'workspaces')
      : path.join(app.getPath('userData'), 'workspaces');
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    if (id.includes('..') || path.isAbsolute(id) || id.includes('/') || id.includes('\\')) {
      throw new Error(`Invalid workspace id: ${id}`);
    }
    return path.join(this.dir, `${id}.json`);
  }

  async listWorkspaces(): Promise<WorkspaceConfig[]> {
    this.ensureDir();
    try {
      const files = await fsp.readdir(this.dir);
      const workspaces: WorkspaceConfig[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fsp.readFile(path.join(this.dir, file), 'utf-8');
          workspaces.push(JSON.parse(raw));
        } catch (err) {
          log.warn('[workspace-store] failed to read', file, String(err));
        }
      }
      return workspaces;
    } catch {
      return [];
    }
  }

  async getWorkspace(id: string): Promise<WorkspaceConfig | null> {
    try {
      const raw = await fsp.readFile(this.filePath(id), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveWorkspace(ws: WorkspaceConfig): Promise<void> {
    this.ensureDir();
    await fsp.writeFile(this.filePath(ws.id), JSON.stringify(ws, null, 2), 'utf-8');
    log.debug('[workspace-store] saved workspace', ws.id, ws.name);
  }

  async deleteWorkspace(id: string): Promise<void> {
    try {
      await fsp.unlink(this.filePath(id));
      log.debug('[workspace-store] deleted workspace', id);
    } catch {
      // File may not exist
    }
  }
}
