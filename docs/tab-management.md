# Tab Management

ClaudeTerminal's tab system manages multiple concurrent Claude Code sessions and shell terminals within a single Electron window. Each tab wraps a pseudo-terminal (PTY) and maintains its own lifecycle, status, working directory, and optional git worktree association.

## Tab Types

There are two tab types, defined in `src/shared/types.ts`:

```typescript
type TabType = 'claude' | 'shell';
```

### Claude tabs

Claude tabs spawn a Claude Code CLI process via `node-pty`. On Windows, the CLI is invoked through `cmd.exe /c claude ...` because node-pty cannot resolve `.cmd` wrappers directly. Claude tabs participate in the full status tracking system (hooks, AI naming, session persistence, notifications).

Each Claude tab can optionally be associated with a **git worktree** -- an isolated branch checked out under `.claude/worktrees/<name>`. When a worktree is specified, the tab's `cwd` is set to the worktree directory, and Claude Code's hooks are installed there.

### Shell tabs

Shell tabs spawn a platform-appropriate shell process. Available shells are detected at startup via the `shell:getAvailable` IPC channel and exposed to the renderer through `ShellContext`. Shell definitions live in `src/shared/platform.ts`.

| Platform | Shells | Detection |
|----------|--------|-----------|
| Windows | PowerShell, WSL, Command Prompt | WSL verified via async `wsl.exe --status` |
| macOS | Zsh, Bash | `fs.accessSync` with `X_OK` flag |
| Linux | Bash, Zsh, Fish | `fs.accessSync` with `X_OK` flag |

Shell tabs use a fixed `shell` status and do not participate in hook-based status tracking or session persistence. The `Tab.shellType` field identifies which shell is running (e.g. `'powershell'`, `'bash'`, `'zsh'`).

Shell tabs can be opened from the `+` menu, keyboard shortcuts, or from a Claude tab's chevron dropdown. When opened via the chevron, the shell inherits the Claude tab's working directory and is inserted immediately after it in the tab bar.

```
Claude Tab (cwd: D:\project\.claude\worktrees\feature-x)
  -> "PowerShell here" opens a PowerShell tab at the same cwd
  -> Inserted directly after the Claude tab in the tab order
```

## Tab Data Model

```typescript
interface Tab {
  id: string;           // Unique ID: "tab-{timestamp}-{random}"
  type: TabType;        // 'claude' | 'shell'
  name: string;         // Display name (user-editable)
  defaultName: string;  // Original name (for reset on /clear)
  status: TabStatus;    // Current lifecycle state
  worktree: string | null; // Worktree name, or null for root workspace
  sourceBranch: string | null; // Branch this worktree was created from
  cwd: string;          // Working directory path
  shellType: string | null; // Shell identifier (e.g. 'powershell', 'bash'), null for claude tabs
  pid: number | null;   // PTY process ID
  sessionId: string | null; // Claude session ID (for --resume)
  projectId: string;    // Project this tab belongs to (see docs/multi-project.md)
}
```

The `projectId` field links every tab to a specific project in the workspace. It is set at creation time by `TabManager.createTab()` and is immutable for the tab's lifetime. When multiple projects are open, the tab bar filters tabs by the active project using this field. See [Multi-Project Workspaces](multi-project.md) for details.

Default naming:
- Claude tabs: worktree name if set, otherwise `New Tab`
- Shell tabs: derived from `ShellOption.defaultName` (e.g. `PowerShell`, `Bash`, `Zsh`)

## Tab Lifecycle

### Creation Flow

```
User action (Ctrl+T, +menu, CLI auto-start)
  -> renderer calls window.claudeTerminal.createTab(projectId, worktree?, resumeSessionId?, savedName?)
    -> IPC: tab:create
      -> Resolve ProjectContext from projectId via ProjectManager
      -> TabManager.createTab(cwd, worktree, 'claude', savedName, projectId)
      -> HookInstaller.install() -- writes .claude/settings.local.json in tab's cwd
      -> PtyManager.spawn() -- spawns cmd.exe /c claude [...flags]
         Environment vars injected:
           CLAUDE_TERMINAL_TAB_ID = tab.id
           CLAUDE_TERMINAL_PIPE = \\.\pipe\claude-terminal-{pid}
           CLAUDE_TERMINAL_TMPDIR = os.tmpdir()
      -> Wire proc.onData -> flow-controlled forwarding to renderer
      -> Wire proc.onExit -> cleanup and tab removal
      -> Return Tab to renderer
    -> renderer adds Tab to state, activates it
    -> Terminal component creates xterm.js instance, attaches to PTY data stream
```

For shell tabs, the flow is simpler:

```
User action (Ctrl+Shift+P, Ctrl+L, chevron menu)
  -> IPC: tab:createShell(shellType, afterTabId?, cwd?)
    -> Derive projectId from afterTabId or first project
    -> TabManager.createTab(cwd, null, 'shell', undefined, projectId, null, shellType)
    -> PtyManager.spawnShell() -- resolves command from platform.ts, spawns the shell
    -> Wire onData/onExit (same as Claude tabs, minus hook infrastructure)
    -> If afterTabId provided: insert tab after the specified tab
```

### Session Restore

On startup, ClaudeTerminal checks for saved sessions in `<workspace>/.claude-terminal/sessions.json`. Each saved Claude tab is re-created with `--resume <sessionId>` to restore the previous conversation. The saved tab name is preserved via a flag file mechanism that prevents AI re-naming.

```typescript
interface SavedTab {
  name: string;
  cwd: string;
  worktree: string | null;
  sessionId: string;
}
```

Only Claude tabs that have a `sessionId` and a non-`new` status are persisted. Shell tabs are not saved.

### Removal Flow

```
User closes tab (Ctrl+F4, click X)
  -> handleCloseTab(tabId)
    -> For worktree tabs: check worktree status (clean/dirty)
      -> Show WorktreeCloseDialog: keep worktree or remove it?
    -> IPC: tab:close(tabId, removeWorktree?)
      -> PtyManager.kill() -- taskkill /PID {pid} /T /F on Windows
      -> Clean up flow control state
      -> Clean up naming flag file
      -> If removeWorktree: WorktreeManager.remove(cwd)
      -> TabManager.removeTab()
      -> Notify renderer: tab:removed
      -> persistSessions()
    -> renderer: destroyTerminal() disposes xterm.js instance
    -> renderer: update active tab to first remaining tab
```

Process exit also triggers cleanup:

```
PTY process exits (user types /exit, process crashes, etc.)
  -> proc.onExit callback
    -> cleanupNamingFlag()
    -> TabManager.removeTab()
    -> Notify renderer: tab:removed
    -> persistSessions()
```

## Status State Machine

Claude tabs track their lifecycle through a status state machine. Status changes are driven by Claude Code hooks (see `docs/hooks.md`), processed by the hook router in `src/main/hook-router.ts`.

```
                    SessionStart
                        |
                        v
  +----------+    +----------+    PreToolUse    +----------+
  |          |    |          |  ------------->  |          |
  |   new    |--->| idle /   |                  | working  |
  |          |    | requires |  <-------------  |          |
  +----------+    | response |    Stop /        +----------+
                  +----------+    Notification       |
                       ^                             |
                       |         PreToolUse          |
                       +-----------------------------+
                       |
                    /clear
                  (resets to new via tab:ready)
```

### Status Values

| Status | Meaning | Set By |
|--------|---------|--------|
| `new` | Tab just created, or session restarted via `/clear` | `tab:create`, `tab:ready` hook event |
| `working` | Claude is executing tools or generating a response | `PreToolUse` hook (`tab:status:working`) |
| `idle` | Claude finished a response, waiting for next prompt | `Stop` hook (`tab:status:idle`) |
| `requires_response` | Claude is waiting for user input (permission prompt, etc.) | `Notification` hook (`tab:status:input`) |
| `shell` | Shell tab (PowerShell/WSL) -- static, never changes | Set at creation, never updated |

### Visual Indicators

Each status has a distinct icon in the tab bar and status bar, rendered by `TabIndicator.tsx`:

| Status | Icon | Animation | Lucide Component |
|--------|------|-----------|-----------------|
| `new` | Empty circle | None | `Circle` |
| `working` | Spinner | Rotating | `Loader2` |
| `idle` | Checkmark circle | None | `CheckCircle2` |
| `requires_response` | Speech bubble | Pulsing | `MessageCircle` |
| `shell` | Terminal icon | None | `SquareTerminal` (powershell) / penguin (wsl) |

The status bar at the bottom of the window aggregates counts across all tabs and shows repository hook execution status:

