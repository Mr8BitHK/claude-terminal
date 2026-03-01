# Hook Emit Fixes & StatusBar Feedback

## Problem

Three hook events are not emitted from the `tab:createWithWorktree` and `tab:close` code paths, even though equivalent standalone handlers emit them correctly. Additionally, `hook:status` IPC events are sent to the renderer but nothing displays them.

## Part 1: Missing Hook Emits

### 1. `worktree:created` in `tab:createWithWorktree`

After `createAsync()` succeeds (around line 236 of `ipc-handlers.ts`), emit:

```ts
state.hookEngine.emit('worktree:created', { contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName });
```

This matches the standalone `worktree:create` handler at line 423.

### 2. `tab:created` in `tab:createWithWorktree`

After PTY spawns and tab is updated (around line 282), emit:

```ts
state.hookEngine.emit('tab:created', { contextRoot: cwd, tabId: tab.id, cwd, type: 'claude' });
```

This matches the `tab:create` handler at line 192.

### 3. `worktree:removed` in `tab:close`

After `worktreeManager.remove()` succeeds (around line 372), emit:

```ts
state.hookEngine.emit('worktree:removed', { contextRoot: state.workspaceDir!, name: path.basename(tab.cwd), path: tab.cwd });
```

This matches the standalone `worktree:remove` handler at line 442.

## Part 2: StatusBar Hook Feedback

### State management (App.tsx)

- Listen to `window.claudeTerminal.onHookStatus()` in a `useEffect`
- Track `hookStatus: { hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null`
- On `running`: set immediately
- On `done`: set, then auto-clear after 3 seconds
- On `failed`: set and keep visible until next hook runs

### StatusBar changes

- Add optional `hookStatus` prop to `StatusBar`
- Render a span between status counts and help text:
  - Running: `⟳ hookName...`
  - Done: `✓ hookName`
  - Failed: `✗ hookName` (with error in title tooltip)

### CSS

- `.hook-status` base styles
- `.hook-running` color: `#dcdcaa` (yellow)
- `.hook-done` color: `#4ec9b0` (green)
- `.hook-failed` color: `#f44747` (red)

## Files Changed

| File | Change |
|------|--------|
| `src/main/ipc-handlers.ts` | Add 3 missing `hookEngine.emit()` calls |
| `src/renderer/App.tsx` | Add `onHookStatus` listener + state, pass to StatusBar |
| `src/renderer/components/StatusBar.tsx` | Accept + render `hookStatus` prop |
| `src/renderer/index.css` | Add `.hook-status` styles |
