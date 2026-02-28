// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

import { HookConfigStore } from '@main/hook-config-store';

describe('HookConfigStore', () => {
  let tmpDir: string;
  let store: HookConfigStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-config-'));
    store = new HookConfigStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty hooks when file does not exist', () => {
    const config = store.load();
    expect(config.hooks).toEqual([]);
  });

  it('loads hooks from file', () => {
    const dir = path.join(tmpDir, '.claude-terminal');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({
      hooks: [{
        id: 'test', name: 'Test', event: 'worktree:created',
        commands: [{ path: '.', command: 'echo hi' }],
        enabled: true,
      }],
    }));
    const config = store.load();
    expect(config.hooks).toHaveLength(1);
    expect(config.hooks[0].id).toBe('test');
  });

  it('saves hooks to file', () => {
    store.save({
      hooks: [{
        id: 'a', name: 'A', event: 'tab:created',
        commands: [{ path: './src', command: 'npm test' }],
        enabled: false,
      }],
    });
    const filePath = path.join(tmpDir, '.claude-terminal', 'hooks.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.hooks[0].id).toBe('a');
  });

  it('returns empty hooks for invalid JSON', () => {
    const dir = path.join(tmpDir, '.claude-terminal');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), 'not json');
    const config = store.load();
    expect(config.hooks).toEqual([]);
  });

  it('getHooksForEvent returns only matching enabled hooks', () => {
    store.save({
      hooks: [
        { id: 'a', name: 'A', event: 'worktree:created', commands: [{ path: '.', command: 'echo a' }], enabled: true },
        { id: 'b', name: 'B', event: 'worktree:created', commands: [{ path: '.', command: 'echo b' }], enabled: false },
        { id: 'c', name: 'C', event: 'tab:created', commands: [{ path: '.', command: 'echo c' }], enabled: true },
      ],
    });
    const matching = store.getHooksForEvent('worktree:created');
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe('a');
  });
});
