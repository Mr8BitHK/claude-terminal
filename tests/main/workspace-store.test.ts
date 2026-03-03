// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

vi.mock('@main/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), init: vi.fn() },
}));

import { WorkspaceStore } from '@main/workspace-store';
import type { WorkspaceConfig } from '@shared/types';

describe('WorkspaceStore', () => {
  let tmpDir: string;
  let store: WorkspaceStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
    store = new WorkspaceStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('listWorkspaces returns empty array when no workspaces exist', async () => {
    const list = await store.listWorkspaces();
    expect(list).toEqual([]);
  });

  it('saveWorkspace creates a workspace file', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'Test', projects: [], activeProjectId: '',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    await store.saveWorkspace(ws);
    const list = await store.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Test');
  });

  it('getWorkspace retrieves a saved workspace', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'My Workspace', projects: [
        { id: 'p1', dir: '/test/repo', colorIndex: 0 },
      ], activeProjectId: 'p1',
      geometry: { x: 100, y: 100, width: 1400, height: 900 },
    };
    await store.saveWorkspace(ws);
    const loaded = await store.getWorkspace('ws-1');
    expect(loaded).toEqual(ws);
  });

  it('deleteWorkspace removes the workspace file', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'Temp', projects: [], activeProjectId: '',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    await store.saveWorkspace(ws);
    await store.deleteWorkspace('ws-1');
    const list = await store.listWorkspaces();
    expect(list).toEqual([]);
  });

  it('getWorkspace returns null for non-existent workspace', async () => {
    const loaded = await store.getWorkspace('no-such-id');
    expect(loaded).toBeNull();
  });

  it('saveWorkspace overwrites existing workspace', async () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1', name: 'Original', projects: [], activeProjectId: '',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    await store.saveWorkspace(ws);
    ws.name = 'Updated';
    await store.saveWorkspace(ws);
    const loaded = await store.getWorkspace('ws-1');
    expect(loaded!.name).toBe('Updated');
  });
});
