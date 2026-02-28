import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 1234,
};

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}));

import { PtyManager } from '@main/pty-manager';
import * as pty from 'node-pty';

describe('PtyManager', () => {
  let manager: PtyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PtyManager();
  });

  it('spawns a Claude process with correct args', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', ['--dangerously-skip-permissions'], {
      CLAUDE_TERMINAL_TAB_ID: 'tab-1',
    });

    // On Windows, spawns through cmd.exe; on other platforms, spawns claude directly
    const isWindows = process.platform === 'win32';
    expect(pty.spawn).toHaveBeenCalledWith(
      isWindows ? 'cmd.exe' : 'claude',
      isWindows ? ['/c', 'claude', '--dangerously-skip-permissions'] : ['--dangerously-skip-permissions'],
      expect.objectContaining({
        cwd: 'D:\\dev\\MyApp',
        env: expect.objectContaining({
          CLAUDE_TERMINAL_TAB_ID: 'tab-1',
        }),
      }),
    );
  });

  it('tracks spawned processes by tab ID', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    expect(manager.getPty('tab-1')).toBeDefined();
    expect(manager.getPty('tab-999')).toBeUndefined();
  });

  it('writes data to PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.write('tab-1', 'hello');
    expect(mockPty.write).toHaveBeenCalledWith('hello');
  });

  it('resizes PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.resize('tab-1', 120, 40);
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('kills and removes PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.kill('tab-1');
    expect(manager.getPty('tab-1')).toBeUndefined();
  });
});
