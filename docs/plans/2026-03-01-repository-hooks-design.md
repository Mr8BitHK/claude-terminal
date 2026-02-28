# Repository Hooks System — Design

## Overview

Add a repository-specific hooks system to claude-terminal that lets users configure shell commands to run in response to app-level events (worktree creation, tab lifecycle, branch changes, etc.). Hooks are managed via a GUI dialog and stored per-repository.

## Events

| Event | Context data | When |
|-------|-------------|------|
| `worktree:created` | `{ name, path, branch }` | After worktree is created |
| `worktree:removed` | `{ name, path }` | After worktree is removed |
| `tab:created` | `{ tabId, cwd, type }` | After any tab is created |
| `tab:closed` | `{ tabId, cwd }` | After tab is closed |
| `session:started` | `{ tabId, sessionId }` | After Claude session starts |
| `app:started` | `{ cwd }` | After app initializes workspace |
| `branch:changed` | `{ from, to }` | After git branch change detected |

## Config Format

Stored at `{repo}/.claude-terminal/hooks.json`.

```json
{
  "hooks": [
    {
      "id": "install-deps",
      "name": "Install dependencies",
      "event": "worktree:created",
      "commands": [
        { "path": "./packages/frontend", "command": "npm install" },
        { "path": "./packages/backend", "command": "npm install" }
      ],
      "enabled": true
    },
    {
      "id": "generate-types",
      "name": "Generate TypeScript types",
      "event": "worktree:created",
      "commands": [
        { "path": ".", "command": "npm run codegen" }
      ],
      "enabled": false
    }
  ]
}
```

- Multiple hooks can share the same event
- Each command has its own `path` (relative to the event's context root, e.g., the new worktree path)
- Commands within a hook run sequentially; if one fails, remaining commands are skipped
- Multiple hooks for the same event run sequentially in array order
- `enabled` allows toggling without deleting

## Architecture

### HookEngine (main process)

A `HookEngine` class that:
1. Loads config from `{repo}/.claude-terminal/hooks.json`
2. Exposes `emit(event, context)` for managers to call at lifecycle points
3. Finds all enabled hooks matching the event
4. Executes commands sequentially via `cross-spawn` with `shell: true`
5. Reports status to renderer via IPC

```
Event Source (e.g., WorktreeManager)
  -> HookEngine.emit('worktree:created', { name, path, branch })
    -> Find matching enabled hooks
    -> For each hook:
      -> For each command:
        -> Resolve cwd = join(contextRoot, command.path)
        -> spawn(command.command, { shell: true, cwd })
        -> Stream stdout/stderr, capture output
        -> On failure: skip remaining commands, report error
    -> Report overall status
```

### IPC Events (main -> renderer)

| Event | Data |
|-------|------|
| `hook:started` | `{ hookId, hookName, event }` |
| `hook:command:running` | `{ hookId, commandIndex, command, path }` |
| `hook:command:done` | `{ hookId, commandIndex, exitCode, stdout, stderr }` |
| `hook:completed` | `{ hookId }` |
| `hook:failed` | `{ hookId, commandIndex, error }` |

### Dependencies

- **`cross-spawn`** — cross-platform command execution (CommonJS, fixes Windows .cmd resolution, paths with spaces, etc.)
- **`tree-kill`** — kill process trees on Windows (for timeout cleanup)

### Execution Details

- Timeout per command: configurable, default 60 seconds
- On timeout: kill process tree via `tree-kill`, report failure
- Shell: `shell: true` on spawn (uses platform default — cmd.exe on Windows, user's shell on Unix)
- Environment: inherit `process.env` plus event context as env vars (e.g., `HOOK_EVENT`, `HOOK_WORKTREE_PATH`)

## GUI: Hook Management Dialog

Accessible from the hamburger menu or a settings area.

### Layout

- **Hook list** (left panel): All hooks shown, each row has name, event badge, enabled toggle
- **Hook editor** (right panel): Selected hook's details
  - Name (text input)
  - Event (dropdown selector)
  - Commands list (ordered):
    - Each row: path field + command field + remove button
    - Add command button
    - Drag to reorder (or up/down buttons)
  - Enabled toggle
- **Add Hook** / **Delete Hook** buttons

### Renderer Components

- `HookManagerDialog.tsx` — the dialog container
- `HookList.tsx` — left panel list of hooks
- `HookEditor.tsx` — right panel editor for selected hook

## Integration Points

Existing managers need small additions to call `hookEngine.emit()`:

- `worktree-manager.ts` — after `create()` and `remove()`
- `pty-manager.ts` / `ipc-handlers.ts` — after tab creation and close
- `hook-router.ts` — after `tab:ready` (session started)
- `index.ts` — after app startup
- Git branch change detection — after branch change event

## File Structure

```
src/main/
  hook-engine.ts          # HookEngine class
  hook-config.ts          # Load/save/validate hooks.json
src/renderer/components/
  HookManagerDialog.tsx   # Dialog container
  HookList.tsx            # Hook list panel
  HookEditor.tsx          # Hook editor panel
src/shared/types.ts       # HookConfig, HookCommand types
```
