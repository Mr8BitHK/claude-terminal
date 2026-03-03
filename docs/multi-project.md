# Multi-Project Workspaces

ClaudeTerminal supports running multiple projects simultaneously within a single window. Each project has its own directory, git worktree manager, hook engine, and color tint. Tabs are scoped to projects, and the UI provides a sidebar and switcher dialog for navigating between them.

## Concepts

A **workspace** is a runtime session that contains one or more **projects**. Each project corresponds to a directory on disk. The workspace is initialized when the user starts a session (via the StartupDialog or CLI), and additional projects can be added at any time.

```
Workspace (runtime session)
  ├── Project A  (D:\dev\frontend)    — blue tint, 3 tabs
  ├── Project B  (D:\dev\backend)     — green tint, 2 tabs
  └── Project C  (D:\dev\shared-lib)  — orange tint, 1 tab
```

When only one project is open, the UI is identical to the single-project experience — no sidebar, no project switching overhead. The multi-project UI appears automatically when a second project is added.

## Data Model

### ProjectConfig (shared type)

```typescript
interface ProjectConfig {
  id: string;        // Unique ID: "proj-{timestamp}-{random}"
  dir: string;       // Absolute directory path
  colorIndex: number; // Index into PROJECT_COLORS array
}
```

### WorkspaceConfig (shared type)

```typescript
interface WorkspaceConfig {
  id: string;
  name: string;
  projects: ProjectConfig[];
  activeProjectId: string;
  geometry: { x: number; y: number; width: number; height: number };
}
```

### PROJECT_COLORS

An 8-entry color palette used for per-project tinting. Each entry has a `name` and an HSL `hue` value:

```typescript
const PROJECT_COLORS = [
  { name: 'blue',   hue: 210 },
  { name: 'green',  hue: 140 },
  { name: 'orange', hue: 30  },
  { name: 'purple', hue: 270 },
  { name: 'teal',   hue: 180 },
  { name: 'red',    hue: 0   },
  { name: 'pink',   hue: 330 },
  { name: 'yellow', hue: 55  },
] as const;
```

Colors are assigned sequentially as projects are added. The color index wraps around the palette length.

### Tab.projectId

Every `Tab` now carries a `projectId: string` field that associates it with a specific project. This field is set at tab creation time and is immutable for the tab's lifetime.

```typescript
interface Tab {
  id: string;
  type: TabType;
  name: string;
  defaultName: string;
  status: TabStatus;
  worktree: string | null;
  cwd: string;
  pid: number | null;
  sessionId: string | null;
  projectId: string;           // <-- links tab to its project
}
```

## Architecture

### ProjectManager (main process)

`ProjectManager` is the central registry for all active projects in a workspace. It lives in the main process and is created during workspace initialization.

```
ProjectManager
  ├── Map<projectId, ProjectContext>
  │     ├── id, dir, colorIndex
  │     ├── WorktreeManager (if git repo)
  │     ├── HookConfigStore
  │     ├── HookEngine
  │     └── HookInstaller
  └── nextColorIndex (auto-increments)
```

Each project gets its own isolated set of managers:

- **WorktreeManager** — git worktree CRUD (only if the directory is a git repo)
- **HookConfigStore** — reads/writes `.claude-terminal/hooks.json` in the project dir
- **HookEngine** — executes repository hooks for events within this project
- **HookInstaller** — writes `.claude/settings.local.json` for Claude Code hooks

This isolation means projects never interfere with each other's worktrees, hooks, or hook configurations.

### WorkspaceStore (main process)

`WorkspaceStore` persists workspace configurations as individual JSON files in the Electron userData directory:

```
{userData}/workspaces/{workspaceId}.json
```

Each file contains a `WorkspaceConfig` with the list of projects, active project, and window geometry. This enables saving and restoring multi-project workspace layouts.

### Initialization Flow

```
session:start(dir, mode)
  -> Create ProjectManager with hooksDir and hook status callback
  -> Generate workspace ID
  -> ProjectManager.addProject(dir)
     -> Create WorktreeManager, HookConfigStore, HookEngine, HookInstaller
     -> Assign color index 0
  -> Install hooks in project dir
  -> Set up git HEAD watcher
  -> Emit app:started hook
  -> Return { projectId }
```

