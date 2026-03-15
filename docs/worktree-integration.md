# Worktree Integration

ClaudeTerminal uses Git worktrees to give each Claude Code instance its own isolated working directory and branch. This lets multiple Claude sessions work on separate tasks within the same repository without conflicts, while the main worktree stays on its original branch.

## How It Works

```
User presses Ctrl+W
  -> WorktreeNameDialog prompts for a name
    -> WorktreeManager.create() runs `git worktree add` + `git branch`
      -> IPC handler creates a tab with cwd set to the worktree directory
        -> Claude Code spawns inside .claude/worktrees/{name}
```

## WorktreeManager

`WorktreeManager` is a synchronous wrapper around Git CLI commands. It is instantiated once per session in `session:start` with the workspace root directory and stored on the shared `AppState`.

### create(name)

Creates a new worktree at `.claude/worktrees/{name}` branched from the current branch:

```
git worktree add ".claude/worktrees/{name}" -b "{name}" "{currentBranch}"
```

The branch name matches the worktree directory name. Returns the absolute path to the new worktree.

### listDetails()

Runs `git worktree list`, parses the output, then skips the first entry (the main worktree). For each remaining worktree, runs `git status --porcelain` to determine clean/dirty state and change count.

Returns an array of:

```typescript
interface WorktreeDetails {
  name: string;        // directory basename (= branch name)
  path: string;        // absolute path
  clean: boolean;      // true if no uncommitted changes
  changesCount: number; // number of changed files
}
```

### checkStatus(worktreePath)

Runs `git status --porcelain` in the given worktree directory. Returns `{ clean, changesCount }`. Used by the tab close flow to decide whether to prompt the user about uncommitted changes.

### remove(worktreePath)

Two-step removal:

1. `git worktree remove "{path}" --force` -- removes the worktree directory
2. `git branch -D "{branchName}"` -- force-deletes the associated branch

The branch name is derived from `path.basename(worktreePath)`. The branch deletion is best-effort (silently catches errors if the branch was already merged or deleted).

### getCurrentBranch()

Runs `git rev-parse --abbrev-ref HEAD` in the root directory. Used by the worktree name dialog to display the base branch, and by the branch tracking system described below.

## Branch Tracking

The main process watches `.git/HEAD` using `fs.watch()` to detect branch changes in the main worktree. This is set up inside the `session:start` IPC handler.

When the file changes:

1. A 1-second debounce timer starts (prevents rapid-fire events during rebases or other multi-step Git operations).
2. After the debounce, `WorktreeManager.getCurrentBranch()` reads the new branch name.
3. The branch name is sent to the renderer via `git:branchChanged`.
4. The renderer stores it in state and calls `buildWindowTitle()` to update the window title.

The window title format is: `ClaudeTerminal - {workspaceDir} ({branch}) [{status}]`

Where `{status}` is `Needs Attention`, `Busy`, or `Idle` based on aggregate tab states.

## Worktree-Scoped Tabs

Each `Tab` object has a `worktree` field (the worktree name, or `null` for main-worktree tabs):

```typescript
interface Tab {
  id: string;
  worktree: string | null;  // e.g. "feature-login" or null
  cwd: string;              // absolute path to working directory
  // ...
}
```

When `tab:create` is called with a worktree name, the IPC handler computes the tab's `cwd` as:

```
path.join(workspaceDir, '.claude', 'worktrees', worktreeName)
```

The `TabManager.createTab()` method uses the worktree name as the tab's default display name (instead of the usual "Tab N" numbering).

### Session Persistence

Saved tabs include the `worktree` field. On restore (`session:getSavedTabs`), the handler filters out any worktree tabs whose directories no longer exist on disk. This handles the case where a worktree was removed outside ClaudeTerminal.

## UI Dialogs

### WorktreeNameDialog

Opened by `Ctrl+W` or the hamburger menu. A single-input dialog that:

1. Fetches and displays the current branch as "Base branch: {name}" so the user knows what they are branching from.
2. Validates the worktree name using `validateWorktreeName()`, which enforces Git branch naming rules (no spaces, no `..`, no control characters, no `~^:?\*[`, cannot start/end with `.` or `/`).
3. On submit, calls `createWorktree(name)` then `createTab(name)`.

### WorktreeManagerDialog

Opened from the hamburger menu ("Manage Worktrees"). Displays a table of all worktrees with:

