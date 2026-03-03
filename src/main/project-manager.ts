import fs from 'node:fs';
import { WorktreeManager } from './worktree-manager';
import { HookConfigStore } from './hook-config-store';
import { HookEngine } from './hook-engine';
import { HookInstaller } from './hook-installer';
import type { HookExecutionStatus } from '@shared/types';
import { log } from './logger';

export interface ProjectContext {
  id: string;
  dir: string;
  colorIndex: number;
  worktreeManager: WorktreeManager | null;
  hookConfigStore: HookConfigStore;
  hookEngine: HookEngine;
  hookInstaller: HookInstaller;
}

function generateProjectId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ProjectManager {
  private projects = new Map<string, ProjectContext>();
  private nextColorIndex = 0;
  private hooksDir: string;
  private onHookStatus: (status: HookExecutionStatus) => void;

  constructor(hooksDir: string, onHookStatus: (status: HookExecutionStatus) => void) {
    this.hooksDir = hooksDir;
    this.onHookStatus = onHookStatus;
  }

  addProject(dir: string, id?: string, colorIndex?: number): ProjectContext {
    // Check for duplicate
    for (const ctx of this.projects.values()) {
      if (ctx.dir === dir) {
        throw new Error(`Project already added: ${dir}`);
      }
    }

    const projectId = id ?? generateProjectId();
    const assignedColor = colorIndex ?? this.nextColorIndex++;

    // Initialize managers (WorktreeManager only if it's a git repo)
    let worktreeManager: WorktreeManager | null = null;
    try {
      if (fs.existsSync(dir) && fs.existsSync(`${dir}/.git`)) {
        worktreeManager = new WorktreeManager(dir);
      }
    } catch {
      // Not a git repo, that's fine
    }

    const hookConfigStore = new HookConfigStore(dir);
    const hookEngine = new HookEngine(hookConfigStore, this.onHookStatus);
    const hookInstaller = new HookInstaller(this.hooksDir);

    const ctx: ProjectContext = {
      id: projectId,
      dir,
      colorIndex: assignedColor,
      worktreeManager,
      hookConfigStore,
      hookEngine,
      hookInstaller,
    };

    this.projects.set(projectId, ctx);
    log.info('[project-manager] added project', projectId, dir);

    return ctx;
  }

  removeProject(id: string): void {
    const ctx = this.projects.get(id);
    if (ctx) {
      try {
        ctx.hookInstaller.uninstall(ctx.dir);
      } catch (err) {
        log.warn('[project-manager] failed to uninstall hooks from', ctx.dir, String(err));
      }
      this.projects.delete(id);
      log.info('[project-manager] removed project', id, ctx.dir);
    }
  }

  getProject(id: string): ProjectContext | undefined {
    return this.projects.get(id);
  }

  getProjectByDir(dir: string): ProjectContext | undefined {
    for (const ctx of this.projects.values()) {
      if (ctx.dir === dir) return ctx;
    }
    return undefined;
  }

  getAllProjects(): ProjectContext[] {
    return Array.from(this.projects.values());
  }
}