```
[spinner] 2  [check] 1  [bubble] 1   ⟳ Install dependencies...   Ctrl+T Claude | Ctrl+W Worktree | ...
```

Hook status is shown between tab counts and keyboard shortcuts:
- Running: `⟳ hookName...` (yellow)
- Done: `✓ hookName` (green, auto-dismisses after 3s)
- Failed: `✗ hookName` (red, persists until next hook runs; hover for error details)

### Window Title

The window title reflects aggregate tab status via `buildWindowTitle()`:

```
ClaudeTerminal - D:\project (main) [Busy]        // at least one tab is working
ClaudeTerminal - D:\project (main) [Needs Attention]  // at least one tab requires input
ClaudeTerminal - D:\project (main) [Idle]         // all tabs idle
```

## Tab Operations

### Rename

**Manual rename** -- Double-click the tab name or press `F2`. The tab name becomes an editable input field. Press Enter to confirm, Escape to cancel. Blurring the input also commits the rename. The rename is persisted via `tab:rename` IPC and saved to `sessions.json`.

**AI auto-naming** -- On the first user prompt in a Claude tab, the `UserPromptSubmit` hook sends the prompt text (first 500 characters) to the main process. The `TabNamer` spawns a separate Claude Haiku process (`claude -p --no-session-persistence --model claude-haiku-4-5-20251001`) with a prompt asking for a 3-5 word tab title. The result is trimmed to 50 characters and applied as the tab name.

A flag file at `${TMPDIR}/claude-terminal-named-${tabId}` prevents re-naming on subsequent prompts. The flag is checked by the `on-prompt-submit.js` hook script. When the user runs `/clear`, the flag is deleted and the tab name resets to the default, allowing the next prompt to trigger a new name.

Tabs restored with a saved name have the flag pre-created to prevent overwriting the saved name.

### Drag-and-Drop Reorder

Tabs support native HTML5 drag-and-drop reordering:

1. `onDragStart` stores the dragged tab ID in a ref
2. `onDragOver` shows a visual drop indicator on the target tab
3. `onDrop` splices the tab array to move the dragged tab to the drop position
4. The reordered ID list is sent via `tab:reorder` IPC (fire-and-forget)
5. `TabManager.reorderTabs()` rebuilds the internal `Map` to match the new order

The `tab-bar-dragging` CSS class is applied during drag to adjust visual feedback.

### Close with Worktree Cleanup

When closing a tab that has a worktree association:

1. `handleCloseTab` checks the worktree's git status via `worktree:checkStatus`
2. A `WorktreeCloseDialog` appears showing:
   - Whether the worktree has uncommitted changes and how many
   - Options: "Close and remove worktree" or "Close but keep worktree"
3. The user's choice is passed as `removeWorktree` to `tab:close`
4. If removing, `WorktreeManager.remove()` runs `git worktree remove`

## Permission Modes

The startup dialog and settings allow choosing a permission mode that applies to all Claude tabs in the session. The mode maps to CLI flags passed when spawning each Claude process:

```typescript
const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default:           [],
  plan:              ['--plan'],
  acceptEdits:       ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};
```

| Mode | CLI Flags | Behavior |
|------|-----------|----------|
| `default` | (none) | Normal Claude Code -- asks permission for tool use |
| `plan` | `--plan` | Read-only planning mode, no tool execution |
| `acceptEdits` | `--allowedTools Edit,Write,NotebookEdit` | Auto-approve file edits, prompt for other tools |
| `bypassPermissions` | `--dangerously-skip-permissions` | Auto-approve all tool use without prompting |

The permission mode is persisted in `claude-terminal-settings.json` and applied on next launch. It cannot be changed per-tab -- it is session-wide.

## Desktop Notifications

Desktop notifications fire when a **background** (non-active) Claude tab transitions to `idle` or `requires_response`. This is handled in `hook-router.ts`:

```typescript
case 'tab:status:idle':
  tabManager.updateStatus(tabId, 'idle');
  if (!isActive) {
    notifyTabActivity(tabId, tab.name, 'Claude has finished working');
  }
  break;

case 'tab:status:input':
  tabManager.updateStatus(tabId, 'requires_response');
  if (!isActive) {
    notifyTabActivity(tabId, tab.name, 'Claude needs your input');
  }
  break;
```

Clicking a notification brings the window to front (`win.show()`, `win.focus()`) and switches to the relevant tab.

Shell tabs and the currently active tab never trigger notifications.

