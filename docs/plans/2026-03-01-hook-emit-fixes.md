# Hook Emit Fixes & StatusBar Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 missing hook emit calls and add visible hook execution feedback in the StatusBar.

**Architecture:** Add missing `hookEngine.emit()` calls to `tab:createWithWorktree` and `tab:close` handlers to match their standalone equivalents. Add `onHookStatus` listener in App.tsx, pass state to StatusBar, render inline status with auto-dismiss.

**Tech Stack:** TypeScript, React, Electron IPC

---

### Task 1: Add missing `worktree:created` and `tab:created` emits in `tab:createWithWorktree`

**Files:**
- Modify: `src/main/ipc-handlers.ts:236` and `src/main/ipc-handlers.ts:282`

**Step 1: Write failing tests**

Add to `tests/main/ipc-handlers.test.ts` inside the existing `describe('tab:createWithWorktree')` block:

```ts
it('emits worktree:created and tab:created hooks after successful setup', async () => {
  const handler = handlers.get('tab:createWithWorktree')!;
  await handler({}, 'my-feature');

  await vi.runAllTimersAsync();

  expect(deps.state.hookEngine!.emit).toHaveBeenCalledWith('worktree:created', expect.objectContaining({
    name: 'my-feature',
    branch: 'my-feature',
  }));
  expect(deps.state.hookEngine!.emit).toHaveBeenCalledWith('tab:created', expect.objectContaining({
    tabId: 'tab-1',
    type: 'claude',
  }));
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-handlers.test.ts -t "emits worktree:created"`
Expected: FAIL — `hookEngine.emit` not called with `worktree:created`

**Step 3: Add the missing emits to `tab:createWithWorktree`**

In `src/main/ipc-handlers.ts`, after line 236 (`sendProgress ... Worktree created`), add:

```ts
        // Fire worktree:created hook (matches standalone worktree:create handler)
        if (state.hookEngine) {
          state.hookEngine.emit('worktree:created', { contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName });
        }
```

After line 282 (`deps.persistSessions();`), add:

```ts
        if (state.hookEngine) {
          state.hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: 'claude' });
        }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ipc-handlers.test.ts -t "emits worktree:created"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts tests/main/ipc-handlers.test.ts
git commit -m "fix: emit worktree:created and tab:created hooks from tab:createWithWorktree"
```

---

### Task 2: Add missing `worktree:removed` emit in `tab:close`

**Files:**
- Modify: `src/main/ipc-handlers.ts:372`

**Step 1: Write failing test**

Add to `tests/main/ipc-handlers.test.ts` (new describe block or within existing tab:close tests):

```ts
describe('tab:close with removeWorktree', () => {
  beforeEach(async () => {
    deps.state.workspaceDir = '/test';
    const startHandler = handlers.get('session:start')!;
    await startHandler({}, '/test', 'bypassPermissions');
  });

  it('emits worktree:removed hook when removing worktree on tab close', async () => {
    // Create a worktree tab first
    (deps.tabManager.getTab as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'tab-1', worktree: 'my-feature', cwd: '/test/.claude/worktrees/my-feature',
      name: 'my-feature', status: 'idle', type: 'claude', pid: 123,
    });

    const handler = handlers.get('tab:close')!;
    await handler({}, 'tab-1', true);

    expect(deps.state.hookEngine!.emit).toHaveBeenCalledWith('worktree:removed', expect.objectContaining({
      name: 'my-feature',
    }));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/ipc-handlers.test.ts -t "emits worktree:removed"`
Expected: FAIL

**Step 3: Add the missing emit**

In `src/main/ipc-handlers.ts`, inside the `tab:close` handler, after the successful `worktreeManager.remove()` call (line 372), add:

```ts
          if (state.hookEngine) {
            state.hookEngine.emit('worktree:removed', { contextRoot: state.workspaceDir!, name: path.basename(tab.cwd), path: tab.cwd });
          }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/ipc-handlers.test.ts -t "emits worktree:removed"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts tests/main/ipc-handlers.test.ts
git commit -m "fix: emit worktree:removed hook when closing tab with removeWorktree"
```

---

### Task 3: Add hook status display to StatusBar

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/StatusBar.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Add `hookStatus` state and listener to App.tsx**

In `src/renderer/App.tsx`, add import for `HookExecutionStatus`:

```ts
import type { PermissionMode, Tab, RemoteAccessInfo, HookExecutionStatus } from '../shared/types';
```

Add state after line 34 (`renamingTabId`):

```ts
const [hookStatus, setHookStatus] = useState<{ hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null>(null);
const hookDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add `onHookStatus` listener inside the existing `useEffect` that registers IPC listeners (the one starting at line 181). Add before the `return` cleanup:

```ts
const cleanupHookStatus = window.claudeTerminal.onHookStatus((status: HookExecutionStatus) => {
  if (hookDismissTimer.current) {
    clearTimeout(hookDismissTimer.current);
    hookDismissTimer.current = null;
  }
  setHookStatus({ hookName: status.hookName, status: status.status, error: status.error ?? status.stderr });
  if (status.status === 'done') {
    hookDismissTimer.current = setTimeout(() => setHookStatus(null), 3000);
  }
});
```

Add `cleanupHookStatus()` to the cleanup return.

**Step 2: Pass `hookStatus` to StatusBar**

Change the StatusBar JSX from:

```tsx
<StatusBar tabs={tabs} />
```

to:

```tsx
<StatusBar tabs={tabs} hookStatus={hookStatus} />
```

**Step 3: Update StatusBar component**

In `src/renderer/components/StatusBar.tsx`, update the interface and rendering:

```tsx
interface StatusBarProps {
  tabs: Tab[];
  hookStatus?: { hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null;
}

const StatusBar = React.memo(function StatusBar({ tabs, hookStatus }: StatusBarProps) {
```

Add the hook status span between the status-counts div and status-help span:

```tsx
{hookStatus && (
  <span className={`hook-status hook-${hookStatus.status}`} title={hookStatus.error || undefined}>
    {hookStatus.status === 'running' ? '⟳' : hookStatus.status === 'done' ? '✓' : '✗'}
    {' '}{hookStatus.hookName}{hookStatus.status === 'running' ? '...' : ''}
  </span>
)}
```

**Step 4: Add CSS styles**

In `src/renderer/index.css`, after the `.status-help` rule (line 90), add:

```css
.hook-status { font-size: 12px; }
.hook-running { color: #dcdcaa; }
.hook-done { color: #4ec9b0; }
.hook-failed { color: #f44747; }
```

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (no StatusBar tests exist, but ensure nothing breaks)

**Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/StatusBar.tsx src/renderer/index.css
git commit -m "feat: display hook execution status in StatusBar with auto-dismiss"
```

---

### Task 4: Run full test suite and verify

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors
