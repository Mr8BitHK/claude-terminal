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
- **Do NOT commit or push unless the user asks.** Batch your changes and let the user decide when to commit. Never continuously commit after each small fix.

## Documentation

Feature architecture docs live in `docs/`. Start with the overview docs, then dive into feature-specific docs as needed.

### Overview

| Doc | Contents |
|-----|----------|
| [Architecture](docs/architecture.md) | System design, process model, data flow diagrams, security model |
| [Getting Started](docs/getting-started.md) | Prerequisites, installation, usage guide, troubleshooting |
| [Development](docs/development.md) | Dev setup, code organization, testing, adding features |

### Feature Docs

| Doc | Contents |
|-----|----------|
| [Tab Management](docs/tab-management.md) | Tab types (claude/shell), lifecycle, status state machine, drag-drop, rename, AI auto-naming, permission modes |
| [PTY Management](docs/pty-management.md) | Process spawning (ConPTY), I/O data flow, flow control (backpressure), process termination, resize |
| [Terminal Rendering](docs/terminal-rendering.md) | xterm.js integration, instance caching, key event filtering, resize handling, flow control, serialization |
| [Hook System](docs/hooks.md) | Claude Code hook scripts, named pipe IPC, hook installation, message format, event types |
| [Worktree Integration](docs/worktree-integration.md) | Git worktree CRUD, branch tracking, worktree-scoped tabs, close dialogs (dirty state handling) |
| [Startup Dialog](docs/startup-dialog.md) | Directory selection (recent list, browse, double-click-to-open), permission mode picker, session launch flow |
| [Session Persistence](docs/session-persistence.md) | Two-tier persistence (global settings + per-directory sessions), tab restoration, recent dirs |
| [Remote Access](docs/remote-access.md) | Cloudflare tunnel, WebSocket server, PIN auth, terminal serialization, web client |
| [IPC Architecture](docs/ipc.md) | Preload bridge, IPC patterns (handle/send/event), channel reference, type safety |

### Keeping Docs Up to Date

Documentation must stay in sync with code. When implementing or changing a feature:

1. **Identify affected docs.** Check the feature docs table above — most changes touch at least one doc. If you add a new IPC channel, update `docs/ipc.md`. If you change tab status flow, update `docs/tab-management.md`. And so on.
2. **Update existing docs** to reflect the change — new flows, changed behavior, removed features, renamed types. Don't leave stale information.
3. **New feature = new doc.** If a feature doesn't fit into any existing doc, create `docs/<feature-name>.md` and add a row to the feature docs table above.
4. **Doc style.** Match the existing docs: technical prose, ASCII flow diagrams for data/control flow, TypeScript code blocks for types/interfaces, tables for structured references, a "Key Files" table at the end. No fluff.
5. **Update this table.** When adding or removing a doc, update the feature docs table in this section so AGENTS.md stays the single index of all documentation.

## Code Review Standards

### IPC & Preload

- New IPC channels follow `noun:action` naming (`tab:create`, `pty:write`).
- Use `ipcMain.handle` for request/response, `ipcMain.on` for fire-and-forget.
- Every new channel needs: main handler (`ipc-handlers.ts`) + preload method (`preload.ts`) + type in `global.d.ts` + assertion in the registration test (`tests/main/ipc-handlers.test.ts`).
- Explicitly decide whether a new channel is available remotely. If yes, add handling in `WebRemoteServer.handleMessage()` and the web client's `ws-bridge.ts`. If no, add a stub/no-op in `ws-bridge.ts` and document why it's local-only.

### Remote / Local Parity

- New features must consider remote access: will remote clients see this? Can they trigger it? Should they?
- Channels broadcast to remote are explicitly listed in `sendToRenderer()` (`src/main/index.ts`). New broadcast channels must be added there.
- Destructive operations (close tab, remove worktree, resize PTY) stay local-only by default.
- The web client's `WebSocketBridge` must stub any new preload API method, even if it throws or no-ops.

### Type Safety

- Use `import type` for type-only imports.
- No `as any` without a justifying comment.
- Shared types go in `src/shared/types.ts`.

### Security

- Validate path parameters before `path.join()` — reject `..` and absolute paths.
- Process spawn must use array args (no shell interpolation of user input).
- No credentials or tokens in logs.
- Remote auth token comparison uses `crypto.timingSafeEqual` — keep it that way.

### React

- `useEffect` listeners must return cleanup functions.
- Use `useRef` for values accessed inside event handlers (avoid stale closures).
- `useCallback` for handlers passed as props to children.

### Logging

- Use the `log` module (`src/main/logger.ts`), never `console.log`.

### Documentation

- Feature changes must update the corresponding doc in `docs/` per the documentation table above.

## Common Patterns

- **Path aliases**: `@shared/*` -> `src/shared/*`, `@main/*` -> `src/main/*` (configured in tsconfig.json, vitest.config.ts, vite.main.config.mjs)
- **IPC**: `ipcMain.handle` for request/response, `ipcMain.on` for fire-and-forget (PTY write/resize)
- **Tab status flow**: `new` -> `working` <-> `idle` / `requires_response` (driven by hooks)
- **Permission modes**: `default`, `plan`, `acceptEdits`, `bypassPermissions` (maps to CLI flags in `PERMISSION_FLAGS`)
