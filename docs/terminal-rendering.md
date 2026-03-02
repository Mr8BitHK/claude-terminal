# Terminal Rendering

ClaudeTerminal renders each tab as an independent xterm.js v6 terminal instance. Terminals are cached in a `Map` so tab switching preserves scrollback and state without re-creating the underlying terminal. A single global PTY data listener dispatches output to the correct terminal, with flow control to prevent the renderer from being overwhelmed by fast-producing processes.

## How It Works

```
Main process PTY emits data
  -> IPC: 'pty:data' (tabId, data)
    -> preload.ts bridges to renderer via onPtyData callback
      -> ensurePtyListener() dispatches to terminalCache.get(tabId)
        -> xterm.write(data) renders to canvas
          -> flow control: pause/resume PTY based on pending bytes
```

## Terminal Instance Caching

Each terminal is stored in a `Map<string, CachedTerminal>` keyed by tab ID. The `CachedTerminal` structure holds everything needed to manage a terminal's lifecycle:

```typescript
interface CachedTerminal {
  term: XTerm;                    // The xterm.js Terminal instance
  fitAddon: FitAddon;            // Handles auto-sizing to container
  serializeAddon: SerializeAddon; // Captures terminal content as ANSI
  onDataDisposable?: IDisposable; // Cleanup handle for keyboard input listener
}
```

Two companion data structures track flow control state:

- `pendingBytes: Map<string, number>` — bytes written to xterm that have not yet been flushed
- `pausedTabs: Set<string>` — tabs whose PTY has been paused due to back-pressure

### Why Caching Matters

Without caching, switching away from a tab and back would destroy and re-create the terminal, losing all scrollback history, selection state, and cursor position. The cache lets us simply toggle `display: none` on the container `div` and re-attach the same xterm instance when the tab becomes visible again.

### destroyTerminal Cleanup

When a tab is removed, `destroyTerminal(tabId)` performs a full cleanup:

1. Disposes the `onData` listener (stops forwarding keystrokes to the PTY)
2. Calls `term.dispose()` to free the xterm.js instance and its canvas
3. Removes the entry from `terminalCache`
4. Clears `pendingBytes` and `pausedTabs` for that tab

This is called from `App.tsx` inside the `onTabRemoved` handler.

## xterm.js Configuration

### Theme

The terminal uses a VS Code Dark-inspired color scheme:

| Color | Value | Usage |
|-------|-------|-------|
| `background` | `#1e1e1e` | Terminal background |
| `foreground` | `#d4d4d4` | Default text |
| `cursor` | `#d4d4d4` | Cursor color |
| `selectionBackground` | `#264f78` | Text selection highlight |

ANSI colors map to VS Code's dark theme palette (e.g., red is `#f44747`, green is `#6a9955`, blue is `#569cd6`).

### Font

- **Family**: `'Cascadia Code', 'Consolas', monospace`
- **Size**: 14px
- **Scrollback**: 5000 lines

### Addons

Three xterm.js addons are loaded on every terminal instance:

| Addon | Purpose |
|-------|---------|
| `FitAddon` | Automatically calculates cols/rows to fill the container element |
| `SerializeAddon` | Exports terminal buffer content as ANSI escape sequences for remote access snapshots |
| `WebLinksAddon` | Makes URLs in terminal output clickable (opens in default browser) |

## Rendering Lifecycle

### Terminal Creation

When a tab becomes visible and has no cached terminal, the component creates one:

1. Instantiate `new XTerm(...)` with theme, font, and scrollback config
2. Create and load `FitAddon`, `SerializeAddon`, `WebLinksAddon`
3. Attach the custom key event handler (see Key Event Filtering below)
4. Register `term.onData()` to forward keyboard input to the PTY via `writeToPty`
5. Store everything in `terminalCache`

### DOM Attachment

The `Terminal` component uses a `containerRef` (React ref to a `div`) and an `attachedRef` (tracks which tab ID is currently attached):

