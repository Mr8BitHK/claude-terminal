# Claude Terminal

A Windows desktop app (Electron) that serves as a **tabbed terminal manager for Claude Code sessions**.

Like Windows Terminal, but purpose-built for running multiple Claude Code CLI instances in tabs within one window.

## Features

- **Tabbed interface** — open, close, and switch between multiple Claude Code sessions, each in its own terminal (`node-pty` + `xterm.js`)
- **Auto-naming tabs** — uses Claude Haiku (via Anthropic API) to analyze terminal output and automatically generate descriptive tab names
- **Working directory management** — startup dialog to pick project directories, with history tracking
- **Git worktree support** — built-in worktree management for isolating feature work
- **Notifications** — alerts when Claude sessions need attention or complete tasks
- **Status indicators** — per-tab status bar and window title showing session activity
- **Keyboard-driven** — custom keybinding system for power-user navigation

## Getting Started

### Prerequisites

- Node.js
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Install & Run

```bash
npm install
npm start
```

### Build

```bash
npm run make
```

## License

MIT
