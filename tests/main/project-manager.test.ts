// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
}));
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), init: vi.fn() },
}));
vi.mock('@main/worktree-manager', () => ({
  WorktreeManager: vi.fn(function(this: any, dir: string) {
    this.dir = dir;
    this.getCurrentBranch = vi.fn(async () => 'main');
  }),
}));
vi.mock('@main/hook-config-store', () => ({
  HookConfigStore: vi.fn(function(this: any, dir: string) { this.dir = dir; }),
}));
vi.mock('@main/hook-engine', () => ({
  HookEngine: vi.fn(function(this: any) { this.emit = vi.fn(); }),
}));
vi.mock('@main/hook-installer', () => ({
  HookInstaller: vi.fn(function(this: any) { this.install = vi.fn(); this.uninstall = vi.fn(); }),
}));
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true) },
  existsSync: vi.fn(() => true),
}));

import { ProjectManager } from '@main/project-manager';

describe('ProjectManager', () => {
  let pm: ProjectManager;

  beforeEach(() => {
    vi.clearAllMocks();
    pm = new ProjectManager('/hooks-dir', vi.fn());
  });

  it('addProject creates a ProjectContext with auto-assigned color', () => {
    const ctx = pm.addProject('/repo-a');
    expect(ctx.id).toBeTruthy();
    expect(ctx.dir).toBe('/repo-a');
    expect(ctx.colorIndex).toBe(0);
  });

  it('addProject assigns sequential colors', () => {
    const a = pm.addProject('/repo-a');
    const b = pm.addProject('/repo-b');
    expect(a.colorIndex).toBe(0);
    expect(b.colorIndex).toBe(1);
  });

  it('getProject returns the context by id', () => {
    const ctx = pm.addProject('/repo-a');
    expect(pm.getProject(ctx.id)).toBe(ctx);
  });

  it('getProjectByDir returns the context by directory', () => {
    const ctx = pm.addProject('/repo-a');
    expect(pm.getProjectByDir('/repo-a')).toBe(ctx);
  });

  it('removeProject deletes the context', () => {
    const ctx = pm.addProject('/repo-a');
    pm.removeProject(ctx.id);
    expect(pm.getProject(ctx.id)).toBeUndefined();
  });

  it('getAllProjects returns all contexts', () => {
    pm.addProject('/repo-a');
    pm.addProject('/repo-b');
    expect(pm.getAllProjects()).toHaveLength(2);
  });

  it('rejects duplicate directory', () => {
    pm.addProject('/repo-a');
    expect(() => pm.addProject('/repo-a')).toThrow();
  });

  it('addProject with explicit id and colorIndex uses them', () => {
    const ctx = pm.addProject('/repo-a', 'custom-id', 5);
    expect(ctx.id).toBe('custom-id');
    expect(ctx.colorIndex).toBe(5);
  });
});