## Flow Control

PTY output can arrive faster than xterm.js can render it. The system uses a two-layer flow control mechanism to prevent memory buildup:

**Renderer side** (`Terminal.tsx`):
- Tracks pending (unrendered) bytes per tab in `pendingBytes`
- When pending exceeds `HIGH_WATERMARK` (50KB): sends `pty:pause` to main process
- When pending drops below `LOW_WATERMARK` (10KB): sends `pty:resume`

**Main process side** (`ipc-handlers.ts`):
- Each tab has a `flowControl` entry: `{ paused: boolean, buffer: string[] }`
- When paused, PTY data is buffered in memory instead of being sent to renderer
- On resume, the buffer is flushed in order

## Close Guard

When the user closes the Electron window while tabs are still in `working` status, a confirmation dialog appears:

```
Close ClaudeTerminal?
2 tabs are still running
Tab Name 1, Tab Name 2
[Close] [Cancel]
```

## Key Files

| File | Role |
|------|------|
| `src/shared/types.ts` | `Tab`, `TabStatus`, `TabType`, `PermissionMode`, `SavedTab`, `ProjectConfig`, `PERMISSION_FLAGS` |
| `src/main/tab-manager.ts` | In-memory tab store: create, remove, rename, reorder, status updates, project filtering |
| `src/main/project-manager.ts` | `ProjectManager` — per-project context (worktree, hooks, etc.) used during tab creation |
| `src/main/pty-manager.ts` | PTY lifecycle: spawn Claude/shell processes, write, resize, kill |
| `src/main/ipc-handlers.ts` | IPC handler registration: `tab:create`, `tab:close`, `tab:rename`, `tab:reorder`, etc. |
| `src/main/hook-router.ts` | Routes hook messages to status updates, notifications, and AI naming |
| `src/main/tab-namer.ts` | Spawns Claude Haiku to generate tab names from first prompt |
| `src/main/hook-installer.ts` | Writes `.claude/settings.local.json` with hook commands into tab's cwd |
| `src/main/settings-store.ts` | Persists settings and per-directory session data (`sessions.json`) |
| `src/main/index.ts` | Wires all modules together, manages app lifecycle and session persistence |
| `src/renderer/App.tsx` | Top-level React component: tab state, keyboard shortcuts, session startup |
| `src/renderer/components/TabBar.tsx` | Tab bar UI: renders tabs, `+` menu, drag-and-drop |
| `src/renderer/components/Tab.tsx` | Individual tab UI: click, rename, close, chevron dropdown, drag handlers |
| `src/renderer/components/TabIndicator.tsx` | Status icon rendering per tab status |
| `src/renderer/components/Terminal.tsx` | xterm.js terminal: PTY data binding, flow control, resize |
| `src/renderer/components/terminalCache.ts` | Caches xterm.js instances across tab switches to preserve scrollback |
| `src/renderer/components/StatusBar.tsx` | Bottom bar: aggregated status counts, hook execution status, shortcut hints |
| `src/shared/claude-cli.ts` | `getClaudeCommand()`: wraps `claude` in `cmd.exe /c` on Windows |
| `src/shared/window-title.ts` | `buildWindowTitle()`: builds title from workspace, branch, and tab status |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New Claude tab (root workspace) |
| `Ctrl+W` | New Claude tab with worktree (opens name dialog) |
| `Ctrl+P` | Open project switcher dialog |
| `Ctrl+Shift+P` | New PowerShell tab |
| `Ctrl+L` | New WSL tab |
| `Ctrl+F4` | Close active tab |
| `Ctrl+Tab` | Switch to next tab (within active project) |
| `Ctrl+Shift+Tab` | Switch to previous tab (within active project) |
| `Ctrl+1` through `Ctrl+9` | Jump to tab by position (within active project) |
| `F2` | Rename active tab |
| `Ctrl+Enter` | Insert newline in Claude prompt (instead of submitting) |
| `Right-click` | Copy selection, or paste from clipboard if no selection |
| `Ctrl+Shift+I` | Toggle DevTools |

Shortcuts are handled in two layers:
1. **xterm.js filter** (`Terminal.tsx`): `attachCustomKeyEventHandler` returns `false` for app-level shortcuts, letting them bubble to the window handler instead of being consumed by the terminal.
2. **Window handler** (`App.tsx`): A `keydown` listener on `window` handles all the shortcuts listed above.
