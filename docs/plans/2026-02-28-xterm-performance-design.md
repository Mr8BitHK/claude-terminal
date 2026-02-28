# xterm.js Performance Fixes Design

## Problem

After extended use, ClaudeTerminal exhibits keyboard lag. Investigation identified several xterm.js performance issues: no flow control on PTY writes, unlimited cursor blink on hidden terminals, no explicit scrollback cap, and a minor listener leak.

## Fixes

### 1. Scrollback limit

Add `scrollback: 5000` to XTerm constructor options. Caps memory per terminal while providing ample scroll history. xterm.js default is 1000; 5000 is generous for Claude sessions.

**File:** `Terminal.tsx`

### 2. Dispose onData listener

Capture the `IDisposable` returned by `term.onData()`, store it on the cache entry, and dispose it in `destroyTerminal()`. Defensive fix — prevents listener leaks if the effect re-runs without terminal destruction (e.g., HMR).

**Files:** `Terminal.tsx`, `terminalCache.ts`

### 3. Cursor blink on hidden terminals

When a terminal becomes hidden (`isVisible` false), set `term.options.cursorBlink = false`. When visible again, restore to `true`. This stops the internal blink timer that causes idle GPU repaints on all hidden tabs.

Full DOM detach was considered but rejected: xterm.js has no "close without dispose" API, and `term.open()` is designed to be called once. Since `display: none` already skips layout/paint, disabling cursor blink captures most of the benefit without re-attach risk.

**File:** `Terminal.tsx`

### 4. Flow control with write watermarking

Core fix for keyboard lag during high-volume output. Uses xterm.js's `term.write(data, callback)` to track when data has been parsed/rendered.

**Architecture:**
```
PTY (main) → IPC → renderer flow controller → term.write(data, callback)
                         ↑                           ↓
                   pty:pause/resume ←──── watermark tracking
```

**Renderer side:**
- Track pending bytes per tab in the global PTY data listener
- On `pty:data`: add data length to pending, call `term.write(data, callback)`
- Callback: decrement pending bytes; if below LOW_WATERMARK and paused, send `pty:resume`
- If pending exceeds HIGH_WATERMARK, send `pty:pause`
- Constants: HIGH_WATERMARK = 50KB, LOW_WATERMARK = 10KB

**Main process side:**
- On `pty:pause`: stop forwarding PTY data to renderer for that tab, buffer it instead
- On `pty:resume`: flush accumulated buffer to renderer, resume direct forwarding
- Buffer stored per-tab in ipc-handlers alongside existing PTY data listener

**New IPC channels:** `pty:pause`, `pty:resume` (renderer → main, fire-and-forget via `ipcMain.on`)

**New preload API:** `pausePty(tabId: string): void`, `resumePty(tabId: string): void`

**Files:** `Terminal.tsx`, `terminalCache.ts`, `ipc-handlers.ts`, `preload.ts`
