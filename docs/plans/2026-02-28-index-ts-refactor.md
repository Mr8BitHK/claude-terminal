# index.ts Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the 649-line index.ts god file into 4 focused, testable modules.

**Architecture:** Dependency injection via interfaces — each module receives its deps as arguments, not singletons. A shared `AppState` object holds mutable state that index.ts owns and passes by reference. Factory functions (`createTabNamer`, `createHookRouter`) return closures over deps.

**Tech Stack:** TypeScript, Vitest, Electron IPC (`ipcMain`)

---

### Task 1: Create `src/shared/claude-cli.ts`

**Files:**
- Create: `src/shared/claude-cli.ts`
- Test: `tests/shared/claude-cli.test.ts`

**Step 1: Write the failing test**

Create `tests/shared/claude-cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getClaudeCommand } from '@shared/claude-cli';

describe('getClaudeCommand', () => {
  it('returns command and args with flags', () => {
    const result = getClaudeCommand(['--dangerously-skip-permissions']);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.command).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude', '--dangerously-skip-permissions']);
    } else {
      expect(result.command).toBe('claude');
      expect(result.args).toEqual(['--dangerously-skip-permissions']);
    }
  });

  it('returns command with empty flags', () => {
    const result = getClaudeCommand([]);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.command).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude']);
    } else {
      expect(result.command).toBe('claude');
      expect(result.args).toEqual([]);
    }
  });

  it('preserves multiple flags in order', () => {
    const result = getClaudeCommand(['-p', '--model', 'claude-haiku-4-5-20251001']);
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      expect(result.args).toEqual(['/c', 'claude', '-p', '--model', 'claude-haiku-4-5-20251001']);
    } else {
      expect(result.args).toEqual(['-p', '--model', 'claude-haiku-4-5-20251001']);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/claude-cli.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/shared/claude-cli.ts`:

```ts
export function getClaudeCommand(flags: string[]): { command: string; args: string[] } {
  const isWindows = process.platform === 'win32';
  return isWindows
    ? { command: 'cmd.exe', args: ['/c', 'claude', ...flags] }
    : { command: 'claude', args: flags };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/claude-cli.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```
git add src/shared/claude-cli.ts tests/shared/claude-cli.test.ts
git commit -m "feat: extract shared claude-cli helper (closes #7)"
```

---

### Task 2: Create `src/main/tab-namer.ts`

**Files:**
- Create: `src/main/tab-namer.ts`
- Test: `tests/main/tab-namer.test.ts`

**Step 1: Write the failing test**

Create `tests/main/tab-namer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock child_process.execFile
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockChild = { stdin: mockStdin, pid: 9999 };
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => {
    // Default: simulate successful response after next tick
    setTimeout(() => cb(null, '  Fix Auth Bug  ', ''), 0);
    return mockChild;
  }),
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

  it('writes prompt to stdin', () => {
    const deps = makeMockDeps();
    const { generateTabName } = createTabNamer(deps);

    generateTabName('tab-1', 'Hello world');

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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/tab-namer.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/main/tab-namer.ts`:

```ts
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClaudeCommand } from '@shared/claude-cli';
import { log } from './logger';
import type { TabManager } from './tab-manager';

export interface TabNamerDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
}