- If the terminal has never been attached to this container, `container.innerHTML` is cleared and `term.open(container)` mounts the xterm canvas
- If already attached (same tab ID, `.xterm` element present), skip re-attachment
- Initial fit is deferred to the next animation frame via `requestAnimationFrame` so the container has its final layout dimensions

### Visibility Toggling

All tabs render their `Terminal` component simultaneously. Visibility is controlled purely via CSS:

```tsx
<div style={{ display: isVisible ? 'block' : 'none' }} />
```

The main `useEffect` only runs when `isVisible` is true (early return on `!isVisible`), which means hidden tabs skip DOM attachment and resize observer setup while keeping their cached terminal intact.

### Cursor Blink Optimization

A separate `useEffect` toggles `cursorBlink` based on visibility:

```typescript
cached.term.options.cursorBlink = isVisible;
```

This stops hidden terminals from triggering idle GPU repaints caused by the blinking cursor animation.

## Key Event Filtering

`attachCustomKeyEventHandler` intercepts keyboard events before xterm processes them. Returning `false` prevents xterm from consuming the event, letting it bubble up to the window-level handler in `App.tsx`.

All app-level keybindings are defined in a central registry (`src/renderer/keybindings.ts`). Each entry declares its modifier, key, and handler in one place. Terminal.tsx calls `matchKeybinding(e)` to decide whether to pass a key through; App.tsx calls the same function to dispatch the matched action.

### Registered Keybindings

| Key | Action |
|-----|--------|
| `Ctrl+N` | New window (spawns independent app instance) |
| `Ctrl+T` | New Claude tab (no worktree) |
| `Ctrl+W` | New worktree tab (prompts for name) |
| `Ctrl+P` | New PowerShell tab |
| `Ctrl+L` | New WSL tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch to next/previous tab |
| `Ctrl+F4` | Close active tab |
| `Ctrl+1` through `Ctrl+9` | Jump to tab by index |
| `F2` | Rename active tab |
| `Alt+F4` | Pass through to OS (close window) |
| `Ctrl+Enter` | Insert literal newline in terminal (terminal-only, see below) |

### Ctrl+Enter Literal Newline

`Ctrl+Enter` is a special case handled via the `onTerminal` callback in the registry. Instead of bubbling to an app-level handler, it directly writes `\x1b\r` (ESC followed by CR) to the PTY on `keydown`. This inserts a literal newline in Claude Code's prompt without submitting it. The event is still suppressed from xterm (returns `false`).

### Two-Layer Key Handling

Key events flow through two layers:

1. **xterm filter** (`Terminal.tsx`): calls `matchKeybinding(e)` — if a match is found, runs any `onTerminal` callback and returns `false` to let the event bubble. `isTabJump(e)` handles the `Ctrl+1-9` range separately.
2. **Window handler** (`App.tsx`): `window.addEventListener('keydown', handler)` picks up the bubbled events, calls `matchKeybinding(e)` again, and invokes `kb.action(ctx)` with a `KeybindingContext` that provides access to tab operations.

All other keys (regular typing, arrow keys, etc.) return `true` and are handled normally by xterm, which forwards them to the PTY via `term.onData()`.

## Resize Handling

### Standard Mode (Electron)

A `ResizeObserver` watches the terminal container element. When the container size changes (window resize, DevTools toggle, etc.):

1. The observer fires and debounces via `setTimeout` (50ms)
2. `fitAddon.fit()` recalculates the terminal's column/row count to fill the container
3. `resizePty(tabId, cols, rows)` sends the new dimensions to the main process
4. The main process calls `pty.resize(cols, rows)` on the underlying node-pty instance

The debounce prevents excessive resize events during drag-resizing.

### Fixed-Size Mode (Remote Clients)

When `fixedCols` and `fixedRows` props are provided, the terminal skips `FitAddon` and uses exact dimensions:

```typescript
term.resize(fixedCols, fixedRows);
```

