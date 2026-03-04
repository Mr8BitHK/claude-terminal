import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock logger (uses Electron internals)
vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Mock child_process.execFile
// vi.hoisted ensures these are available inside the hoisted vi.mock factory
const { mockStdin, mockChild, mockExecFile } = vi.hoisted(() => {
  const mockStdin = { write: vi.fn(), end: vi.fn() };
  const mockChild = { stdin: mockStdin, pid: 9999 };
  const mockExecFile = vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      setTimeout(() => cb(null, '  Fix Auth Bug  ', ''), 0);
    }
    return mockChild;
  });
  return { mockStdin, mockChild, mockExecFile };
});
vi.mock('node:child_process', () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

import { createTabNamer } from '@main/tab-namer';
import type { TabManager } from '@main/tab-manager';

function makeMockDeps() {
  const tabManager = {
    getTab: vi.fn(),
    rename: vi.fn(),
  } as unknown as TabManager;
  const sendToRenderer = vi.fn();
  const persistSessions = vi.fn();
  return { tabManager, sendToRenderer, persistSessions };
}

describe('cleanupNamingFlag', () => {
  it('deletes the flag file for the given tabId', () => {
    const deps = makeMockDeps();
    const { cleanupNamingFlag } = createTabNamer(deps);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    cleanupNamingFlag('tab-123');

    const expected = path.join(os.tmpdir(), 'claude-terminal-named-tab-123');
    expect(unlinkSpy).toHaveBeenCalledWith(expected);
    unlinkSpy.mockRestore();
  });

  it('does not throw if file does not exist', () => {
    const deps = makeMockDeps();
    const { cleanupNamingFlag } = createTabNamer(deps);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => cleanupNamingFlag('tab-missing')).not.toThrow();
    unlinkSpy.mockRestore();
  });
});

describe('generateTabName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply execFile mock implementation after clearAllMocks wipes it
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        setTimeout(() => cb(null, '  Fix Auth Bug  ', ''), 0);
      }
      return mockChild;
    });
  });

  it('calls execFile and renames tab on success', async () => {
    const deps = makeMockDeps();
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(tab)   // check tab exists
      .mockReturnValueOnce(tab);  // get updated tab
    const { generateTabName } = createTabNamer(deps);

    generateTabName('tab-1', 'Fix the auth bug');

    // Wait for the async callback
    await new Promise(r => setTimeout(r, 50));

    expect(deps.tabManager.rename).toHaveBeenCalledWith('tab-1', 'Fix Auth Bug');
    expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
    expect(deps.persistSessions).toHaveBeenCalled();
  });

  it('writes prompt to stdin', async () => {
    const deps = makeMockDeps();
    const { generateTabName } = createTabNamer(deps);

    generateTabName('tab-1', 'Hello world');

    // callHaikuForName runs inside a .then() — flush the microtask queue
    await new Promise(r => setTimeout(r, 0));

    expect(mockStdin.write).toHaveBeenCalledWith(
      expect.stringContaining('Hello world'),
    );
    expect(mockStdin.end).toHaveBeenCalled();
  });

  it('does not rename if tab no longer exists', async () => {
    const deps = makeMockDeps();
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const { generateTabName } = createTabNamer(deps);

    generateTabName('tab-gone', 'test');
    await new Promise(r => setTimeout(r, 50));

    expect(deps.tabManager.rename).not.toHaveBeenCalled();
  });
});
