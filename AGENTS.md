# AGENTS.md

## Project Overview

ClaudeTerminal is a Windows Terminal-like Electron desktop app for running multiple Claude Code CLI instances in tabs. Each tab spawns a real Claude Code process via node-pty with xterm.js rendering. Status tracking uses Claude Code hooks communicating over Windows named pipes.

## Tech Stack

- **Runtime**: Electron 40 + React 19 + TypeScript 5.7
- **Terminal**: xterm.js v6 (@xterm scoped) + WebGL addon + node-pty (ConPTY)
- **Build**: Electron Forge + Vite + pnpm (hoisted node-linker)
- **Test**: Vitest + jsdom + @testing-library/react
- **IPC**: Windows named pipes (`\\.\pipe\claude-terminal`)

## Project Structure

```
src/
  main/           # Electron main process
    index.ts      # App entry: window creation, IPC handlers, lifecycle
    pty-manager.ts    # Spawns/manages node-pty processes per tab
    tab-manager.ts    # Pure state: tab CRUD, active tab tracking
    ipc-server.ts     # Named pipe server for hook communication
    settings-store.ts # JSON file-based settings persistence
    worktree-manager.ts # Git worktree create/remove/list
    hook-installer.ts   # Writes .claude/settings.local.json for hooks
  renderer/        # React renderer process
    App.tsx        # Root component, state machine (startup/running)
    components/    # StartupDialog, TabBar, Tab, Terminal, StatusBar, NewTabDialog
    index.css      # Dark VS Code-like theme
    global.d.ts    # Window.claudeTerminal type augmentation
  shared/
    types.ts       # Shared types: Tab, TabStatus, PermissionMode, IpcMessage
  preload.ts       # contextBridge API (18 methods)
  hooks/           # Node.js scripts invoked by Claude Code hooks
    pipe-send.js   # Shared helper: sends JSON to named pipe
    on-session-start.js, on-prompt-submit.js, on-tool-use.js,
    on-stop.js, on-notification.js, on-session-end.js
tests/             # Mirrors src/ structure, 40 tests across 9 files
```

## Key Architecture Decisions

- **node-pty on Windows**: Must spawn `cmd.exe /c claude` because node-pty cannot resolve `.cmd` wrappers directly.
- **No electron-store**: Replaced with plain `fs.readFileSync`/`fs.writeFileSync` JSON store. electron-store v11 ESM-only export causes "Store is not a constructor" in Electron's CJS context.
- **Hook communication**: Claude Code hooks -> Node.js scripts -> Windows named pipe -> main process -> renderer. No output parsing.
- **Hooks MUST be Node.js, not bash**: Claude Code on Windows executes hook commands via `cmd.exe`. `bash` is NOT in the Windows PATH (it lives inside Git Bash/MSYS2). `node` IS in the PATH. All hook scripts must be `.js` files invoked with `node`, never `.sh` files invoked with `bash`.
- **Hook args: use env vars, not CLI args for paths**: Windows cmd.exe mangles backslashes in CLI arguments (e.g., `\\.\pipe\name` becomes `\.\pipe\name`). Hook scripts read `CLAUDE_TERMINAL_TAB_ID` and `CLAUDE_TERMINAL_PIPE` from environment variables (set on the PTY process, inherited by Claude Code and its hook subprocesses) to avoid this.
- **Electron Forge `app.getAppPath()`**: In dev mode with Vite, returns `.vite/build/`, NOT the project root. Use `__dirname` with relative traversal to find project files (e.g., `path.join(__dirname, '..', '..', 'src', 'hooks')`).
- **Terminal caching**: xterm.js instances are cached per tabId in a `Map` so switching tabs preserves scrollback.
- **Preload security**: All renderer-to-main communication goes through `contextBridge`. No `nodeIntegration`, strict `contextIsolation`, `sandbox: true`.

## Building and Running

```bash
pnpm install
pnpm start        # Dev mode with hot reload
pnpm run test     # 40 tests
pnpm run make     # Package for distribution
```

## Testing

Tests use Vitest with jsdom environment. Native modules (node-pty, electron) are mocked. Settings store tests use real temp files. IPC server tests use real named pipes.

```bash
pnpm run test           # Single run
pnpm run test:watch     # Watch mode
```

## Rules

- **NEVER merge worktree branches into master (or any other branch) without explicit user permission.** Worktrees are isolated for a reason. Always ask before merging, rebasing, or otherwise integrating worktree branches.

## Common Patterns

- **Path aliases**: `@shared/*` -> `src/shared/*`, `@main/*` -> `src/main/*` (configured in tsconfig.json, vitest.config.ts, vite.main.config.mjs)
- **IPC**: `ipcMain.handle` for request/response, `ipcMain.on` for fire-and-forget (PTY write/resize)
- **Tab status flow**: `new` -> `working` <-> `idle` / `requires_response` (driven by hooks)
- **Permission modes**: `default`, `plan`, `acceptEdits`, `bypassPermissions` (maps to CLI flags in `PERMISSION_FLAGS`)
