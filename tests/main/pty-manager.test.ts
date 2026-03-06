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

  it('spawns a shell process using platform config', () => {
    const isWindows = process.platform === 'win32';
    const isDarwin = process.platform === 'darwin';
    // First shell option: powershell on Windows, zsh on macOS, bash on Linux
    const shellId = isWindows ? 'powershell' : isDarwin ? 'zsh' : 'bash';
    const expectedCmd = isWindows ? 'powershell.exe' : isDarwin ? '/bin/zsh' : '/bin/bash';

    manager.spawnShell('tab-2', 'D:\\dev\\MyApp', shellId);
    expect(pty.spawn).toHaveBeenCalledWith(
      expectedCmd,
      [],
      expect.objectContaining({
        cwd: 'D:\\dev\\MyApp',
      }),
    );
  });

  it('throws for unknown shell type', () => {
    expect(() => manager.spawnShell('tab-3', 'D:\\dev\\MyApp', 'nonexistent'))
      .toThrow('Unknown shell type: nonexistent');
  });

  it('kills and removes PTY', () => {
    manager.spawn('tab-1', 'D:\\dev\\MyApp', [], {});
    manager.kill('tab-1');
    // After kill, writing should be a no-op (no error, no delegation)
    mockPty.write.mockClear();
    manager.write('tab-1', 'should be ignored');
    expect(mockPty.write).not.toHaveBeenCalled();
  });
});