No `ResizeObserver` is created. This mode is used by remote access clients that need to match the host terminal's dimensions exactly.

## Flow Control

The renderer implements back-pressure to prevent a fast-producing PTY (e.g., `cat` on a large file) from flooding the xterm.js write queue and causing the UI to freeze.

### Watermark Constants

```typescript
const HIGH_WATERMARK = 50 * 1024; // 50KB — pause threshold
const LOW_WATERMARK  = 10 * 1024; // 10KB — resume threshold
```

### Mechanism

1. Each `pty:data` chunk arrives and is written to xterm via `term.write(data, callback)`
2. `pendingBytes` for that tab is incremented by `data.length` immediately
3. If `pendingBytes` exceeds `HIGH_WATERMARK`, the PTY is paused via `pausePty(tabId)` — the main process stops reading from node-pty, which applies OS-level back-pressure to the child process
4. When xterm's write callback fires (data has been processed and rendered), `pendingBytes` is decremented
5. If the tab was paused and `pendingBytes` drops below `LOW_WATERMARK`, the PTY is resumed via `resumePty(tabId)`

The two-threshold (hysteresis) design prevents rapid pause/resume cycling when output rate hovers near a single threshold.

### Global PTY Listener

There is exactly one PTY data listener for the entire renderer, not one per terminal. `ensurePtyListener()` uses a module-level flag to ensure single registration. The listener is stored on `window.__cleanupPtyListener` so it survives Vite HMR module reloads — without this, a hot reload would leave the old listener attached, causing doubled characters.

## Context Menu

Right-click on a terminal triggers a context menu handler that provides Windows Terminal-style copy/paste behavior:

- **If text is selected**: copies the selection to clipboard, then clears the selection
- **If no text is selected**: pastes from clipboard into the terminal via `term.paste()`

The browser's default context menu is suppressed via `e.preventDefault()`.

## Terminal Serialization

The `SerializeAddon` is used to capture a terminal's visible buffer plus scrollback as ANSI escape sequences. This is exposed as a global function on `window`:

```typescript
(window as any).__serializeTerminal = (tabId: string): string => {
  const cached = terminalCache.get(tabId);
  if (!cached) return '';
  return cached.serializeAddon.serialize();
};
```

The main process can call this via `webContents.executeJavaScript('__serializeTerminal("tab-id")')` to capture a snapshot of any terminal's current state. This is used by the remote access system to send terminal content to connected clients.

## Preload API (PTY-Related)

The preload script (`preload.ts`) exposes PTY operations to the renderer through `contextBridge.exposeInMainWorld`:

| Method | IPC Channel | Direction | Purpose |
|--------|-------------|-----------|---------|
| `writeToPty(tabId, data)` | `pty:write` | send | Forward keyboard input to PTY |
| `resizePty(tabId, cols, rows)` | `pty:resize` | send | Sync terminal dimensions to PTY |
| `pausePty(tabId)` | `pty:pause` | send | Pause PTY reads (flow control) |
| `resumePty(tabId)` | `pty:resume` | send | Resume PTY reads (flow control) |
| `onPtyData(callback)` | `pty:data` | listen | Receive PTY output for rendering |

All `send` methods are fire-and-forget (no response). `onPtyData` returns a cleanup function that removes the IPC listener.

## Key Files

| File | Purpose |
|------|---------|
| `src/renderer/components/Terminal.tsx` | Terminal React component — creation, DOM attachment, key filtering, resize, flow control, context menu |
| `src/renderer/components/terminalCache.ts` | `CachedTerminal` type, `terminalCache` Map, flow control state, `destroyTerminal()`, serialization global |
| `src/renderer/App.tsx` | Renders `<Terminal>` for each tab, calls `destroyTerminal` on tab removal, window-level keyboard shortcuts |
| `src/preload.ts` | Bridges PTY IPC channels (`write`, `resize`, `pause`, `resume`, `data`) between main and renderer |
