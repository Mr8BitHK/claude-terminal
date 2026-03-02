# Multi-Project Workspaces Design

## Problem

ClaudeTerminal is currently one window = one project directory. Users who work across multiple repos must open separate ClaudeTerminal instances and Alt-Tab between them, losing cross-project visibility (which sessions are idle, working, or need input).

## Solution

Support multiple projects per window via a collapsible sidebar, with workspace persistence and project-scoped color tinting.

## Prerequisite: Hook Installer Fix

Before multi-project work begins, fix `HookInstaller.install()` to read-merge-write `settings.local.json` instead of blindly overwriting it:

- Read existing `settings.local.json` if present
- Identify ClaudeTerminal hooks by command path (contains our hooks dir)
- Remove our old hook entries, add current hooks, preserve all other content
- Add an `uninstall(targetDir)` method that removes only our hooks (or deletes the file if nothing remains)
- Ship this fix independently

## Data Model

### ProjectContext (main process, per-project)

```typescript
interface ProjectContext {
  id: string;              // stable uuid
  dir: string;             // absolute path to project root
  color: string;           // auto-assigned from palette
  worktreeManager: WorktreeManager | null;  // null if not a git repo
  hookConfigStore: HookConfigStore | null;
  hookEngine: HookEngine | null;
}
```

### Workspace (persisted)

Stored in `%APPDATA%/claude-terminal/workspaces/<id>.json` (or platform equivalent).

```typescript
interface Workspace {
  id: string;
  name: string;
  projects: Array<{ id: string; dir: string; color: string }>;
  activeProjectId: string;
  geometry: { x: number; y: number; width: number; height: number };
}
```

### Tab (extended)

```typescript
interface Tab {
  // ...existing fields...
  projectId: string;  // links to ProjectContext.id
}
```

### AppState (cleaned up)

```typescript
interface AppState {
  workspaceId: string;
  projectManager: ProjectManager;  // Map<projectId, ProjectContext>
  tabManager: TabManager;          // all tabs across all projects
  pipeName: string;
  // workspaceDir, worktreeManager, hookConfigStore, hookEngine — REMOVED
}
```

The old `workspaceDir` singleton and its associated managers are replaced entirely by `ProjectManager`. No backward compatibility layer.

### Session Persistence

- **Workspace file** (`%APPDATA%/claude-terminal/workspaces/<id>.json`): project list, colors, geometry, active project
- **Per-project sessions** (`<projectDir>/.claude-terminal/sessions.json`): tab sessions per project (unchanged format)
- Same project can appear in multiple workspaces; tab sessions are shared

## UI Layout

### Sidebar (left, always visible)

**Collapsed state (~48-60px):**
- Vertical tabs rotated 90 degrees counter-clockwise
- Each tab shows: project dir name + status counts (e.g., "claude-terminal 2 idle 1 working") in the project's assigned color
- Clicking a tab switches the active project
- Active tab visually distinct (brighter, left border)
- "+" button at bottom to add a project (opens directory picker)

**Expanded state (~200px):**
- Same content laid out horizontally: name, full path, detailed status counts
- Right-click context menu: Remove from workspace, Open in Explorer
- Toggle expand/collapse via button or keybinding

### Tab Bar (top)

- Shows only the active project's tabs (not all projects)
- Background tinted with the project's assigned color
- Otherwise unchanged: drag-to-reorder, rename, close, shell tab, worktree sub-label

### Color Tinting

Applied consistently across four surfaces for at-a-glance project identification:
- Tab bar background
- Status bar background
- Thin border around the terminal area (left/bottom/right, connecting tab bar to status bar)
- Sidebar tab for the active project

### Status Bar (bottom)

- Shows tab counts for the active project only
- Background tinted with project color
- Keybinding help unchanged

### Window Title

`<workspace name> - <active project name> (<branch>)`

### Ctrl+P Project Switcher

- Modal overlay with list of all projects in the workspace
- Keyboard navigable (arrow keys + Enter)
- Shows: project name, directory, color swatch, tab count, aggregate status
- "Add Project..." option at the bottom
- OK / Cancel buttons
- Double-click also selects

### Toast Notifications

- When a background project's tab triggers a notification, the toast includes the project name
- Clicking the toast switches to that project AND activates the relevant tab
- Toast handler carries both `projectId` and `tabId`

## Architecture

### ProjectManager (main process)

```
Map<projectId, ProjectContext>
```

- `addProject(dir)` -> create ProjectContext, install hooks (read-merge-write), assign next color from palette, init WorktreeManager if git repo
- `removeProject(projectId)` -> clean up managers, uninstall hooks from settings.local.json, close all project's tabs
- `getProjectForTab(tabId)` -> lookup via tab.projectId

### Tab Creation Flow

1. User clicks "+" in tab bar -> `tab:create` IPC includes `projectId`
2. Main process spawns PTY with `cwd = project.dir`
3. Hooks already installed for that project (on `addProject()`)
4. Tab gets `projectId` field set

### Project Switching Flow

1. User clicks sidebar tab or Ctrl+P -> `project:switch` IPC with `projectId`
2. Renderer hides current project's terminals, shows new project's terminals
3. Tab bar re-renders with new project's tabs
4. Color tint updates across tab bar, border, status bar
5. Window title updates

### Hook Message Routing

- Hook pipe stays global per-process (`\\.\pipe\claude-terminal-<pid>`)
- `handleHookMessage` receives `{ tabId, event, data }`
- Look up `tab.projectId` -> route to correct ProjectContext
- If `tab.projectId !== activeProjectId`, show toast with project name

### Startup / Restore Flow

1. App launches -> check for workspace files in `%APPDATA%/claude-terminal/workspaces/`
2. If workspaces exist -> show workspace picker (list of saved workspaces + "New Workspace")
3. Select workspace -> open window, iterate projects, install hooks, restore tabs from each project's `sessions.json`
4. "New Workspace" -> startup dialog to pick first directory -> creates workspace file
5. Ctrl+N -> opens workspace picker (same as startup)

### Color Palette

Auto-assigned, cycling through a predefined set of distinguishable colors:
- Blue, Green, Orange, Purple, Teal, Red, Pink, Yellow (tuned for dark terminal backgrounds)
- First project gets the first color, second gets the second, etc.

## Migration

### From Single-Project to Workspaces

- On first launch after update: if no workspace files exist but `recentDirs` has entries, auto-create a workspace from the most recent directory
- Per-project `sessions.json` files are already compatible, no migration needed
- `recentDirs` repurposed as "recent projects to add" in the Ctrl+P switcher
- `permissionMode` stays global (not per-project)
- Clean cut: remove `workspaceDir` and singleton managers from `AppState` entirely
