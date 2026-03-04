// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { execFile, spawn } from 'child_process';
import fs from 'fs';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: vi.fn(), readFileSync: vi.fn() };
});

import { WorktreeManager } from '@main/worktree-manager';

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  const mockExecFile = vi.mocked(execFile);

  function mockExecFileResult(stdout: string) {
    mockExecFile.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, stdout, '');
      return {} as any;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager('D:\\dev\\MyApp');
  });

  it('gets current branch name', async () => {
    mockExecFileResult('main\n');
    expect(await manager.getCurrentBranch()).toBe('main');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.objectContaining({ cwd: 'D:\\dev\\MyApp' }),
      expect.any(Function),
    );
  });

  it('creates a worktree from current branch', async () => {
    mockExecFileResult('main\n'); // getCurrentBranch
    mockExecFileResult('');        // git worktree add
    const result = await manager.create('feature/auth');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'add']),
      expect.anything(),
      expect.any(Function),
    );
    expect(result.path).toContain(path.join('feature', 'auth'));
    expect(result.sourceBranch).toBe('main');
  });

  it('checkStatus returns clean for worktree with no changes', async () => {
    mockExecFileResult('');
    const status = await manager.checkStatus('D:\\dev\\MyApp\\.claude\\worktrees\\feat');
    expect(status.clean).toBe(true);
    expect(status.changesCount).toBe(0);
  });

  it('checkStatus returns dirty for worktree with changes', async () => {
    mockExecFileResult('M  src/index.ts\n?? new-file.ts\n');
    const status = await manager.checkStatus('D:\\dev\\MyApp\\.claude\\worktrees\\feat');
    expect(status.clean).toBe(false);
    expect(status.changesCount).toBe(2);
  });

  it('removes a worktree', async () => {
    mockExecFileResult(''); // worktree remove
    mockExecFileResult(''); // branch -D
    await manager.remove('D:\\dev\\MyApp\\.claude\\worktrees\\feature-auth');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('lists worktree details (skipping main worktree)', async () => {
    mockExecFileResult(
      'D:/dev/MyApp  abc1234 [main]\nD:/dev/MyApp/.claude/worktrees/feat  def5678 [feat]\n'
    );  // list() via listDetails()
    mockExecFileResult('M  src/index.ts\n');  // git status --porcelain for feat
    const details = await manager.listDetails();
    expect(details).toHaveLength(1);
    expect(details[0].name).toBe('feat');
    expect(details[0].clean).toBe(false);
    expect(details[0].changesCount).toBe(1);
  });

  describe('createAsync', () => {
    const mockSpawn = vi.mocked(spawn);

    it('resolves with worktree path on success', async () => {
      mockExecFileResult('main\n'); // getCurrentBranch

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('my-feature', onOutput);

      // Allow microtask (getCurrentBranch await) to resolve before accessing spawn mock
      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Simulate stdout output
      const stdoutCb = mockProc.stdout.on.mock.calls[0][1];
      stdoutCb(Buffer.from('Preparing worktree'));

      // Simulate successful close
      const closeCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'close')![1];
      closeCb(0);

      const result = await promise;
      expect(result.path).toContain(path.join('.claude', 'worktrees', 'my-feature'));
      expect(result.sourceBranch).toBe('main');
      expect(onOutput).toHaveBeenCalledWith('Preparing worktree');
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.objectContaining({ cwd: 'D:\\dev\\MyApp' }),
      );
    });

    it('rejects when git exits with non-zero code', async () => {
      mockExecFileResult('main\n');

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('bad-name', onOutput);

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      const closeCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'close')![1];
      closeCb(128);

      await expect(promise).rejects.toThrow('git worktree add failed with exit code 128');
    });

    it('rejects when spawn fails', async () => {
      mockExecFileResult('main\n');

      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProc as any);

      const onOutput = vi.fn();
      const promise = manager.createAsync('feat', onOutput);

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      const errorCb = mockProc.on.mock.calls.find((c: any) => c[0] === 'error')![1];
      errorCb(new Error('ENOENT'));

      await expect(promise).rejects.toThrow('Failed to spawn git: ENOENT');
    });
  });
});
