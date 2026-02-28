# Repository Hooks System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repository-specific hooks system that lets users configure shell commands to run on app-level events (worktree creation, tab lifecycle, etc.), managed via a GUI dialog and stored in `.claude-terminal/hooks.json`.

**Architecture:** A `HookEngine` class in the main process loads hooks from `{repo}/.claude-terminal/hooks.json`, receives events from existing managers (WorktreeManager, IPC handlers), and executes configured commands sequentially via `cross-spawn`. Status is reported to the renderer via IPC. A `HookManagerDialog` in the renderer provides a GUI for CRUD operations on hooks.

**Tech Stack:** TypeScript, Electron IPC, cross-spawn (cross-platform command execution), tree-kill (process tree cleanup), React (dialog UI), Vitest (tests)

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install cross-spawn and tree-kill**

Run:
```bash
cd /d/dev/claude-terminal/.claude/worktrees/hooks && pnpm add cross-spawn tree-kill
```

**Step 2: Install type definitions**

Run:
```bash
cd /d/dev/claude-terminal/.claude/worktrees/hooks && pnpm add -D @types/cross-spawn
```

Note: `tree-kill` ships its own types.

**Step 3: Verify installation**

Run:
```bash
cd /d/dev/claude-terminal/.claude/worktrees/hooks && node -e "require('cross-spawn'); require('tree-kill'); console.log('OK')"
```
Expected: `OK`

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(hooks): add cross-spawn and tree-kill dependencies"
```

---

### Task 2: Add shared types for hook config

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

**Step 1: Write the failing test**

Add to `tests/shared/types.test.ts`:

```typescript
import { HOOK_EVENTS } from '@shared/types';
import type { RepoHookConfig, RepoHook, HookCommand, HookEvent } from '@shared/types';

