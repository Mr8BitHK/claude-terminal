// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Mock cross-spawn
vi.mock('cross-spawn', () => ({
  default: vi.fn(),
}));

// Mock tree-kill
vi.mock('tree-kill', () => ({
  default: vi.fn((_pid: number, _signal: string, cb?: () => void) => cb?.()),
}));

vi.mock('@main/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import spawn from 'cross-spawn';
import { HookEngine } from '@main/hook-engine';
import type { HookConfigStore } from '@main/hook-config-store';
import type { RepoHook, HookExecutionStatus } from '@shared/types';

function createMockProcess(exitCode: number, stdoutData = '', stderrData = '') {
  const proc = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; pid: number };
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.pid = 1234;
  setTimeout(() => {
    if (stdoutData) proc.stdout.push(Buffer.from(stdoutData));
    proc.stdout.push(null);
    if (stderrData) proc.stderr.push(Buffer.from(stderrData));
    proc.stderr.push(null);
    proc.emit('close', exitCode, null);
  }, 10);
  return proc;
}

function createMockStore(hooks: RepoHook[]): HookConfigStore {
  return {
    load: vi.fn().mockReturnValue({ hooks }),
    save: vi.fn(),
    getHooksForEvent: vi.fn((event: string) =>
      hooks.filter(h => h.enabled && h.event === event)
    ),
  } as unknown as HookConfigStore;
}

describe('HookEngine', () => {
  let onStatus: Mock<(status: HookExecutionStatus) => void>;
  const mockSpawn = vi.mocked(spawn);

  beforeEach(() => {
    vi.clearAllMocks();
    onStatus = vi.fn();
    mockSpawn.mockImplementation(() => createMockProcess(0) as any);
  });

  it('runs matching hooks for an event', async () => {
    const store = createMockStore([{
      id: 'test', name: 'Test', event: 'worktree:created',
      commands: [{ path: '.', command: 'echo hello' }],
      enabled: true,
    }]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp' });

    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ hookId: 'test', status: 'running' })
    );
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ hookId: 'test', status: 'done', exitCode: 0 })
    );
  });

  it('skips disabled hooks', async () => {
    const store = createMockStore([{
      id: 'disabled', name: 'Disabled', event: 'worktree:created',
      commands: [{ path: '.', command: 'echo nope' }],
      enabled: false,
    }]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp' });
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('does nothing when no hooks match', async () => {
    const store = createMockStore([{
      id: 'other', name: 'Other', event: 'tab:created',
      commands: [{ path: '.', command: 'echo wrong' }],
      enabled: true,
    }]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp' });
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('reports failure and skips remaining commands on non-zero exit', async () => {
    mockSpawn.mockImplementationOnce(() => createMockProcess(1, '', 'error msg') as any);

    const store = createMockStore([{
      id: 'fail', name: 'Fail', event: 'worktree:created',
      commands: [
        { path: '.', command: 'bad-command' },
        { path: '.', command: 'should-not-run' },
      ],
      enabled: true,
    }]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp' });

    const failCall = onStatus.mock.calls.find(
      (c: any[]) => c[0].status === 'failed'
    );
    expect(failCall).toBeTruthy();
    expect(failCall![0].exitCode).toBe(1);

    // Second command should NOT have been started
    const runCalls = onStatus.mock.calls.filter(
      (c: any[]) => c[0].status === 'running'
    );
    expect(runCalls).toHaveLength(1);
  });

  it('runs multiple hooks for the same event sequentially', async () => {
    const store = createMockStore([
      { id: 'a', name: 'A', event: 'worktree:created', commands: [{ path: '.', command: 'echo a' }], enabled: true },
      { id: 'b', name: 'B', event: 'worktree:created', commands: [{ path: '.', command: 'echo b' }], enabled: true },
    ]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp' });

    const runCalls = onStatus.mock.calls.filter((c: any[]) => c[0].status === 'running');
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0][0].hookId).toBe('a');
    expect(runCalls[1][0].hookId).toBe('b');
  });

  it('passes shell: true and resolved cwd to spawn', async () => {
    const store = createMockStore([{
      id: 'test', name: 'Test', event: 'worktree:created',
      commands: [{ path: './subdir', command: 'npm install' }],
      enabled: true,
    }]);
    const engine = new HookEngine(store, onStatus);
    await engine.emit('worktree:created', { contextRoot: '/tmp/project' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'npm install',
      [],
      expect.objectContaining({
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    // Verify cwd was resolved
    const callArgs = mockSpawn.mock.calls[0][2] as any;
    expect(callArgs.cwd).toContain('subdir');
  });
});
