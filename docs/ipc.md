# IPC Architecture

ClaudeTerminal uses Electron's IPC (inter-process communication) with `contextBridge` to provide secure, typed communication between the main process and the renderer. The renderer never has direct access to Node.js APIs; all interaction flows through a narrow, explicitly defined bridge.

## IPC Patterns

Three communication patterns are used throughout the application:

### 1. handle/invoke (request/response)

The renderer calls `ipcRenderer.invoke(channel, ...args)` and awaits a `Promise` resolved by the main process via `ipcMain.handle(channel, handler)`. Used for operations that return data or need confirmation of completion.

```
Renderer                          Main
  |                                 |
  |-- ipcRenderer.invoke(ch) ----->|
  |                                 |-- handler runs
  |<-- Promise resolves -----------|
```

### 2. send/on (fire-and-forget, renderer to main)

The renderer calls `ipcRenderer.send(channel, ...args)` and the main process listens with `ipcMain.on(channel, handler)`. No response is returned. Used for high-frequency or low-importance signals like PTY writes and resize events.

```
Renderer                          Main
  |                                 |
  |-- ipcRenderer.send(ch) ------>|
  |                                 |-- handler runs (no reply)
```

### 3. webContents.send/on (main to renderer)

The main process pushes events to the renderer via `webContents.send(channel, ...args)` (wrapped as `sendToRenderer` in the codebase). The renderer listens with `ipcRenderer.on(channel, handler)`. Used for asynchronous events like PTY output, tab state changes, and git branch updates.

```
Renderer                          Main
  |                                 |
  |<-- webContents.send(ch) ------|
  |-- handler runs                  |
```

## Preload Bridge

The preload script (`src/preload.ts`) uses `contextBridge.exposeInMainWorld` to attach a `claudeTerminal` object to `window`. This is the only surface the renderer can use to interact with the main process.

### Security Model

- **`nodeIntegration: false`** -- The renderer cannot import Node.js modules.
- **`contextIsolation: true`** -- The preload and renderer run in separate JavaScript contexts. The renderer cannot tamper with the preload's references to `ipcRenderer`.
- **`sandbox: true`** -- The renderer process is OS-sandboxed.
- **Explicit allowlist** -- Only the methods defined in the `api` object are exposed. There is no blanket `ipcRenderer` access.

### Bridge Shape

```typescript
contextBridge.exposeInMainWorld('claudeTerminal', api);

// The type is exported so global.d.ts can reference it:
export type ClaudeTerminalApi = typeof api;
```

The renderer accesses the API as `window.claudeTerminal.<method>(...)`.

## Channel Reference

### Session & Startup

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `session:start` | renderer -> main | invoke | `startSession(dir, mode)` | `dir: string`, `mode: PermissionMode` |
| `session:getSavedTabs` | renderer -> main | invoke | `getSavedTabs(dir)` | `dir: string` -> `SavedTab[]` |
| `cli:getStartDir` | renderer -> main | invoke | `getCliStartDir()` | -> `string \| null` |

### Tabs

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `tab:create` | renderer -> main | invoke | `createTab(worktree, resumeSessionId?, savedName?)` | -> `Tab` |
| `tab:createShell` | renderer -> main | invoke | `createShellTab(shellType, afterTabId?, cwd?)` | -> `Tab` |
| `tab:close` | renderer -> main | invoke | `closeTab(tabId, removeWorktree?)` | `tabId: string`, `removeWorktree?: boolean` |
| `tab:switch` | renderer -> main | invoke | `switchTab(tabId)` | `tabId: string` |
| `tab:rename` | renderer -> main | invoke | `renameTab(tabId, name)` | `tabId: string`, `name: string` |
| `tab:getAll` | renderer -> main | invoke | `getTabs()` | -> `Tab[]` |
| `tab:getActiveId` | renderer -> main | invoke | `getActiveTabId()` | -> `string \| null` |
| `tab:reorder` | renderer -> main | send | `reorderTabs(tabIds)` | `tabIds: string[]` |
| `tab:updated` | main -> renderer | webContents.send | `onTabUpdate(cb)` | `tab: Tab` |
| `tab:removed` | main -> renderer | webContents.send | `onTabRemoved(cb)` | `tabId: string` |
| `tab:switched` | main -> renderer | webContents.send | `onTabSwitched(cb)` | `tabId: string` |

