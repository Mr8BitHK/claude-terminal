# ClaudeTerminal Design

A Windows Terminal-like desktop application for running multiple Claude Code instances simultaneously, each in its own tab with status tracking, worktree management, and hook-based communication.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Electron App                        │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           Renderer (Chromium + React)        │    │
│  │  ┌──────┐ ┌──────────┐ ┌───┐               │    │
│  │  │Tab 1 │ │Tab 2     │ │ + │  ← Tab Bar    │    │
│  │  │main●│ │feat/auth◉│ │   │               │    │
│  │  └──────┘ └──────────┘ └───┘               │    │
│  │  ┌─────────────────────────────────────┐    │    │
│  │  │         xterm.js Terminal           │    │    │
│  │  │    (renders active tab's PTY)       │    │    │
│  │  └─────────────────────────────────────┘    │    │
│  │  ┌─────────────────────────────────────┐    │    │
│  │  │ Status: working │ WT: feat/auth     │    │    │
│  │  └─────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │           Main Process (Node.js)             │    │
│  │  ┌──────────────┐  ┌────────────────────┐   │    │
│  │  │ Tab Manager  │  │ Worktree Manager   │   │    │
│  │  └──────┬───────┘  └────────────────────┘   │    │
│  │         │                                    │    │
│  │  ┌──────┴───────┐                           │    │
│  │  │  node-pty     │  ┌────────────────────┐  │    │
│  │  │  (ConPTY)     │  │ Hook IPC Server    │  │    │
│  │  │  ┌─────────┐  │  │ (named pipe)       │  │    │
│  │  │  │claude 1 │  │  └────────────────────┘  │    │
│  │  │  │claude 2 │  │                           │    │
│  │  │  │claude N │  │  ┌────────────────────┐  │    │
│  │  │  └─────────┘  │  │ Settings Store     │  │    │
│  │  └───────────────┘  │ (recent dirs, etc) │  │    │
│  │                      └────────────────────┘  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Renderer**: Tab bar + xterm.js terminal + status bar. One xterm.js instance per tab, only the active one is visible.

**Main Process**: Manages PTY processes via node-pty, worktrees via git CLI, and receives status updates from Claude hooks via a named pipe IPC server.

**Hook CLI helper**: Thin shell scripts that Claude hooks invoke. They read hook input from stdin, extract relevant data, and write `{tabId, event, data}` to the named pipe.

## Tech Stack

- **Electron** — app shell
- **React + TypeScript** — renderer UI
- **xterm.js** (`xterm`, `xterm-addon-fit`, `xterm-addon-webgl`) — terminal rendering
- **node-pty** — PTY/ConPTY process management
- **electron-store** — persisted settings (recent dirs, preferences)
- **Electron Forge or electron-builder** — packaging

## Startup Flow

```
$ claude-terminal [optional/path/to/project]
        │
        ▼
  Path provided via CLI?
  ├── Yes → Use it
  ├── No  → Show recent dirs list
  │         with [Browse...] fallback
  │         (native OS folder picker)
        │
        ▼
  Select permission mode:
  ○ Default
  ○ Plan mode
  ○ Accept edits
  ● Bypass permissions  ← default
        │
        ▼
  Main window opens with first tab
  (Claude spawned in selected directory)
```

- Recent dirs persisted in `~/.claude-terminal/config.json`
- First tab opens in workspace root (no worktree)
- Permission mode locked for all tabs in that session

## New Tab Flow

```
  [+] clicked (or Ctrl+T)
        │
        ▼
  ┌──────────────────────────┐
  │ Create worktree?         │
  │ [Yes]  [No, use main]   │
  └──────────────────────────┘
        │
   ┌────┴────┐
   Yes       No
   │         │
   ▼         ▼
  ┌────────────────────┐   Spawn claude in
  │ Worktree name:     │   workspace root
  │ [feature/___]      │   directory
  │                    │
  │ Base: current      │
  │ branch (readonly)  │
  │                    │
  │ [Create] [Cancel]  │
  └────────────────────┘
   │
   ▼
  git worktree add
    .claude/worktrees/<name>
    -b <name>
    (from current branch HEAD)
   │
   ▼
  Spawn claude in worktree dir
```

Worktree creation always branches from the **current branch** of the workspace.

## Tab Status & Naming

**Status indicators on tabs:**

| Indicator | Status | Meaning |
|-----------|--------|---------|
| `●` | new | Just spawned, not yet working |
| `◉` | working | Tool use in progress |
| `◈` | requires_response | Waiting for user input |
| `○` | idle | Claude finished responding |

**Tab naming:**
- Initial name: worktree name (if created) or `Tab N`
- After first user prompt: auto-renamed to first ~40 chars of the prompt, trimmed to last word boundary
- Manual rename: double-click tab label or press `F2`

## Notifications

Native OS toast notifications (Electron `Notification` API) fire when a **non-active tab** changes to "requires response" or "idle". Clicking the toast switches to that tab.

```
  ┌────────────────────────────────┐
  │ ClaudeTerminal                  │
  │ Tab "auth refactor" needs      │
  │ your input                     │
  │            [Go to tab]         │
  └────────────────────────────────┘
```

## Hook System

Hooks are the nervous system connecting Claude instances to the UI. Each Claude instance has hooks installed via `.claude/settings.local.json` in its working directory.

**IPC mechanism**: Named pipe (`\\.\pipe\claude-terminal`)

Each Claude instance gets a `CLAUDE_TERMINAL_TAB_ID` env var set via the `SessionStart` hook writing to `CLAUDE_ENV_FILE`.

| Hook | IPC Message | UI Effect |
|------|-------------|-----------|
| SessionStart | `tab:ready` | Tab status → new |
| UserPromptSubmit | `tab:name:<text>` | Rename tab (first prompt, ~40 chars) |
| PreToolUse | `tab:status:working` | Tab indicator → ◉ |
| Stop | `tab:status:idle` | Tab indicator → ○ |
| Notification (idle_prompt) | `tab:status:input` | Tab indicator → ◈ + OS toast |
| SessionEnd | `tab:closed` | Remove tab + cleanup worktree |
| WorktreeCreate | `tab:worktree:<name>` | Update tab label |

Hook scripts are thin shell scripts bundled with the app. They read stdin JSON, extract relevant fields, and write to the named pipe.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+1-9` | Jump to tab N |
| `F2` | Rename current tab |

## Project Structure

```
claude-terminal/
├── package.json
├── tsconfig.json
├── electron-builder.json
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, window creation
│   │   ├── tab-manager.ts       # Tab lifecycle
│   │   ├── pty-manager.ts       # node-pty process spawning
│   │   ├── worktree-manager.ts  # git worktree create/remove
│   │   ├── ipc-server.ts        # Named pipe server
│   │   ├── settings-store.ts    # Recent dirs, preferences
│   │   └── hook-installer.ts    # Writes .claude/settings.local.json
│   ├── renderer/                # Electron renderer (UI)
│   │   ├── index.html
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── TabBar.tsx
│   │   │   ├── Tab.tsx
│   │   │   ├── Terminal.tsx     # xterm.js wrapper
│   │   │   ├── StatusBar.tsx
│   │   │   ├── StartupDialog.tsx
│   │   │   └── NewTabDialog.tsx
│   │   └── styles/
│   ├── hooks/                   # Scripts that Claude hooks call
│   │   ├── on-session-start.sh
│   │   ├── on-prompt-submit.sh
│   │   ├── on-tool-use.sh
│   │   ├── on-stop.sh
│   │   ├── on-notification.sh
│   │   └── on-session-end.sh
│   └── shared/
│       └── types.ts             # Types shared between main/renderer
└── resources/                   # Icons, etc.
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App type | Electron | xterm.js solves PTY rendering; proven stack (VS Code) |
| Terminal rendering | xterm.js + node-pty | Production-grade, handles all escape codes/colors/scrollback |
| Permission mode | Bypass permissions (default) | Set once at startup, all tabs inherit |
| Worktree base | Current branch | Always branches from workspace's current HEAD |
| Status tracking | Claude Code hooks → named pipe → UI | Clean, reliable, uses official hook API |
| Tab naming | First user prompt (~40 chars) | Simple, instant, no external API calls |
| Notifications | Native OS toast | Electron Notification API, click to switch tab |
