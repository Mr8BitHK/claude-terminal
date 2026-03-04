// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(() => { throw new Error('ENOENT'); }), writeFileSync: vi.fn() };
});

import { WorktreeManager } from '@main/worktree-manager';

describe('WorktreeManager.listDetails', () => {
  let manager: WorktreeManager;
  const mockExecFile = vi.mocked(execFile);

  function mockExecFileResult(stdout: string) {
    mockExecFile.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      if (typeof _opts === 'function') {
        cb = _opts;
      }
      cb(null, stdout, '');
      return {} as any;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager('/fake/root');
  });

  it('returns empty array when only main worktree exists', async () => {
    mockExecFileResult('/fake/root  abc1234 [master]\n');
    const result = await manager.listDetails();
    expect(result).toEqual([]);
  });

  it('returns details for non-main worktrees', async () => {
    mockExecFileResult(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/feat-a  def5678 [feat-a]\n'
    );
    mockExecFileResult('');

    const result = await manager.listDetails();
    expect(result).toEqual([
      { name: 'feat-a', path: '/fake/root/.claude/worktrees/feat-a', clean: true, changesCount: 0, sourceBranch: null },
    ]);
  });

  it('reports dirty worktree with change count', async () => {
    mockExecFileResult(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/bugfix  aaa1111 [bugfix]\n'
    );
    mockExecFileResult(' M file1.ts\n M file2.ts\n?? file3.ts\n');

    const result = await manager.listDetails();
    expect(result).toEqual([
      { name: 'bugfix', path: '/fake/root/.claude/worktrees/bugfix', clean: false, changesCount: 3, sourceBranch: null },
    ]);
  });

  it('handles multiple worktrees', async () => {
    mockExecFileResult(
      '/fake/root  abc [master]\n/fake/root/.claude/worktrees/a  def [a]\n/fake/root/.claude/worktrees/b  ghi [b]\n'
    );
    mockExecFileResult('');
    mockExecFileResult(' M x.ts\n');

    const result = await manager.listDetails();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'a', clean: true, changesCount: 0 });
    expect(result[1]).toMatchObject({ name: 'b', clean: false, changesCount: 1 });
  });
});
