# xterm.js Performance Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate keyboard lag and reduce memory/GPU overhead for multi-tab terminal sessions.

**Architecture:** Four independent fixes applied incrementally — scrollback cap, onData disposal, cursor blink toggle for hidden tabs, and PTY write flow control with watermarking. The flow control change spans main process (buffering) and renderer (watermark tracking).

**Tech Stack:** xterm.js 6.0.0, Electron IPC, node-pty, Vitest

---

### Task 1: Add scrollback limit and dispose onData

Two trivial config/cleanup fixes batched together.

**Files:**
- Modify: `src/renderer/components/terminalCache.ts`
- Modify: `src/renderer/components/Terminal.tsx`

**Step 1: Update terminalCache type to include onData disposable**

In `src/renderer/components/terminalCache.ts`, add an `IDisposable` import and expand the cache entry type:

```typescript
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { IDisposable } from '@xterm/xterm';

export interface CachedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  onDataDisposable?: IDisposable;
}

export const terminalCache = new Map<string, CachedTerminal>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.onDataDisposable?.dispose();
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
}
```

**Step 2: Update Terminal.tsx — scrollback + capture onData disposable**

In `src/renderer/components/Terminal.tsx`, add `scrollback: 5000` to the XTerm constructor options (after `fontFamily`):

```typescript
const term = new XTerm({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Consolas', monospace",
  scrollback: 5000,
  theme: { ... },
});
```

Capture the onData disposable and store it on the cache entry. Replace:

```typescript
term.onData((data) => {
  window.claudeTerminal.writeToPty(tabId, data);
});

cached = { term, fitAddon };
```

With:

```typescript
const onDataDisposable = term.onData((data) => {
  window.claudeTerminal.writeToPty(tabId, data);
});

cached = { term, fitAddon, onDataDisposable };
```

**Step 3: Build and verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```
feat: add scrollback limit and dispose onData listener

Cap scrollback at 5000 lines to bound memory per terminal.
Capture and dispose onData listener to prevent leaks on HMR.
```

---

### Task 2: Disable cursor blink on hidden terminals

**Files:**
- Modify: `src/renderer/components/Terminal.tsx`

**Step 1: Add cursor blink toggle based on visibility**

In the `useEffect` in `Terminal.tsx`, after the early return for `!isVisible`, add logic to disable cursor blink when the terminal is hidden. The effect currently returns early when `!isVisible`, so hidden terminals get no setup/cleanup cycle for blink.

Add a **separate** `useEffect` that toggles cursor blink based on visibility:

```typescript
// Toggle cursor blink off for hidden terminals to stop idle GPU repaints
useEffect(() => {
  const cached = terminalCache.get(tabId);
  if (!cached) return;
  cached.term.options.cursorBlink = isVisible;
}, [tabId, isVisible]);
```

Place this after the existing `useEffect` block (before the `return` JSX).

**Step 2: Build and verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
perf: disable cursor blink on hidden terminals

Stops the internal blink timer for background tabs,
reducing idle GPU repaints when multiple tabs are open.
```

---

### Task 3: Add flow control IPC channels (main process)

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `tests/main/ipc-handlers.test.ts`

**Step 1: Write the failing tests**

Add tests to `tests/main/ipc-handlers.test.ts`:

```typescript
it('registers pty:pause and pty:resume listeners', () => {
  expect(listeners.has('pty:pause')).toBe(true);
  expect(listeners.has('pty:resume')).toBe(true);
});

describe('pty flow control', () => {
  it('buffers data when paused and flushes on resume', async () => {
    // Start session and create tab to set up PTY data forwarding
    deps.state.workspaceDir = '/test';
    const handler = handlers.get('tab:create')!;
    await handler({}, null);

    // Get the onData callback that was registered on the mock PTY
    const mockProc = (deps.ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const onDataCallback = mockProc.onData.mock.calls[0][0];

    // Pause the tab
    const pauseListener = listeners.get('pty:pause')!;
    pauseListener({}, 'tab-1');

    // Send data while paused — should NOT reach renderer
    deps.sendToRenderer.mockClear();
    onDataCallback('buffered data');
    expect(deps.sendToRenderer).not.toHaveBeenCalledWith('pty:data', 'tab-1', 'buffered data');

    // Resume — should flush buffered data
    const resumeListener = listeners.get('pty:resume')!;
    resumeListener({}, 'tab-1');
    expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:data', 'tab-1', 'buffered data');

    // After resume, new data should flow directly
    deps.sendToRenderer.mockClear();
    onDataCallback('live data');
    expect(deps.sendToRenderer).toHaveBeenCalledWith('pty:data', 'tab-1', 'live data');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/ipc-handlers.test.ts`
Expected: FAIL — `pty:pause` listener not registered.

**Step 3: Implement flow control in ipc-handlers.ts**

The current PTY data forwarding is inline inside `tab:create`:

```typescript
proc.onData((data: string) => {
  deps.sendToRenderer('pty:data', tab.id, data);
});
```

This needs to be wrapped so pause/resume can intercept it. Add per-tab flow control state at the top of `registerIpcHandlers`:

```typescript
// Per-tab flow control state for PTY data buffering
const flowControl = new Map<string, { paused: boolean; buffer: string[] }>();
```

Replace the inline `proc.onData` in `tab:create` with:

```typescript
flowControl.set(tab.id, { paused: false, buffer: [] });

proc.onData((data: string) => {
  const fc = flowControl.get(tab.id);
  if (fc?.paused) {
    fc.buffer.push(data);
  } else {
    deps.sendToRenderer('pty:data', tab.id, data);
  }
});
```

Do the same for `tab:createShell`.

Add cleanup in the `proc.onExit` callbacks and `tab:close`:

```typescript
flowControl.delete(tab.id);
```

Register the pause/resume listeners at the bottom of `registerIpcHandlers` (alongside existing `pty:write` and `pty:resize`):

```typescript
ipcMain.on('pty:pause', (_event, tabId: string) => {
  const fc = flowControl.get(tabId);
  if (fc) fc.paused = true;
});

ipcMain.on('pty:resume', (_event, tabId: string) => {
  const fc = flowControl.get(tabId);
  if (!fc) return;
  fc.paused = false;
  // Flush buffered data
  for (const chunk of fc.buffer) {
    deps.sendToRenderer('pty:data', tabId, chunk);
  }
  fc.buffer.length = 0;
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/ipc-handlers.test.ts`
Expected: All tests PASS, including the new flow control tests.

**Step 5: Commit**

```
feat: add PTY flow control buffering in main process

When renderer sends pty:pause, buffer incoming PTY data
instead of forwarding to renderer. On pty:resume, flush
the buffer. This enables renderer-side watermark flow control.
```

---

### Task 4: Add flow control preload API

**Files:**
- Modify: `src/preload.ts`

**Step 1: Add pausePty and resumePty to preload API**

In `src/preload.ts`, add to the `api` object (after `resizePty`):

```typescript
pausePty: (tabId: string): void =>
  ipcRenderer.send('pty:pause', tabId),
resumePty: (tabId: string): void =>
  ipcRenderer.send('pty:resume', tabId),
```

**Step 2: Build and verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```
feat: expose pausePty/resumePty in preload API
```

---

### Task 5: Implement renderer-side watermark flow control

**Files:**
- Modify: `src/renderer/components/Terminal.tsx`

**Step 1: Add watermark tracking to the global PTY data listener**

Replace the `ensurePtyListener` function in `Terminal.tsx`:

```typescript
const HIGH_WATERMARK = 50 * 1024; // 50KB
const LOW_WATERMARK = 10 * 1024;  // 10KB

// Per-tab flow control state (renderer side)
const pendingBytes = new Map<string, number>();
const pausedTabs = new Set<string>();

function ensurePtyListener(): void {
  if (ptyListenerRegistered) return;
  ptyListenerRegistered = true;

  const win = window as any;
  if (typeof win.__cleanupPtyListener === 'function') {
    win.__cleanupPtyListener();
  }

  win.__cleanupPtyListener = window.claudeTerminal.onPtyData((dataTabId, data) => {
    const cached = terminalCache.get(dataTabId);
    if (!cached) return;

    const pending = (pendingBytes.get(dataTabId) ?? 0) + data.length;
    pendingBytes.set(dataTabId, pending);

    cached.term.write(data, () => {
      const updated = (pendingBytes.get(dataTabId) ?? 0) - data.length;
      pendingBytes.set(dataTabId, Math.max(0, updated));

      if (pausedTabs.has(dataTabId) && updated < LOW_WATERMARK) {
        pausedTabs.delete(dataTabId);
        window.claudeTerminal.resumePty(dataTabId);
      }
    });

    if (!pausedTabs.has(dataTabId) && pending > HIGH_WATERMARK) {
      pausedTabs.add(dataTabId);
      window.claudeTerminal.pausePty(dataTabId);
    }
  });
}
```

**Step 2: Clean up flow state when terminal is destroyed**

In `src/renderer/components/terminalCache.ts`, import and clean up the flow state in `destroyTerminal`. Export the maps from Terminal.tsx or pass cleanup into destroyTerminal.

Simpler approach: just export a cleanup function from Terminal.tsx and call it from destroyTerminal. Or, since the maps are module-level in Terminal.tsx, add the cleanup directly in `destroyTerminal` by also deleting from those maps.

Best approach: move the flow state maps into `terminalCache.ts` and export them:

Add to `terminalCache.ts`:

```typescript
// Renderer-side flow control state
export const pendingBytes = new Map<string, number>();
export const pausedTabs = new Set<string>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.onDataDisposable?.dispose();
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
  pendingBytes.delete(tabId);
  pausedTabs.delete(tabId);
}
```

Then import `pendingBytes` and `pausedTabs` from `terminalCache` in `Terminal.tsx`.

**Step 3: Build and manually test**

Run: `npx tsc --noEmit`
Expected: No type errors.

Manual test: open ClaudeTerminal, run a command that produces fast output (e.g., have Claude generate a long response), verify keyboard remains responsive during output.

**Step 4: Commit**

```
perf: add watermark-based flow control for PTY writes

Track pending bytes per tab in the renderer. When pending
exceeds 50KB, pause PTY data forwarding in main process.
Resume when xterm.js catches up below 10KB. Prevents
keyboard lag during high-volume terminal output.
```

---

### Task 6: Run full test suite and verify build

**Step 1:** Run `npx vitest run` — all tests should pass.

**Step 2:** Run `npx tsc --noEmit` — no type errors.

**Step 3:** Update the ipc-handlers test channel list to include `pty:pause` and `pty:resume`.

**Step 4: Commit any test fixes**

```
test: update ipc-handlers test for flow control channels
```
