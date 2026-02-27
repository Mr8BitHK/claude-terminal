import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private data: Record<string, unknown> = {};
      get(key: string, defaultVal?: unknown) { return this.data[key] ?? defaultVal; }
      set(key: string, val: unknown) { this.data[key] = val; }
    },
  };
});

import { SettingsStore } from '@main/settings-store';

describe('SettingsStore', () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = new SettingsStore();
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
});