export function createTabNamer(deps: TabNamerDeps) {
  function cleanupNamingFlag(tabId: string) {
    const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tabId}`);
    try { fs.unlinkSync(flagFile); } catch { /* best-effort */ }
  }

  function generateTabName(tabId: string, prompt: string) {
    log.debug('[generateTabName] starting for tab', tabId, 'prompt:', prompt.substring(0, 80));
    const namePrompt = `Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:\n\n${prompt}`;

    const { command: cmd, args: baseArgs } = getClaudeCommand([
      '-p', '--no-session-persistence', '--model', 'claude-haiku-4-5-20251001',
    ]);

    log.debug('[generateTabName] spawning:', cmd, baseArgs.join(' '));
    const isWindows = process.platform === 'win32';
    const child = execFile(cmd, baseArgs, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        log.error('[generateTabName] FAILED:', err.message);
        log.error('[generateTabName] stderr:', stderr);
        if (child.pid) {
          if (isWindows) {
            try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* best effort */ }
          } else {
            child.kill('SIGKILL');
          }
        }
        return;
      }
      log.debug('[generateTabName] stdout:', JSON.stringify(stdout));

      const name = stdout.trim().replace(/^["']|["']$/g, '').substring(0, 50);
      if (!name) return;

      const tab = deps.tabManager.getTab(tabId);
      if (!tab) return;

      deps.tabManager.rename(tabId, name);
      const updated = deps.tabManager.getTab(tabId);
      if (updated) {
        deps.sendToRenderer('tab:updated', updated);
        deps.persistSessions();
      }
    });

    child.stdin?.write(namePrompt);
    child.stdin?.end();
  }

  return { generateTabName, cleanupNamingFlag };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/tab-namer.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```
git add src/main/tab-namer.ts tests/main/tab-namer.test.ts
git commit -m "feat: extract tab-namer module from index.ts"
```

---

### Task 3: Create `src/main/hook-router.ts`

**Files:**
- Create: `src/main/hook-router.ts`
- Test: `tests/main/hook-router.test.ts`

**Step 1: Write the failing test**

Create `tests/main/hook-router.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron Notification
vi.mock('electron', () => ({
  Notification: Object.assign(
    vi.fn(() => ({
      on: vi.fn(),
      show: vi.fn(),
    })),
    { isSupported: vi.fn(() => true) },
  ),
}));

import { createHookRouter } from '@main/hook-router';
import type { TabManager } from '@main/tab-manager';
import type { IpcMessage } from '@shared/types';

function makeMockDeps() {
  const tabManager = {
    getTab: vi.fn(),
    getActiveTabId: vi.fn(() => 'active-tab'),
    updateStatus: vi.fn(),
    rename: vi.fn(),
    resetName: vi.fn(),
    setSessionId: vi.fn(),
  } as unknown as TabManager;

  return {
    tabManager,
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    generateTabName: vi.fn(),
    cleanupNamingFlag: vi.fn(),
    getMainWindow: vi.fn(() => ({ show: vi.fn(), focus: vi.fn() })),
  };
}

describe('hook-router', () => {
  let deps: ReturnType<typeof makeMockDeps>;
  let handleHookMessage: (msg: IpcMessage) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeMockDeps();
    ({ handleHookMessage } = createHookRouter(deps));
  });

  it('ignores messages for unknown tabs', () => {
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    handleHookMessage({ tabId: 'no-such-tab', event: 'tab:status:working', data: null });

    expect(deps.tabManager.updateStatus).not.toHaveBeenCalled();
    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  describe('tab:ready', () => {
    it('sets status to new and stores sessionId', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      const data = JSON.stringify({ sessionId: 'sess-abc', source: 'startup' });
      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'new');
      expect(deps.tabManager.setSessionId).toHaveBeenCalledWith('tab-1', 'sess-abc');
      expect(deps.persistSessions).toHaveBeenCalled();
      expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
    });

    it('resets name on /clear', () => {
      const tab = { id: 'tab-1', name: 'Old Name' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      const data = JSON.stringify({ sessionId: 'sess-new', source: 'clear' });
      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data });

      expect(deps.tabManager.resetName).toHaveBeenCalledWith('tab-1');
      expect(deps.cleanupNamingFlag).toHaveBeenCalledWith('tab-1');
    });

    it('handles legacy data (plain sessionId string)', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      handleHookMessage({ tabId: 'tab-1', event: 'tab:ready', data: 'sess-legacy' });

      expect(deps.tabManager.setSessionId).toHaveBeenCalledWith('tab-1', 'sess-legacy');
    });
  });

  describe('status events', () => {
    it('tab:status:working sets working status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:working', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'working');
      expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
    });

    it('tab:status:idle sets idle status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);
      (deps.tabManager.getActiveTabId as ReturnType<typeof vi.fn>).mockReturnValue('tab-1');

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:idle', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'idle');
    });

    it('tab:status:input sets requires_response status', () => {
      const tab = { id: 'tab-1', name: 'Tab 1' };
      (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);
      (deps.tabManager.getActiveTabId as ReturnType<typeof vi.fn>).mockReturnValue('tab-1');

      handleHookMessage({ tabId: 'tab-1', event: 'tab:status:input', data: null });

      expect(deps.tabManager.updateStatus).toHaveBeenCalledWith('tab-1', 'requires_response');
    });
  });

  it('tab:closed is a no-op (waits for onExit)', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:closed', data: null });

    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  it('tab:name renames and persists', () => {
    const tab = { id: 'tab-1', name: 'New Name' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:name', data: 'New Name' });

    expect(deps.tabManager.rename).toHaveBeenCalledWith('tab-1', 'New Name');
    expect(deps.persistSessions).toHaveBeenCalled();
    expect(deps.sendToRenderer).toHaveBeenCalledWith('tab:updated', tab);
  });

  it('tab:generate-name delegates to generateTabName', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'tab:generate-name', data: 'Fix the auth' });

    expect(deps.generateTabName).toHaveBeenCalledWith('tab-1', 'Fix the auth');
    // Should NOT broadcast tab:updated (async call will do it later)
    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });

  it('unknown events are ignored', () => {
    const tab = { id: 'tab-1', name: 'Tab 1' };
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue(tab);

    handleHookMessage({ tabId: 'tab-1', event: 'unknown:event', data: null });

    expect(deps.sendToRenderer).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/hook-router.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/main/hook-router.ts`:

```ts
import { Notification } from 'electron';
import type { IpcMessage } from '@shared/types';
import type { TabManager } from './tab-manager';
import { log } from './logger';

export interface HookRouterDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  generateTabName: (tabId: string, prompt: string) => void;
  cleanupNamingFlag: (tabId: string) => void;
  getMainWindow: () => { show: () => void; focus: () => void } | null;
}

export function createHookRouter(deps: HookRouterDeps) {
  function notifyTabActivity(tabId: string, title: string, body: string) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({ title, body });
    notification.on('click', () => {
      const win = deps.getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
      deps.tabManager.setActiveTab(tabId);
      const tab = deps.tabManager.getTab(tabId);
      if (tab) {
        deps.sendToRenderer('tab:updated', tab);
      }
    });
    notification.show();
  }

  function handleHookMessage(msg: IpcMessage) {
    const { tabId, event, data } = msg;
    log.debug('[hook]', event, tabId, data ? data.substring(0, 80) : null);
    const tab = deps.tabManager.getTab(tabId);
    if (!tab) return;

    const isActive = deps.tabManager.getActiveTabId() === tabId;

    switch (event) {
      case 'tab:ready': {
        let sessionId = '';
        let source = '';
        try {
          const parsed = JSON.parse(data ?? '');
          sessionId = parsed.sessionId || '';
          source = parsed.source || '';
        } catch {
          sessionId = data ?? '';
        }
        log.info('[tab:ready]', tabId, 'sessionId:', sessionId, 'source:', source);

        if (source === 'clear') {
          log.info('[tab:ready] /clear detected for', tabId, '— resetting name');
          deps.tabManager.resetName(tabId);
          deps.cleanupNamingFlag(tabId);
        }

        deps.tabManager.updateStatus(tabId, 'new');
        if (sessionId) {
          deps.tabManager.setSessionId(tabId, sessionId);
        }
        deps.persistSessions();
        break;
      }

      case 'tab:status:working':
        deps.tabManager.updateStatus(tabId, 'working');
        break;

      case 'tab:status:idle':
        deps.tabManager.updateStatus(tabId, 'idle');
        if (!isActive && tab) {
          notifyTabActivity(tabId, tab.name, 'Claude has finished working');
        }
        break;

      case 'tab:status:input':
        deps.tabManager.updateStatus(tabId, 'requires_response');
        if (!isActive && tab) {
          notifyTabActivity(tabId, tab.name, 'Claude needs your input');
        }
        break;

      case 'tab:closed':
        log.debug('[tab:closed] SessionEnd for', tabId, '(waiting for onExit or tab:ready)');
        return;

      case 'tab:name':
        if (data) {
          deps.tabManager.rename(tabId, data);
          deps.persistSessions();
        }
        break;

      case 'tab:generate-name':
        if (data) {
          deps.generateTabName(tabId, data);
        }
        return;

      default:
        return;
    }

    const updated = deps.tabManager.getTab(tabId);
    if (updated) {
      deps.sendToRenderer('tab:updated', updated);
    }
  }

  return { handleHookMessage };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/hook-router.test.ts`
Expected: PASS (10 tests)

**Step 5: Commit**

```
git add src/main/hook-router.ts tests/main/hook-router.test.ts
git commit -m "feat: extract hook-router module from index.ts"
```

---

### Task 4: Create `src/main/ipc-handlers.ts`

**Files:**
- Create: `src/main/ipc-handlers.ts`
- Test: `tests/main/ipc-handlers.test.ts`

**Step 1: Write the failing test**

Create `tests/main/ipc-handlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture ipcMain registrations
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      listeners.set(channel, handler);
    }),
  },
  app: {
    isPackaged: false,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

import { registerIpcHandlers, type IpcHandlerDeps } from '@main/ipc-handlers';
import type { TabManager } from '@main/tab-manager';
import type { PtyManager } from '@main/pty-manager';
import type { SettingsStore } from '@main/settings-store';

function makeMockDeps(): IpcHandlerDeps {
  const mockProc = {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn(),
  };

  return {
    tabManager: {
      createTab: vi.fn(() => ({ id: 'tab-1', name: 'Tab 1', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getTab: vi.fn((id: string) => ({ id, name: 'Tab 1', cwd: '/test', worktree: null, pid: null, type: 'claude' })),
      getAllTabs: vi.fn(() => []),
      removeTab: vi.fn(),
      setActiveTab: vi.fn(),
      rename: vi.fn(),
      getActiveTabId: vi.fn(() => 'tab-1'),
      insertTabAfter: vi.fn(),
    } as unknown as TabManager,
    ptyManager: {
      spawn: vi.fn(() => mockProc),
      spawnShell: vi.fn(() => mockProc),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    } as unknown as PtyManager,
    settings: {
      setPermissionMode: vi.fn(),
      getSessions: vi.fn(() => []),
      addRecentDir: vi.fn(),
      getRecentDirs: vi.fn(() => []),
      removeRecentDir: vi.fn(),
      getPermissionMode: vi.fn(() => 'bypassPermissions'),
    } as unknown as SettingsStore,
    state: {
      workspaceDir: null,
      permissionMode: 'bypassPermissions' as const,
      worktreeManager: null,
      hookInstaller: null,
      mainWindow: null,
      cliStartDir: null,
    },
    sendToRenderer: vi.fn(),
    persistSessions: vi.fn(),
    cleanupNamingFlag: vi.fn(),
  };
}

describe('registerIpcHandlers', () => {
  let deps: IpcHandlerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    listeners.clear();
    deps = makeMockDeps();
    registerIpcHandlers(deps);
  });

  it('registers all expected channels', () => {
    const expectedHandlers = [
      'session:start', 'session:getSavedTabs',
      'tab:create', 'tab:createShell', 'tab:close', 'tab:switch', 'tab:rename', 'tab:getAll', 'tab:getActiveId',
      'worktree:create', 'worktree:currentBranch', 'worktree:listDetails', 'worktree:remove',
      'settings:recentDirs', 'settings:removeRecentDir', 'settings:permissionMode',
      'dialog:selectDirectory', 'cli:getStartDir',
    ];
    for (const channel of expectedHandlers) {
      expect(handlers.has(channel), `missing handler: ${channel}`).toBe(true);
    }

    expect(listeners.has('pty:write')).toBe(true);
    expect(listeners.has('pty:resize')).toBe(true);
    expect(listeners.has('window:setTitle')).toBe(true);
  });

  it('session:start sets workspace dir and permission mode', async () => {
    const handler = handlers.get('session:start')!;
    await handler({}, '/test/dir', 'plan');

    expect(deps.state.workspaceDir).toBe('/test/dir');
    expect(deps.state.permissionMode).toBe('plan');
    expect(deps.settings.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('tab:close kills pty and removes tab', async () => {
    const handler = handlers.get('tab:close')!;
    await handler({}, 'tab-1');

    expect(deps.ptyManager.kill).toHaveBeenCalledWith('tab-1');
    expect(deps.cleanupNamingFlag).toHaveBeenCalledWith('tab-1');
  });

  it('tab:switch delegates to tabManager', async () => {
    const handler = handlers.get('tab:switch')!;
    await handler({}, 'tab-2');

    expect(deps.tabManager.setActiveTab).toHaveBeenCalledWith('tab-2');
  });

  it('tab:rename renames and broadcasts', async () => {
    const handler = handlers.get('tab:rename')!;
    await handler({}, 'tab-1', 'New Name');

    expect(deps.tabManager.rename).toHaveBeenCalledWith('tab-1', 'New Name');
    expect(deps.sendToRenderer).toHaveBeenCalled();
    expect(deps.persistSessions).toHaveBeenCalled();
  });

  it('pty:write forwards to ptyManager', () => {
    const listener = listeners.get('pty:write')!;
    listener({}, 'tab-1', 'hello');

    expect(deps.ptyManager.write).toHaveBeenCalledWith('tab-1', 'hello');
  });

  it('pty:resize forwards to ptyManager', () => {
    const listener = listeners.get('pty:resize')!;
    listener({}, 'tab-1', 120, 40);

    expect(deps.ptyManager.resize).toHaveBeenCalledWith('tab-1', 120, 40);
  });

  it('cli:getStartDir returns cliStartDir from state', async () => {
    deps.state.cliStartDir = '/some/path';
    const handler = handlers.get('cli:getStartDir')!;
    const result = await handler({});

    expect(result).toBe('/some/path');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-handlers.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/main/ipc-handlers.ts`:

```ts
import { app, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PermissionMode } from '@shared/types';
import { PERMISSION_FLAGS } from '@shared/types';
import { WorktreeManager } from './worktree-manager';
import { HookInstaller } from './hook-installer';
import type { TabManager } from './tab-manager';
import type { PtyManager } from './pty-manager';
import type { SettingsStore } from './settings-store';
import { log } from './logger';

export interface AppState {
  workspaceDir: string | null;
  permissionMode: PermissionMode;
  worktreeManager: WorktreeManager | null;
  hookInstaller: HookInstaller | null;
  mainWindow: { setTitle: (title: string) => void } | null;
  cliStartDir: string | null;
}

export interface IpcHandlerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  settings: SettingsStore;
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  cleanupNamingFlag: (tabId: string) => void;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { tabManager, ptyManager, settings, state } = deps;

  // ---- Session ----
  ipcMain.handle(
    'session:start',
    async (_event, dir: string, mode: PermissionMode) => {
      state.workspaceDir = dir;
      state.permissionMode = mode;
      settings.setPermissionMode(mode);
      state.worktreeManager = new WorktreeManager(dir);
      const projectRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'hooks')
        : path.join(__dirname, '..', '..', 'src', 'hooks');
      log.debug('[session:start] __dirname:', __dirname);
      log.debug('[session:start] hooksDir:', projectRoot);
      log.debug('[session:start] hooks exist:', fs.existsSync(path.join(projectRoot, 'pipe-send.js')));
      state.hookInstaller = new HookInstaller(projectRoot);
    },
  );

  ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
    return settings.getSessions(dir);
  });

  // ---- Tabs ----
  ipcMain.handle('tab:create', async (_event, worktreeName: string | null, resumeSessionId?: string, savedName?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');
    const cwd = worktreeName
      ? path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName)
      : state.workspaceDir;
    const tab = tabManager.createTab(cwd, worktreeName, 'claude', savedName);

    if (savedName) {
      const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tab.id}`);
      fs.writeFileSync(flagFile, '');
    }

    if (state.hookInstaller) {
      state.hookInstaller.install(cwd);
    }

    const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? [])];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    const extraEnv: Record<string, string> = {
      CLAUDE_TERMINAL_TAB_ID: tab.id,
      CLAUDE_TERMINAL_PIPE: state.pipeName ?? '',
      CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
    };

    const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
    tab.pid = proc.pid;

    settings.addRecentDir(state.workspaceDir);

    proc.onData((data: string) => {
      deps.sendToRenderer('pty:data', tab.id, data);
    });

    proc.onExit(() => {
      if (tabManager.getTab(tab.id)) {
        deps.cleanupNamingFlag(tab.id);
        tabManager.removeTab(tab.id);
        deps.sendToRenderer('tab:removed', tab.id);
        deps.persistSessions();
      }
    });

    if (tabManager.getAllTabs().length === 1) {
      tabManager.setActiveTab(tab.id);
    }

    deps.sendToRenderer('tab:updated', tab);
    deps.persistSessions();
    return tab;
  });

  ipcMain.handle('tab:createShell', async (_event, shellType: 'powershell' | 'wsl', afterTabId?: string) => {
    if (!state.workspaceDir) throw new Error('Session not started');

    let cwd = state.workspaceDir;
    if (afterTabId) {
      const parentTab = tabManager.getTab(afterTabId);
      if (parentTab) {
        cwd = parentTab.cwd;
      }
    }

    const tab = tabManager.createTab(cwd, null, shellType);

    if (afterTabId) {
      tabManager.removeTab(tab.id);
      tabManager.insertTabAfter(afterTabId, tab);
    }

    const proc = ptyManager.spawnShell(tab.id, cwd, shellType);
    tab.pid = proc.pid;

    proc.onData((data: string) => {
      deps.sendToRenderer('pty:data', tab.id, data);
    });

    proc.onExit(() => {
      if (tabManager.getTab(tab.id)) {
        tabManager.removeTab(tab.id);
        deps.sendToRenderer('tab:removed', tab.id);
        deps.persistSessions();
      }
    });

    tabManager.setActiveTab(tab.id);

    deps.sendToRenderer('tab:updated', tab);
    return tab;
  });

  ipcMain.handle('tab:close', async (_event, tabId: string) => {
    ptyManager.kill(tabId);
    deps.cleanupNamingFlag(tabId);
    const tab = tabManager.getTab(tabId);
    if (tab?.worktree && state.worktreeManager) {
      try {
        state.worktreeManager.remove(tab.cwd);
      } catch {
        // worktree removal is best-effort
      }
    }
    if (tabManager.getTab(tabId)) {
      tabManager.removeTab(tabId);
      deps.sendToRenderer('tab:removed', tabId);
      deps.persistSessions();
    }
  });

  ipcMain.handle('tab:switch', async (_event, tabId: string) => {
    tabManager.setActiveTab(tabId);
  });

  ipcMain.handle(
    'tab:rename',
    async (_event, tabId: string, name: string) => {
      tabManager.rename(tabId, name);
      const tab = tabManager.getTab(tabId);
      if (tab) {
        deps.sendToRenderer('tab:updated', tab);
        deps.persistSessions();
      }
    },
  );

  ipcMain.handle('tab:getAll', async () => {
    return tabManager.getAllTabs();
  });

  ipcMain.handle('tab:getActiveId', async () => {
    return tabManager.getActiveTabId();
  });

  // ---- Worktree ----
  ipcMain.handle('worktree:create', async (_event, name: string) => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.create(name);
  });

  ipcMain.handle('worktree:currentBranch', async () => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.getCurrentBranch();
  });

  ipcMain.handle('worktree:listDetails', async () => {
    if (!state.worktreeManager) throw new Error('Session not started');
    return state.worktreeManager.listDetails();
  });

  ipcMain.handle('worktree:remove', async (_event, worktreePath: string) => {
    if (!state.worktreeManager) throw new Error('Session not started');
    state.worktreeManager.remove(worktreePath);
  });

  // ---- Settings ----
  ipcMain.handle('settings:recentDirs', async () => {
    return settings.getRecentDirs();
  });

  ipcMain.handle('settings:removeRecentDir', async (_event, dir: string) => {
    settings.removeRecentDir(dir);
  });

  ipcMain.handle('settings:permissionMode', async () => {
    return settings.getPermissionMode();
  });

  // ---- Dialog ----
  ipcMain.handle('dialog:selectDirectory', async () => {
    if (!state.mainWindow) return null;
    const result = await dialog.showOpenDialog(state.mainWindow as any, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- CLI ----
  ipcMain.handle('cli:getStartDir', async () => {
    return state.cliStartDir;
  });

  // ---- PTY (fire-and-forget via ipcMain.on) ----
  ipcMain.on('pty:write', (_event, tabId: string, data: string) => {
    ptyManager.write(tabId, data);
  });

  ipcMain.on(
    'pty:resize',
    (_event, tabId: string, cols: number, rows: number) => {
      ptyManager.resize(tabId, cols, rows);
    },
  );

  // ---- Window title (fire-and-forget) ----
  ipcMain.on('window:setTitle', (_event, title: string) => {
    if (state.mainWindow) {
      state.mainWindow.setTitle(title);
    }
  });
}
```

Note: The `AppState` interface needs a `pipeName` field. We'll add that when we wire index.ts.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ipc-handlers.test.ts`
Expected: PASS (8 tests)

**Step 5: Commit**

```
git add src/main/ipc-handlers.ts tests/main/ipc-handlers.test.ts
git commit -m "feat: extract ipc-handlers module from index.ts"
```

---

### Task 5: Update `pty-manager.ts` to use `claude-cli`

**Files:**
- Modify: `src/main/pty-manager.ts:22-26`
- Verify: `tests/main/pty-manager.test.ts` still passes

**Step 1: Modify pty-manager.ts**

Replace lines 22-26 in `src/main/pty-manager.ts`:

```ts
// Before:
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'claude';
    const spawnArgs = isWindows ? ['/c', 'claude', ...args] : args;

// After:
    const { command: shell, args: spawnArgs } = getClaudeCommand(args);
```

Add import at top:
```ts
import { getClaudeCommand } from '@shared/claude-cli';
```

**Step 2: Run existing tests to verify nothing breaks**

Run: `npx vitest run tests/main/pty-manager.test.ts`
Expected: PASS (all existing tests)

**Step 3: Commit**

```
git add src/main/pty-manager.ts
git commit -m "refactor: use shared getClaudeCommand in pty-manager"
```

---

### Task 6: Rewrite `index.ts` as lifecycle glue

**Files:**
- Modify: `src/main/index.ts` (complete rewrite to ~110 lines)

**Step 1: Rewrite index.ts**

Replace entire contents of `src/main/index.ts` with:

```ts
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handleSquirrelEvent } from './squirrel-startup';

import { TabManager } from './tab-manager';
import { PtyManager } from './pty-manager';
import { HookIpcServer } from './ipc-server';
import { SettingsStore } from './settings-store';
import { createTabNamer } from './tab-namer';
import { createHookRouter } from './hook-router';
import { registerIpcHandlers, type AppState } from './ipc-handlers';
import { log } from './logger';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (handleSquirrelEvent(app)) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------
const tabManager = new TabManager();
const ptyManager = new PtyManager();
const settings = new SettingsStore();
const PIPE_NAME = `\\\\.\\pipe\\claude-terminal-${process.pid}`;
let ipcServer: HookIpcServer | null = null;

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------
const state: AppState = {
  workspaceDir: null,
  permissionMode: 'bypassPermissions',
  worktreeManager: null,
  hookInstaller: null,
  mainWindow: null,
  cliStartDir: parseCliStartDir(),
  pipeName: PIPE_NAME,
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseCliStartDir(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg === '.') continue;
    if (arg.toLowerCase().includes('electron')) continue;
    if (arg.includes('.vite') || arg.includes('node_modules')) continue;
    try {
      if (fs.statSync(arg).isDirectory()) return arg;
    } catch { /* not a valid path */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = state.mainWindow as BrowserWindow | null;
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function persistSessions() {
  if (!state.workspaceDir) return;
  const allTabs = tabManager.getAllTabs();
  const savedTabs = allTabs
    .filter(t => t.sessionId && t.type === 'claude')
    .map(t => ({
      name: t.name,
      cwd: t.cwd,
      worktree: t.worktree,
      sessionId: t.sessionId!,
    }));
  settings.saveSessions(state.workspaceDir, savedTabs);
}

// ---------------------------------------------------------------------------
// Wire up extracted modules
// ---------------------------------------------------------------------------
const { generateTabName, cleanupNamingFlag } = createTabNamer({
  tabManager, sendToRenderer, persistSessions,
});

const { handleHookMessage } = createHookRouter({
  tabManager, sendToRenderer, persistSessions,
  generateTabName, cleanupNamingFlag,
  getMainWindow: () => state.mainWindow as BrowserWindow | null,
});

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
const createWindow = () => {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.resolve(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  state.mainWindow = mainWindow;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const initialTitle = state.cliStartDir
    ? `ClaudeTerminal - ${path.resolve(state.cliStartDir)}`
    : 'ClaudeTerminal';
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(initialTitle);
    log.attach(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (event) => {
    const workingTabs = tabManager.getAllTabs().filter(t => t.status === 'working');
    if (workingTabs.length > 0) {
      const names = workingTabs.map(t => t.name).join(', ');
      const result = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        title: 'Close ClaudeTerminal?',
        message: `${workingTabs.length === 1 ? '1 tab is' : `${workingTabs.length} tabs are`} still running`,
        detail: names,
      });
      if (result === 1) {
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    state.mainWindow = null;
  });
};

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.setPath(
  'sessionData',
  path.join(app.getPath('temp'), `claude-terminal-${process.pid}`),
);

app.on('ready', async () => {
  ipcServer = new HookIpcServer(PIPE_NAME);
  try {
    await ipcServer.start();
    log.info('[ipc-server] listening on pipe');
  } catch (err) {
    log.error('[ipc-server] FAILED to start:', String(err));
  }

  ipcServer.onMessage(handleHookMessage);

  registerIpcHandlers({
    tabManager, ptyManager, settings, state,
    sendToRenderer, persistSessions, cleanupNamingFlag,
  });

  createWindow();
});

app.on('window-all-closed', async () => {
  log.info('[quit] workspaceDir:', state.workspaceDir, 'tabs:', tabManager.getAllTabs().length);
  persistSessions();

  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
  }

  ptyManager.killAll();
  if (ipcServer) {
    try { await ipcServer.stop(); } catch { /* best-effort */ }
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------------------------------------------------------------------------
// Forge Vite plugin globals (injected at build time)
// ---------------------------------------------------------------------------
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```
git add src/main/index.ts
git commit -m "refactor: rewrite index.ts as lifecycle glue (closes #42, closes #43)"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run build**

Run: `npm run make` (or `npx electron-forge make`)
Expected: Build succeeds

**Step 3: Manually verify the app starts**

Launch the built app, create a tab, verify hook messages still work.

**Step 4: Run line count comparison**

Run: `wc -l src/main/index.ts src/main/tab-namer.ts src/main/hook-router.ts src/main/ipc-handlers.ts src/shared/claude-cli.ts`

Expected: index.ts ~110 lines (down from 649), total similar but now modular and testable.