### PTY

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `pty:write` | renderer -> main | send | `writeToPty(tabId, data)` | `tabId: string`, `data: string` |
| `pty:resize` | renderer -> main | send | `resizePty(tabId, cols, rows)` | `tabId: string`, `cols: number`, `rows: number` |
| `pty:pause` | renderer -> main | send | `pausePty(tabId)` | `tabId: string` |
| `pty:resume` | renderer -> main | send | `resumePty(tabId)` | `tabId: string` |
| `pty:data` | main -> renderer | webContents.send | `onPtyData(cb)` | `tabId: string`, `data: string` |
| `pty:resized` | main -> renderer | webContents.send | (no preload listener) | `tabId: string`, `cols: number`, `rows: number` |

Note: `pty:resized` is sent by the main process to notify remote web clients of terminal size changes but has no corresponding listener registered in the preload bridge.

### Worktree

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `worktree:create` | renderer -> main | invoke | `createWorktree(name)` | `name: string` -> `string` (path) |
| `worktree:currentBranch` | renderer -> main | invoke | `getCurrentBranch()` | -> `string` |
| `worktree:listDetails` | renderer -> main | invoke | `listWorktreeDetails()` | -> `{ name, path, clean, changesCount }[]` |
| `worktree:remove` | renderer -> main | invoke | `removeWorktree(worktreePath)` | `worktreePath: string` |
| `worktree:checkStatus` | renderer -> main | invoke | `checkWorktreeStatus(worktreePath)` | -> `{ clean: boolean, changesCount: number }` |

### Settings

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `settings:recentDirs` | renderer -> main | invoke | `getRecentDirs()` | -> `string[]` |
| `settings:removeRecentDir` | renderer -> main | invoke | `removeRecentDir(dir)` | `dir: string` |
| `settings:permissionMode` | renderer -> main | invoke | `getPermissionMode()` | -> `PermissionMode` |

### Dialog

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `dialog:selectDirectory` | renderer -> main | invoke | `selectDirectory()` | -> `string \| null` |

### Window

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `window:setTitle` | renderer -> main | send | `setWindowTitle(title)` | `title: string` |
| `window:createNew` | renderer -> main | send | `createNewWindow()` | *(none)* — spawns a new detached app instance |

### Remote Access

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `remote:activate` | renderer -> main | invoke | `activateRemoteAccess()` | -> `RemoteAccessInfo` |
| `remote:deactivate` | renderer -> main | invoke | `deactivateRemoteAccess()` | -> `void` |
| `remote:getInfo` | renderer -> main | invoke | `getRemoteAccessInfo()` | -> `RemoteAccessInfo` |
| `remote:updated` | main -> renderer | webContents.send | `onRemoteAccessUpdate(cb)` | `info: RemoteAccessInfo` |

### Git

| Channel | Direction | Pattern | Renderer Signature | Payload |
|---|---|---|---|---|
| `git:branchChanged` | main -> renderer | webContents.send | `onBranchChanged(cb)` | `branch: string` |

## Event Listeners

Main-to-renderer events are subscribed in the preload via wrapper methods that return cleanup functions. Each wrapper:

1. Creates a handler that strips the Electron `IpcRendererEvent` first argument.
2. Registers the handler with `ipcRenderer.on(channel, handler)`.
3. Returns a `() => void` cleanup function that calls `ipcRenderer.removeListener`.

### Registered Events