| Column | Content |
|--------|---------|
| Name | Directory basename |
| Status | `clean` or `dirty` badge |
| Changes | Number of uncommitted files |
| Open | Dot indicator if a tab is open for this worktree |
| Actions | Open Claude tab, open shell (platform-dependent), delete |

Delete behavior:
- **Clean worktree**: Shows inline confirmation ("Delete worktree?") with Delete/Cancel buttons.
- **Dirty worktree**: Shows inline confirmation ("Uncommitted changes. Delete?") with Delete/Cancel buttons.

All worktree deletions require explicit confirmation regardless of clean/dirty state.

The dialog checks for open tabs by comparing `tab.worktree` against each worktree name. Note that deleting a worktree from this dialog does **not** close any open tabs for it -- the tab's PTY process will continue running in the (now-removed) directory.

### WorktreeCloseDialog

Shown when the user closes a worktree tab (not when deleting from the manager). Behavior depends on worktree status:

**Clean worktree** (no uncommitted changes):
- Message: "Worktree {name} has no uncommitted changes."
- Buttons: **Remove** (default, autofocused) | **Keep**

**Dirty worktree** (has uncommitted changes):
- Message: "Worktree {name} has N uncommitted change(s)."
- Buttons: **Cancel** (default, autofocused) | **Keep worktree** | **Remove** (danger-styled)

The dialog calls `onConfirm(removeWorktree: boolean)` which maps to `closeTab(tabId, removeWorktree)`.

## Tab Close Flow

When the user closes a worktree tab, this sequence runs:

```
handleCloseTab(tabId)
  1. Look up the tab. Is tab.worktree set?
     - No  -> closeTab(tabId) immediately
     - Yes -> continue to step 2
  2. checkWorktreeStatus(tab.cwd)
     - Error -> closeTab(tabId) without removing worktree (fail-safe)
     - Success -> show WorktreeCloseDialog with {clean, changesCount}
  3. User picks an option in the dialog:
     - Cancel -> do nothing, tab stays open
     - Keep   -> closeTab(tabId, false)  -- kills PTY, removes tab, worktree stays
     - Remove -> closeTab(tabId, true)   -- kills PTY, removes tab, removes worktree + branch
```

On the main process side, `tab:close` with `removeWorktree=true`:

1. Kills the PTY process.
2. Calls `WorktreeManager.remove(tab.cwd)` which runs `git worktree remove --force` and `git branch -D`.
3. Removes the tab from `TabManager`.
4. Notifies the renderer via `tab:removed`.
5. Persists remaining sessions.

## Preload API

The worktree-related methods exposed to the renderer via `contextBridge`:

```typescript
// Create a new worktree, returns its absolute path
createWorktree(name: string): Promise<string>

// Get the current branch of the main worktree
getCurrentBranch(): Promise<string>

// List all worktrees (excluding main) with status details
listWorktreeDetails(): Promise<WorktreeDetails[]>

// Remove a worktree and its branch
removeWorktree(worktreePath: string): Promise<void>

// Check clean/dirty status of a specific worktree
checkWorktreeStatus(worktreePath: string): Promise<{ clean: boolean; changesCount: number }>
```

Events:

```typescript
// Fires when .git/HEAD changes (debounced 1s)
onBranchChanged(callback: (branch: string) => void): () => void
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main/worktree-manager.ts` | Git worktree CLI wrapper (create, list, remove, status) |
| `src/main/ipc-handlers.ts` | IPC handlers for `worktree:*` channels + git HEAD watcher |
| `src/main/tab-manager.ts` | Tab creation with worktree name and cwd |
| `src/renderer/components/WorktreeNameDialog.tsx` | Name input dialog for new worktree tabs |
| `src/renderer/components/WorktreeManagerDialog.tsx` | List/delete/open worktrees |
| `src/renderer/components/WorktreeCloseDialog.tsx` | Confirm remove/keep on tab close |
| `src/renderer/App.tsx` | Dialog state, close flow orchestration, branch tracking |
| `src/renderer/utils/validate-worktree-name.ts` | Git branch name validation rules |
| `src/shared/types.ts` | `Tab` interface with `worktree` and `cwd` fields |
| `src/shared/window-title.ts` | Window title builder (includes branch name) |
| `src/preload.ts` | Renderer-to-main bridge for worktree operations |
