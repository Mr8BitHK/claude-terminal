// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

import { SettingsStore } from '@main/settings-store';

describe('SettingsStore', () => {
  let store: SettingsStore;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `claude-terminal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    store = new SettingsStore(tmpFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });

  it('returns empty recent dirs by default', () => {
    expect(store.getRecentDirs()).toEqual([]);
  });

  it('adds a recent directory', () => {
    store.addRecentDir('D:\\dev\\MyApp');
    expect(store.getRecentDirs()).toContain('D:\\dev\\MyApp');
  });

  it('moves duplicate to front', () => {
    store.addRecentDir('D:\\dev\\A');
    store.addRecentDir('D:\\dev\\B');
    store.addRecentDir('D:\\dev\\A');
    const dirs = store.getRecentDirs();
    expect(dirs[0]).toBe('D:\\dev\\A');
    expect(dirs).toHaveLength(2);
  });

  it('limits to 10 recent dirs', () => {
    for (let i = 0; i < 15; i++) {
      store.addRecentDir(`D:\\dev\\project${i}`);
    }
    expect(store.getRecentDirs()).toHaveLength(10);
  });

  it('returns bypassPermissions as default permission mode', () => {
    expect(store.getPermissionMode()).toBe('bypassPermissions');
  });

  it('saves and retrieves permission mode', () => {
    store.setPermissionMode('plan');
    expect(store.getPermissionMode()).toBe('plan');
  });

  it('persists to disk and reloads', () => {
    store.addRecentDir('D:\\dev\\Persist');
    const store2 = new SettingsStore(tmpFile);
    expect(store2.getRecentDirs()).toContain('D:\\dev\\Persist');
  });
});

describe('SettingsStore sessions', () => {
  let store: SettingsStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-test-'));
    store = new SettingsStore(path.join(tmpDir, 'settings.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getSessions returns empty array when no file exists', () => {
    const result = store.getSessions(tmpDir);
    expect(result).toEqual([]);
  });

  it('saveSessions writes and getSessions reads back', () => {
    const tabs = [{ name: 'Tab 1', cwd: '/tmp', worktree: null, sessionId: 'abc-123' }];
    store.saveSessions(tmpDir, tabs);
    const result = store.getSessions(tmpDir);
    expect(result).toEqual(tabs);
  });

  it('saveSessions overwrites previous sessions', () => {
    const tabs1 = [{ name: 'Tab 1', cwd: '/tmp', worktree: null, sessionId: 'abc' }];
    const tabs2 = [{ name: 'Tab 2', cwd: '/tmp', worktree: null, sessionId: 'def' }];
    store.saveSessions(tmpDir, tabs1);
    store.saveSessions(tmpDir, tabs2);
    const result = store.getSessions(tmpDir);
    expect(result).toEqual(tabs2);
  });

  it('getSessions returns empty array on corrupted JSON', () => {
    const sessDir = path.join(tmpDir, '.claude-terminal');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'sessions.json'), '{corrupt', 'utf-8');
    const result = store.getSessions(tmpDir);
    expect(result).toEqual([]);
  });

  it('saveSessions does not throw on bad directory', () => {
    // Create a file where saveSessions expects a directory — forces ENOTDIR
    const blockingFile = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blockingFile, '');
    const badDir = path.join(blockingFile, 'sessions');
    expect(() => store.saveSessions(badDir, [{ name: 'x', cwd: '/', worktree: null, sessionId: 'z' }])).not.toThrow();
  });
});