| Preload Method | Channel | Callback Signature |
|---|---|---|
| `onPtyData` | `pty:data` | `(tabId: string, data: string) => void` |
| `onTabUpdate` | `tab:updated` | `(tab: Tab) => void` |
| `onTabRemoved` | `tab:removed` | `(tabId: string) => void` |
| `onTabSwitched` | `tab:switched` | `(tabId: string) => void` |
| `onRemoteAccessUpdate` | `remote:updated` | `(info: RemoteAccessInfo) => void` |
| `onBranchChanged` | `git:branchChanged` | `(branch: string) => void` |

### Cleanup Pattern in App.tsx

The renderer sets up all event listeners in a single `useEffect` and returns a combined cleanup function:

```typescript
useEffect(() => {
  const cleanupUpdate = window.claudeTerminal.onTabUpdate((tab) => { ... });
  const cleanupRemoved = window.claudeTerminal.onTabRemoved((tabId) => { ... });
  const cleanupRemote = window.claudeTerminal.onRemoteAccessUpdate((info) => { ... });
  const cleanupSwitched = window.claudeTerminal.onTabSwitched((tabId) => { ... });
  const cleanupBranch = window.claudeTerminal.onBranchChanged((b) => { ... });

  return () => {
    cleanupUpdate();
    cleanupRemoved();
    cleanupRemote();
    cleanupSwitched();
    cleanupBranch();
  };
}, []);
```

The empty dependency array (`[]`) ensures listeners are registered exactly once. The PTY data listener (`onPtyData`) is registered separately in the `Terminal` component, scoped to each individual tab.

## Type Safety

### global.d.ts Augmentation

The renderer augments the global `Window` interface so TypeScript knows about `window.claudeTerminal`:

```typescript
// src/renderer/global.d.ts
import type { ClaudeTerminalApi } from '../preload';

declare global {
  interface Window {
    claudeTerminal: ClaudeTerminalApi;
  }
}
```

`ClaudeTerminalApi` is exported directly from the preload as `typeof api`, so every method signature, parameter type, and return type is inferred from the preload's implementation. Adding a new IPC method to the `api` object in `preload.ts` automatically makes it available (and type-checked) in the renderer.

### Shared Types

Types used across both processes live in `src/shared/types.ts`:

- `Tab` -- Tab state object (id, type, name, status, worktree, cwd, pid, sessionId)
- `SavedTab` -- Persisted tab info for session restore (name, cwd, worktree, sessionId)
- `TabStatus` -- `'new' | 'working' | 'idle' | 'requires_response' | 'shell'`
- `TabType` -- `'claude' | 'powershell' | 'wsl'`
- `PermissionMode` -- `'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'`
- `RemoteAccessInfo` -- Remote tunnel state (status, tunnelUrl, token, error)
- `RemoteAccessStatus` -- `'inactive' | 'connecting' | 'active' | 'error'`
- `IpcMessage` -- Named pipe message format (tabId, event, data)

## Flow Control

PTY data delivery supports per-tab flow control to prevent the renderer from being overwhelmed by high-throughput output. The main process maintains a `flowControl` map keyed by tab ID:

- **`pty:pause`** -- Buffers all incoming PTY data instead of sending it to the renderer.
- **`pty:resume`** -- Flushes the buffer and resumes live delivery.

This is driven by the renderer (via `pausePty`/`resumePty`) when xterm.js signals backpressure.

## Key Files

| File | Role |
|---|---|
| `src/preload.ts` | Defines the `contextBridge` API; single source of truth for available IPC methods |
| `src/main/ipc-handlers.ts` | Registers all `ipcMain.handle` and `ipcMain.on` handlers |
| `src/renderer/global.d.ts` | Augments `Window` with the `ClaudeTerminalApi` type |
| `src/shared/types.ts` | Shared type definitions used in IPC payloads |
| `src/renderer/App.tsx` | Sets up main-to-renderer event listeners and drives the UI |
| `src/renderer/components/Terminal.tsx` | Subscribes to `pty:data` events per tab |
| `src/main/tab-manager.ts` | Tab state management called by IPC handlers |
| `src/main/pty-manager.ts` | PTY lifecycle management called by IPC handlers |