Adding a subsequent project:

```
project:add(dir)
  -> ProjectManager.addProject(dir)
     -> Check for duplicate (throws if already added)
     -> Auto-assign next color index
     -> Create all per-project managers
  -> Install hooks
  -> Set up git HEAD watcher
  -> Emit app:started hook
  -> Broadcast project:added to renderer
  -> Return ProjectConfig
```

### Tab Routing

When IPC handlers need project-specific resources (worktree manager, hook engine, etc.), they resolve the project context from the tab's `projectId`:

```
tab:create(projectId, worktree, resumeSessionId, savedName)
  -> Look up ProjectContext via ProjectManager.getProject(projectId)
  -> Use project's dir for cwd resolution
  -> Use project's hookInstaller for hook setup
  -> TabManager.createTab(..., projectId)  // projectId stored on Tab
```

For worktree, hook config, and git operations, the IPC handlers accept an optional `projectId` parameter and fall back to the first project if omitted (backward compatibility).

## UI Components

### ProjectSidebar

A vertical sidebar on the left side of the window. Only visible when more than one project is loaded.

```
┌──────────┬────────────────────────────────┐
│ ◀        │  Tab Bar                        │
├──────────┤                                 │
│ frontend │  Terminal                        │
│  ●2  ●1  │                                 │
│ backend  │                                 │
│          │                                 │
│ shared   │                                 │
├──────────┤                                 │
│    +     │  Status Bar                     │
└──────────┴────────────────────────────────┘
```

Features:
- **Collapse/expand toggle** — Collapses to 48px (icon-width) or expands to 200px. When collapsed, project names are displayed vertically.
- **Project list** — Each entry shows the directory basename and tab status counts (working, requires_response). The active project has a colored left border using the project's hue.
- **Add project button** — Opens the system directory picker to add a new project to the workspace.
- **Status counts** — Working tabs shown in warning color, requires_response tabs shown in attention color.

### ProjectSwitcherDialog

A quick-switch overlay opened with `Ctrl+P`. Lists all projects with keyboard navigation.

```
┌──────────────────────────────────┐
│  Switch Project                   │
├──────────────────────────────────┤
│  ● frontend                       │
│    D:\dev\frontend      3 tabs    │
│  ● backend                        │
│    D:\dev\backend       2 tabs    │
│  ● shared-lib                     │
│    D:\dev\shared-lib    1 tab     │
├──────────────────────────────────┤
│  + Add Project     Arrow/Enter    │
└──────────────────────────────────┘
```

Features:
- **Keyboard navigation** — Arrow keys to move selection, Enter to switch, Escape to cancel.
- **Color swatches** — Each project shows a colored dot matching its assigned hue.
- **Tab counts** — Shows how many tabs each project has.
- **Add project** — Footer link to add a new project without leaving the dialog.
- **Click-outside dismissal** — Clicking the backdrop closes the dialog.

## Per-Project Color Tinting

Each project is assigned a color from `PROJECT_COLORS` based on its `colorIndex`. The active project's hue is applied as a CSS custom property:

```typescript
document.documentElement.style.setProperty('--project-hue', String(hue));
```

The `--project-hue` variable is defined in `globals.css` with a default value of `0`:

```css
:root {
  --project-hue: 0;
}
```

This variable is used by the app's root border to provide a subtle color tint that identifies which project is active:

```tsx
<div className="flex flex-row h-screen border border-[hsl(var(--project-hue)_40%_25%)]">
```

When switching projects, the hue updates immediately, giving a visual cue for which project is in focus.

## Project-Scoped Tab Filtering

When a project is active, the tab bar and status bar only show tabs belonging to that project. This is computed in `App.tsx`:

```typescript
const activeProjectTabs = useMemo(
  () => activeProjectId ? tabs.filter(t => t.projectId === activeProjectId) : tabs,
  [tabs, activeProjectId]
);
```