describe('RepoHook types', () => {
  it('HOOK_EVENTS contains all supported events', () => {
    expect(HOOK_EVENTS).toContain('worktree:created');
    expect(HOOK_EVENTS).toContain('worktree:removed');
    expect(HOOK_EVENTS).toContain('tab:created');
    expect(HOOK_EVENTS).toContain('tab:closed');
    expect(HOOK_EVENTS).toContain('session:started');
    expect(HOOK_EVENTS).toContain('app:started');
    expect(HOOK_EVENTS).toContain('branch:changed');
    expect(HOOK_EVENTS.length).toBe(7);
  });

  it('RepoHookConfig shape is valid', () => {
    const config: RepoHookConfig = {
      hooks: [
        {
          id: 'test',
          name: 'Test hook',
          event: 'worktree:created',
          commands: [{ path: '.', command: 'echo hello' }],
          enabled: true,
        },
      ],
    };
    expect(config.hooks).toHaveLength(1);
    expect(config.hooks[0].commands[0].path).toBe('.');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/shared/types.test.ts`
Expected: FAIL — `HOOK_EVENTS` is not exported, types don't exist

**Step 3: Write implementation**

Add to the bottom of `src/shared/types.ts`:

```typescript
// --- Repository hooks ---

export const HOOK_EVENTS = [
  'worktree:created',
  'worktree:removed',
  'tab:created',
  'tab:closed',
  'session:started',
  'app:started',
  'branch:changed',
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

export interface HookCommand {
  path: string;
  command: string;
}

export interface RepoHook {
  id: string;
  name: string;
  event: HookEvent;
  commands: HookCommand[];
  enabled: boolean;
}

export interface RepoHookConfig {
  hooks: RepoHook[];
}

// IPC status events for hook execution
export interface HookExecutionStatus {
  hookId: string;
  hookName: string;
  event: HookEvent;
  commandIndex: number;
  totalCommands: number;
  command?: string;
  path?: string;
  status: 'running' | 'done' | 'failed';
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/shared/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat(hooks): add shared types for repository hook config"
```

---

### Task 3: Implement HookConfigStore (load/save hooks.json)

**Files:**
- Create: `src/main/hook-config-store.ts`
- Create: `tests/main/hook-config-store.test.ts`

**Step 1: Write the failing test**

Create `tests/main/hook-config-store.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
```

**Step 2: Run test to verify it fails**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/main/hook-config-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/main/hook-config-store.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import type { RepoHookConfig, RepoHook, HookEvent } from '@shared/types';
import { log } from './logger';

const HOOKS_DIR = '.claude-terminal';
const HOOKS_FILE = 'hooks.json';

export class HookConfigStore {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private filePath(): string {
    return path.join(this.rootDir, HOOKS_DIR, HOOKS_FILE);
  }

  load(): RepoHookConfig {
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.hooks)) {
        return parsed as RepoHookConfig;
      }
      return { hooks: [] };
    } catch {
      return { hooks: [] };
    }
  }

  save(config: RepoHookConfig): void {
    const dir = path.join(this.rootDir, HOOKS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath(), JSON.stringify(config, null, 2), 'utf-8');
    log.debug('[hook-config] saved', config.hooks.length, 'hooks to', this.filePath());
  }

  getHooksForEvent(event: HookEvent): RepoHook[] {
    const config = this.load();
    return config.hooks.filter(h => h.enabled && h.event === event);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/main/hook-config-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/hook-config-store.ts tests/main/hook-config-store.test.ts
git commit -m "feat(hooks): implement HookConfigStore for loading/saving hooks.json"
```

---

### Task 4: Implement HookEngine (command execution)

**Files:**
- Create: `src/main/hook-engine.ts`
- Create: `tests/main/hook-engine.test.ts`

**Step 1: Write the failing test**

Create `tests/main/hook-engine.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('cross-spawn', () => {
  const EventEmitter = require('events');
  return {
    default: vi.fn(() => {
      const proc = new EventEmitter();
      const { Readable } = require('stream');
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.pid = 1234;
      // Auto-complete successfully
      setTimeout(() => {
        proc.stdout.push(null);
        proc.stderr.push(null);
        proc.emit('close', 0, null);
      }, 10);
      return proc;
    }),
  };
});

vi.mock('tree-kill', () => ({
  default: vi.fn((_pid, _signal, cb) => cb?.()),
}));

import { HookEngine } from '@main/hook-engine';
import type { HookConfigStore } from '@main/hook-config-store';
import type { RepoHook } from '@shared/types';

function createMockStore(hooks: RepoHook[]): HookConfigStore {
  return {
    load: vi.fn().mockReturnValue({ hooks }),
    save: vi.fn(),
    getHooksForEvent: vi.fn((event) =>
      hooks.filter(h => h.enabled && h.event === event)
    ),
  } as unknown as HookConfigStore;
}

describe('HookEngine', () => {
  let onStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onStatus = vi.fn();
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

  it('reports failure for non-zero exit code', async () => {
    const spawn = (await import('cross-spawn')).default;
    const EventEmitter = require('events');
    const { Readable } = require('stream');
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.pid = 5678;
      setTimeout(() => {
        proc.stderr.push(Buffer.from('error msg'));
        proc.stderr.push(null);
        proc.stdout.push(null);
        proc.emit('close', 1, null);
      }, 10);
      return proc;
    });

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

    // Second command should NOT have run
    const runCalls = onStatus.mock.calls.filter(
      (c: any[]) => c[0].status === 'running'
    );
    expect(runCalls).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/main/hook-engine.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/main/hook-engine.ts`:

```typescript
import path from 'path';
import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import type { HookConfigStore } from './hook-config-store';
import type { HookEvent, HookExecutionStatus } from '@shared/types';
import { log } from './logger';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface HookContext {
  contextRoot: string;
  [key: string]: string;
}

type StatusCallback = (status: HookExecutionStatus) => void;

export class HookEngine {
  private store: HookConfigStore;
  private onStatus: StatusCallback;

  constructor(store: HookConfigStore, onStatus: StatusCallback) {
    this.store = store;
    this.onStatus = onStatus;
  }

  async emit(event: HookEvent, context: HookContext): Promise<void> {
    const hooks = this.store.getHooksForEvent(event);
    if (hooks.length === 0) return;

    log.info('[hook-engine] firing', event, '— matched', hooks.length, 'hook(s)');

    for (const hook of hooks) {
      for (let i = 0; i < hook.commands.length; i++) {
        const cmd = hook.commands[i];
        const cwd = path.resolve(context.contextRoot, cmd.path);

        this.onStatus({
          hookId: hook.id,
          hookName: hook.name,
          event,
          commandIndex: i,
          totalCommands: hook.commands.length,
          command: cmd.command,
          path: cmd.path,
          status: 'running',
        });

        const result = await this.runCommand(cmd.command, cwd, context);

        if (result.exitCode !== 0) {
          this.onStatus({
            hookId: hook.id,
            hookName: hook.name,
            event,
            commandIndex: i,
            totalCommands: hook.commands.length,
            command: cmd.command,
            path: cmd.path,
            status: 'failed',
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          });
          log.warn('[hook-engine]', hook.name, 'command', i, 'failed with exit code', result.exitCode);
          break; // skip remaining commands
        }

        this.onStatus({
          hookId: hook.id,
          hookName: hook.name,
          event,
          commandIndex: i,
          totalCommands: hook.commands.length,
          command: cmd.command,
          path: cmd.path,
          status: 'done',
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
    }
  }

  private runCommand(
    command: string,
    cwd: string,
    context: HookContext,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; error?: string }> {
    return new Promise((resolve) => {
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        HOOK_EVENT: context.contextRoot ? '' : '',
      };
      // Add all context keys as HOOK_ prefixed env vars
      for (const [key, value] of Object.entries(context)) {
        if (key !== 'contextRoot') {
          env[`HOOK_${key.toUpperCase()}`] = value;
        }
      }

      let child;
      try {
        child = spawn(command, [], { shell: true, cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ exitCode: 1, stdout: '', stderr: '', error: String(err) });
        return;
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timeout = setTimeout(() => {
        if (child.pid) {
          treeKill(child.pid, 'SIGTERM', () => {});
        }
        resolve({ exitCode: null, stdout, stderr, error: 'Command timed out' });
      }, DEFAULT_TIMEOUT_MS);

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({ exitCode: 1, stdout, stderr, error: err.message });
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timeout);
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run tests/main/hook-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/hook-engine.ts tests/main/hook-engine.test.ts
git commit -m "feat(hooks): implement HookEngine for cross-platform command execution"
```

---

### Task 5: Add IPC handlers for hook config CRUD

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add hook config handlers)
- Modify: `src/main/ipc-handlers.ts` (`AppState` gains `hookConfigStore` and `hookEngine`)
- Modify: `src/preload.ts` (expose hook config methods)
- Modify: `src/renderer/global.d.ts` (types auto-derived from preload)

**Step 1: Add hook config IPC handlers to `ipc-handlers.ts`**

In `src/main/ipc-handlers.ts`:

1. Add imports at the top:
```typescript
import type { HookConfigStore } from './hook-config-store';
import type { HookEngine } from './hook-engine';
import type { RepoHookConfig, RepoHook } from '@shared/types';
```

2. Add to `AppState` interface:
```typescript
hookConfigStore: HookConfigStore | null;
hookEngine: HookEngine | null;
```

3. Add to `registerIpcHandlers` function, in the Settings section area:
```typescript
  // ---- Hook Config ----
  ipcMain.handle('hookConfig:load', async () => {
    if (!state.hookConfigStore) throw new Error('Session not started');
    return state.hookConfigStore.load();
  });

  ipcMain.handle('hookConfig:save', async (_event, config: RepoHookConfig) => {
    if (!state.hookConfigStore) throw new Error('Session not started');
    state.hookConfigStore.save(config);
  });
```

**Step 2: Add preload methods to `src/preload.ts`**

Add to the `api` object (after the Settings section):

```typescript
  // Hook config
  getHookConfig: (): Promise<RepoHookConfig> =>
    ipcRenderer.invoke('hookConfig:load'),
  saveHookConfig: (config: RepoHookConfig): Promise<void> =>
    ipcRenderer.invoke('hookConfig:save', config),

  // Hook execution status events
  onHookStatus: (callback: (status: HookExecutionStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: HookExecutionStatus) =>
      callback(status);
    ipcRenderer.on('hook:status', handler);
    return () => {
      ipcRenderer.removeListener('hook:status', handler);
    };
  },
```

Add imports at the top of preload.ts:
```typescript
import type { RepoHookConfig, HookExecutionStatus } from './shared/types';
```

**Step 3: Wire up in `src/main/index.ts`**

1. Add import:
```typescript
import { HookConfigStore } from './hook-config-store';
import { HookEngine } from './hook-engine';
```

2. Add to `state` object:
```typescript
hookConfigStore: null,
hookEngine: null,
```

3. In the `session:start` handler inside `ipc-handlers.ts`, after the `hookInstaller` init:
```typescript
      state.hookConfigStore = new HookConfigStore(dir);
      state.hookEngine = new HookEngine(state.hookConfigStore, (status) => {
        sendToRenderer('hook:status', status);
      });
```

**Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/index.ts src/preload.ts
git commit -m "feat(hooks): add IPC handlers for hook config CRUD and status events"
```

---

### Task 6: Integrate HookEngine with existing managers

**Files:**
- Modify: `src/main/ipc-handlers.ts` (emit events at lifecycle points)

**Step 1: Add hook engine calls to existing IPC handlers**

In `src/main/ipc-handlers.ts`, add `state.hookEngine?.emit()` calls at these points:

1. **worktree:create** handler — after `state.worktreeManager.create(name)`:
```typescript
    // Fire repo hook
    const branch = state.worktreeManager.getCurrentBranch();
    state.hookEngine?.emit('worktree:created', { contextRoot: worktreePath, name, path: worktreePath, branch });
```
Note: `emit` is async but we don't want to block the IPC response. Fire and forget — don't await.

2. **worktree:remove** handler — after `state.worktreeManager.remove(worktreePath)`:
```typescript
    state.hookEngine?.emit('worktree:removed', { contextRoot: state.workspaceDir!, name: path.basename(worktreePath), path: worktreePath });
```

3. **tab:create** handler — after `deps.sendToRenderer('tab:updated', tab)` near the end:
```typescript
    state.hookEngine?.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: 'claude' });
```

4. **tab:close** handler — before `tabManager.removeTab(tabId)`:
```typescript
    const closingTab = tabManager.getTab(tabId);
    if (closingTab) {
      state.hookEngine?.emit('tab:closed', { contextRoot: closingTab.cwd, tabId, cwd: closingTab.cwd });
    }
```

5. **session:start** handler — at the end:
```typescript
    state.hookEngine?.emit('app:started', { contextRoot: dir, cwd: dir });
```

6. **Git branch watcher** — in the `fs.watch` callback, after `deps.sendToRenderer('git:branchChanged', branch)`:
```typescript
              if (branch && state.hookEngine) {
                state.hookEngine.emit('branch:changed', { contextRoot: dir, from: '', to: branch });
              }
```

7. **session:started** event — In the hook-router.ts `tab:ready` handler, after `deps.persistSessions()`, we need access to the hook engine. Add `hookEngine` to `HookRouterDeps` and call:
```typescript
    deps.hookEngine?.emit('session:started', { contextRoot: tab.cwd, tabId, sessionId: sessionId });
```

**Step 2: Update HookRouterDeps interface**

In `src/main/hook-router.ts`, add to the `HookRouterDeps` interface:
```typescript
  hookEngine: { emit: (event: string, context: Record<string, string>) => Promise<void> } | null;
```

And in the `tab:ready` case, after `deps.persistSessions()`:
```typescript
        deps.hookEngine?.emit('session:started' as any, { contextRoot: tab.cwd, tabId, sessionId });
```

**Step 3: Update index.ts to pass hookEngine to createHookRouter**

In `src/main/index.ts`, update `createHookRouter` call:
```typescript
// Move createHookRouter to after session:start so hookEngine is available
// OR make hookEngine a getter — simpler: use a getter pattern
```

Since `hookEngine` is null at startup and created during `session:start`, pass a getter:

In `index.ts`, change the createHookRouter deps to include:
```typescript
  hookEngine: { emit: (...args: any[]) => state.hookEngine?.emit(...args) ?? Promise.resolve() } as any,
```

Actually, simpler approach: just use `state` reference since it's mutable:
```typescript
const { handleHookMessage } = createHookRouter({
  tabManager, sendToRenderer, persistSessions,
  generateTabName, cleanupNamingFlag,
  getMainWindow: () => state.mainWindow as BrowserWindow | null,
  hookEngine: { emit: (event: any, context: any) => state.hookEngine?.emit(event, context) ?? Promise.resolve() } as any,
});
```

**Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/hook-router.ts src/main/index.ts
git commit -m "feat(hooks): integrate HookEngine with worktree, tab, and session lifecycle"
```

---

### Task 7: Build the HookManagerDialog UI

**Files:**
- Create: `src/renderer/components/HookManagerDialog.tsx`
- Modify: `src/renderer/index.css` (add styles)

**Step 1: Create the dialog component**

Create `src/renderer/components/HookManagerDialog.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Zap } from 'lucide-react';
import type { RepoHook, RepoHookConfig, HookCommand, HookEvent } from '../../shared/types';
import { HOOK_EVENTS } from '../../shared/types';

interface HookManagerDialogProps {
  onClose: () => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function createEmptyHook(): RepoHook {
  return {
    id: generateId(),
    name: 'New Hook',
    event: 'worktree:created',
    commands: [{ path: '.', command: '' }],
    enabled: true,
  };
}

export default function HookManagerDialog({ onClose }: HookManagerDialogProps) {
  const [config, setConfig] = useState<RepoHookConfig>({ hooks: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const loaded = await window.claudeTerminal.getHookConfig();
      setConfig(loaded);
      if (loaded.hooks.length > 0) {
        setSelectedId(loaded.hooks[0].id);
      }
      setLoading(false);
    })();
  }, []);

  const selected = config.hooks.find(h => h.id === selectedId) ?? null;

  const updateHook = useCallback((hookId: string, updates: Partial<RepoHook>) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h => h.id === hookId ? { ...h, ...updates } : h),
    }));
    setDirty(true);
  }, []);

  const addHook = useCallback(() => {
    const hook = createEmptyHook();
    setConfig(prev => ({ hooks: [...prev.hooks, hook] }));
    setSelectedId(hook.id);
    setDirty(true);
  }, []);

  const deleteHook = useCallback((hookId: string) => {
    setConfig(prev => {
      const hooks = prev.hooks.filter(h => h.id !== hookId);
      if (selectedId === hookId) {
        setSelectedId(hooks.length > 0 ? hooks[0].id : null);
      }
      return { hooks };
    });
    setDirty(true);
  }, [selectedId]);

  const addCommand = useCallback((hookId: string) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: [...h.commands, { path: '.', command: '' }] }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const updateCommand = useCallback((hookId: string, idx: number, updates: Partial<HookCommand>) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: h.commands.map((c, i) => i === idx ? { ...c, ...updates } : c) }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const removeCommand = useCallback((hookId: string, idx: number) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: h.commands.filter((_, i) => i !== idx) }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const moveCommand = useCallback((hookId: string, idx: number, direction: -1 | 1) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h => {
        if (h.id !== hookId) return h;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= h.commands.length) return h;
        const cmds = [...h.commands];
        [cmds[idx], cmds[newIdx]] = [cmds[newIdx], cmds[idx]];
        return { ...h, commands: cmds };
      }),
    }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    await window.claudeTerminal.saveHookConfig(config);
    setDirty(false);
  };

  if (loading) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog hook-dialog" onClick={e => e.stopPropagation()}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog hook-dialog" onClick={e => e.stopPropagation()}>
        <h2>Manage Hooks</h2>
        <div className="hook-layout">
          {/* Left panel: hook list */}
          <div className="hook-list-panel">
            <div className="hook-list">
              {config.hooks.map(hook => (
                <div
                  key={hook.id}
                  className={`hook-list-item ${hook.id === selectedId ? 'hook-list-item-active' : ''}`}
                  onClick={() => setSelectedId(hook.id)}
                >
                  <div className="hook-list-item-info">
                    <span className="hook-list-item-name">{hook.name}</span>
                    <span className={`hook-badge hook-badge-${hook.event.split(':')[0]}`}>
                      {hook.event}
                    </span>
                  </div>
                  <label className="hook-toggle" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={hook.enabled}
                      onChange={e => updateHook(hook.id, { enabled: e.target.checked })}
                    />
                    <span className="hook-toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
            <button className="hook-add-btn" onClick={addHook}>
              <Plus size={14} /> Add Hook
            </button>
          </div>

          {/* Right panel: hook editor */}
          <div className="hook-editor-panel">
            {selected ? (
              <>
                <div className="hook-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={selected.name}
                    onChange={e => updateHook(selected.id, { name: e.target.value })}
                  />
                </div>
                <div className="hook-field">
                  <label>Event</label>
                  <select
                    value={selected.event}
                    onChange={e => updateHook(selected.id, { event: e.target.value as HookEvent })}
                  >
                    {HOOK_EVENTS.map(ev => (
                      <option key={ev} value={ev}>{ev}</option>
                    ))}
                  </select>
                </div>
                <div className="hook-field">
                  <label>Commands</label>
                  <div className="hook-commands">
                    {selected.commands.map((cmd, idx) => (
                      <div key={idx} className="hook-command-row">
                        <input
                          type="text"
                          className="hook-cmd-path"
                          placeholder="path"
                          value={cmd.path}
                          onChange={e => updateCommand(selected.id, idx, { path: e.target.value })}
                        />
                        <input
                          type="text"
                          className="hook-cmd-command"
                          placeholder="command"
                          value={cmd.command}
                          onChange={e => updateCommand(selected.id, idx, { command: e.target.value })}
                        />
                        <button
                          className="hook-cmd-btn"
                          onClick={() => moveCommand(selected.id, idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          className="hook-cmd-btn"
                          onClick={() => moveCommand(selected.id, idx, 1)}
                          disabled={idx === selected.commands.length - 1}
                          title="Move down"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          className="hook-cmd-btn hook-cmd-delete"
                          onClick={() => removeCommand(selected.id, idx)}
                          disabled={selected.commands.length <= 1}
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button className="hook-add-cmd-btn" onClick={() => addCommand(selected.id)}>
                      <Plus size={12} /> Add Command
                    </button>
                  </div>
                </div>
                <button className="hook-delete-hook-btn" onClick={() => deleteHook(selected.id)}>
                  <Trash2 size={14} /> Delete Hook
                </button>
              </>
            ) : (
              <div className="hook-empty">
                <Zap size={32} />
                <p>No hooks configured.</p>
                <p>Click "Add Hook" to get started.</p>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          {dirty && (
            <button className="hook-save-btn" onClick={handleSave}>Save</button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add CSS styles**

Append to `src/renderer/index.css`:

```css
/* ---- Hook Manager Dialog ---- */
.hook-dialog { width: 700px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; }
.hook-layout { display: flex; gap: 12px; flex: 1; min-height: 300px; overflow: hidden; }

.hook-list-panel { width: 220px; display: flex; flex-direction: column; border-right: 1px solid #3c3c3c; padding-right: 12px; }
.hook-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.hook-list-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.hook-list-item:hover { background: #2a2d2e; }
.hook-list-item-active { background: #37373d; }
.hook-list-item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hook-list-item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hook-badge { font-size: 10px; padding: 1px 4px; border-radius: 3px; background: #3c3c3c; color: #9cdcfe; white-space: nowrap; }

.hook-toggle { position: relative; display: inline-block; width: 28px; height: 16px; flex-shrink: 0; }
.hook-toggle input { opacity: 0; width: 0; height: 0; }
.hook-toggle-slider { position: absolute; inset: 0; background: #555; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
.hook-toggle-slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: #ccc; transition: transform 0.2s; }
.hook-toggle input:checked + .hook-toggle-slider { background: #4caf50; }
.hook-toggle input:checked + .hook-toggle-slider::before { transform: translateX(12px); }

.hook-add-btn { margin-top: 8px; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: #0e639c; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
.hook-add-btn:hover { background: #1177bb; }

.hook-editor-panel { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.hook-field { display: flex; flex-direction: column; gap: 4px; }
.hook-field label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.hook-field input[type="text"], .hook-field select { background: #3c3c3c; border: 1px solid #555; color: #d4d4d4; padding: 6px 8px; border-radius: 4px; font-size: 13px; font-family: inherit; }
.hook-field input[type="text"]:focus, .hook-field select:focus { outline: none; border-color: #0e639c; }

.hook-commands { display: flex; flex-direction: column; gap: 4px; }
.hook-command-row { display: flex; gap: 4px; align-items: center; }
.hook-cmd-path { width: 100px; flex-shrink: 0; }
.hook-cmd-command { flex: 1; }
.hook-cmd-btn { background: none; border: 1px solid #555; color: #888; padding: 4px; border-radius: 3px; cursor: pointer; display: flex; align-items: center; }
.hook-cmd-btn:hover:not(:disabled) { color: #d4d4d4; border-color: #888; }
.hook-cmd-btn:disabled { opacity: 0.3; cursor: default; }
.hook-cmd-delete:hover:not(:disabled) { color: #f44; border-color: #f44; }

.hook-add-cmd-btn { display: flex; align-items: center; gap: 4px; padding: 4px 8px; background: none; border: 1px dashed #555; color: #888; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: 4px; }
.hook-add-cmd-btn:hover { color: #d4d4d4; border-color: #888; }

.hook-delete-hook-btn { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: none; border: 1px solid #555; color: #f44; border-radius: 4px; cursor: pointer; font-size: 12px; margin-top: auto; align-self: flex-start; }
.hook-delete-hook-btn:hover { background: rgba(255, 68, 68, 0.1); border-color: #f44; }

.hook-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #666; gap: 8px; }
.hook-empty p { font-size: 13px; }

.hook-save-btn { background: #4caf50; border: none; color: #fff; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.hook-save-btn:hover { background: #45a049; }
```

**Step 3: Commit**

```bash
git add src/renderer/components/HookManagerDialog.tsx src/renderer/index.css
git commit -m "feat(hooks): add HookManagerDialog UI component with styles"
```

---

### Task 8: Wire HookManagerDialog into the app

**Files:**
- Modify: `src/renderer/App.tsx` (add state + render dialog)
- Modify: `src/renderer/components/HamburgerMenu.tsx` (add menu item)
- Modify: `src/renderer/components/TabBar.tsx` (pass through prop)

**Step 1: Add to HamburgerMenu**

In `src/renderer/components/HamburgerMenu.tsx`:

1. Add import: `import { Menu, GitBranch, Zap } from 'lucide-react';`

2. Add `onManageHooks` prop:
```typescript
interface HamburgerMenuProps {
  worktreeCount: number;
  onManageWorktrees: () => void;
  onManageHooks: () => void;
}
```

3. Add the menu item after the worktree button:
```tsx
          <button
            className="hamburger-item"
            onClick={() => { setOpen(false); onManageHooks(); }}
          >
            <Zap size={14} />
            <span>Manage hooks</span>
          </button>
```

**Step 2: Thread through TabBar**

In `src/renderer/components/TabBar.tsx`:

1. Add `onManageHooks: () => void;` to `TabBarProps`
2. Destructure it in the component
3. Pass to `<HamburgerMenu onManageHooks={onManageHooks} ... />`

**Step 3: Wire up in App.tsx**

In `src/renderer/App.tsx`:

1. Add import:
```typescript
import HookManagerDialog from './components/HookManagerDialog';
```

2. Add state:
```typescript
const [showHookManager, setShowHookManager] = useState(false);
```

3. Pass to TabBar:
```tsx
<TabBar
  ...existing props...
  onManageHooks={() => setShowHookManager(true)}
/>
```

4. Render dialog (after WorktreeCloseDialog):
```tsx
{showHookManager && (
  <HookManagerDialog onClose={() => setShowHookManager(false)} />
)}
```

**Step 4: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/HamburgerMenu.tsx src/renderer/components/TabBar.tsx
git commit -m "feat(hooks): wire HookManagerDialog into hamburger menu and App"
```

---

### Task 9: Run all tests and verify

**Step 1: Run the full test suite**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx vitest run`
Expected: All tests pass

**Step 2: Fix any failures**

If any tests fail, fix them.

**Step 3: Run TypeScript type check**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and type issues from hooks integration"
```

---

### Task 10: Manual smoke test

**Step 1: Start the app**

Run: `cd /d/dev/claude-terminal/.claude/worktrees/hooks && npm start`

**Step 2: Verify hamburger menu shows "Manage hooks"**

Click the hamburger menu → "Manage hooks" should open the dialog.

**Step 3: Create a test hook**

- Click "Add Hook"
- Name: "Test Hook"
- Event: `worktree:created`
- Command path: `.`
- Command: `echo "hook ran"` (or `echo hook ran` on Windows)
- Toggle enabled on
- Click Save

**Step 4: Verify hooks.json was created**

Check that `.claude-terminal/hooks.json` exists in the workspace directory with the hook config.

**Step 5: Create a worktree to trigger the hook**

Create a new worktree tab. Check the console/logs for hook execution status messages.

**Step 6: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: smoke test fixes for hooks system"
```