The filtered list is passed to `TabBar` and `StatusBar`. Keyboard shortcuts for tab cycling (`Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1-9`) also operate within the active project's tabs.

All tabs from all projects remain mounted in the DOM (so terminal state is preserved), but only the active tab is visible.

## Workspace Persistence

Workspace configurations are stored via `WorkspaceStore` as JSON files in `{userData}/workspaces/`. Each file represents a workspace layout:

```json
{
  "id": "ws-1234567890-abc123",
  "name": "My Workspace",
  "projects": [
    { "id": "proj-1234567890-abc123", "dir": "D:\\dev\\frontend", "colorIndex": 0 },
    { "id": "proj-1234567890-def456", "dir": "D:\\dev\\backend", "colorIndex": 1 }
  ],
  "activeProjectId": "proj-1234567890-abc123",
  "geometry": { "x": 100, "y": 100, "width": 1200, "height": 800 }
}
```

IPC channels `workspace:list`, `workspace:save`, and `workspace:delete` manage this persistence layer.

## IPC Channels

### Workspace Initialization

| Channel | Direction | Pattern | Payload |
|---------|-----------|---------|---------|
| `workspace:init` | renderer -> main | invoke | `mode: PermissionMode` -> `string` (workspace ID) |

### Project Management

| Channel | Direction | Pattern | Payload |
|---------|-----------|---------|---------|
| `project:add` | renderer -> main | invoke | `dir: string, id?: string, colorIndex?: number` -> `ProjectConfig` |
| `project:remove` | renderer -> main | invoke | `projectId: string` |
| `project:list` | renderer -> main | invoke | -> `ProjectConfig[]` |
| `project:added` | main -> renderer | webContents.send | `project: ProjectConfig` |
| `project:removed` | main -> renderer | webContents.send | `projectId: string` |

### Workspace Persistence

| Channel | Direction | Pattern | Payload |
|---------|-----------|---------|---------|
| `workspace:list` | renderer -> main | invoke | -> `WorkspaceConfig[]` |
| `workspace:save` | renderer -> main | invoke | `ws: WorkspaceConfig` |
| `workspace:delete` | renderer -> main | invoke | `wsId: string` |

### Project-Scoped Events

| Channel | Direction | Pattern | Payload |
|---------|-----------|---------|---------|
| `tab:projectSwitch` | main -> renderer | webContents.send | `projectId: string` |
| `git:branchChanged` | main -> renderer | webContents.send | `branch: string, projectId?: string` |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Open project switcher dialog |
| `Ctrl+Shift+P` | New PowerShell tab (moved from `Ctrl+P`) |

## Key Files

| File | Role |
|------|------|
| `src/main/project-manager.ts` | `ProjectManager` class — project registry, creates per-project manager instances |
| `src/main/workspace-store.ts` | `WorkspaceStore` class — persists workspace configs as JSON in userData |
| `src/main/ipc-handlers.ts` | IPC handlers for `workspace:*` and `project:*` channels; project-aware tab/worktree routing |
| `src/main/tab-manager.ts` | `TabManager` — `createTab` accepts `projectId`, new `getTabsByProject`/`removeTabsByProject` methods |
| `src/renderer/components/ProjectSidebar.tsx` | Sidebar component — project list, status counts, collapse toggle |
| `src/renderer/components/ProjectSwitcherDialog.tsx` | Quick-switch dialog — keyboard navigation, color swatches, tab counts |
| `src/renderer/App.tsx` | Multi-project state management, project-scoped tab filtering, `--project-hue` CSS updates |
| `src/renderer/globals.css` | Defines `--project-hue` CSS variable |
| `src/renderer/keybindings.ts` | `Ctrl+P` -> project switcher, `Ctrl+Shift+P` -> PowerShell |
| `src/shared/types.ts` | `ProjectConfig`, `WorkspaceConfig`, `PROJECT_COLORS` type definitions |
| `src/preload.ts` | Preload bridge methods for workspace/project IPC, `onProjectAdded`/`onProjectRemoved`/`onProjectSwitch` events |
