# Hook System

ClaudeTerminal uses Claude Code's hook system to track the state of each Claude instance without parsing terminal output. Hooks are Node.js scripts that send JSON messages over a Windows named pipe back to the main Electron process.

## How It Works

```
Claude Code fires hook event
  -> Node.js script in src/hooks/ runs
    -> pipe-send.js sends JSON to \\.\pipe\claude-terminal
      -> HookIpcServer (net.Server) receives the message
        -> Main process updates tab state & notifies renderer
```

## Hook Installation

When a tab is created, `HookInstaller.install()` writes a `.claude/settings.local.json` file into the tab's working directory. This file configures Claude Code to invoke our hook scripts for six events.

The generated `settings.local.json` looks like:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node \"/path/to/on-session-start.js\"", "timeout": 10 }]
    }],
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "node \"/path/to/on-prompt-submit.js\"", "timeout": 10 }]
    }],
    ...
  }
}
```

Hook scripts read tab ID and pipe path from environment variables set on the PTY process:
- `CLAUDE_TERMINAL_TAB_ID` — Tab ID (e.g., `tab-1709123456789-abc123`)
- `CLAUDE_TERMINAL_PIPE` — Named pipe path (`\\.\pipe\claude-terminal`)

## Hook Scripts

All scripts are in `src/hooks/`.

### pipe-send.js (shared helper)

The core communication helper. Uses Node.js `net.createConnection` to write JSON to the named pipe. Reads `CLAUDE_TERMINAL_TAB_ID` and `CLAUDE_TERMINAL_PIPE` from environment variables to avoid Windows cmd.exe backslash mangling in CLI arguments.

Takes two positional arguments: event name and optional data.

Includes a 3-second safety timeout to prevent hanging if the pipe is unavailable. Silently exits if environment variables are missing (i.e., not running inside ClaudeTerminal).

### on-session-start.js

**Fires**: When Claude Code session initializes.
**Reads**: stdin JSON containing `session_id`.
**Sends**: `{"tabId": "...", "event": "tab:ready", "data": "<session_id>"}`
**Purpose**: Marks tab as ready and captures the session ID for resume support.

### on-prompt-submit.js

**Fires**: When the user submits a prompt to Claude.
**Reads**: stdin JSON containing the prompt text.
**Sends**: `{"tabId": "...", "event": "tab:generate-name", "data": "<first 500 chars of prompt>"}`
**Purpose**: Sends the first prompt to the main process, which uses Claude Haiku to generate a concise tab name. Uses a flag file to ensure only the first prompt triggers naming.

### on-tool-use.js

**Fires**: Before Claude executes any tool.
**Sends**: `{"tabId": "...", "event": "tab:status:working", "data": null}`

### on-stop.js

**Fires**: When Claude finishes a response.
**Sends**: `{"tabId": "...", "event": "tab:status:idle", "data": null}`

### on-notification.js

**Fires**: When Claude is waiting for user input (idle prompt).
**Sends**: `{"tabId": "...", "event": "tab:status:input", "data": null}`

### on-session-end.js

**Fires**: When the Claude Code session ends.
**Sends**: `{"tabId": "...", "event": "tab:closed", "data": null}`
**Note**: Tab close is debounced in the main process to handle `/clear` which ends and restarts the session.

## IPC Message Format

```typescript
interface IpcMessage {
  tabId: string;      // Which tab this message is for
  event: string;      // Event type (see table below)
  data: string | null; // Optional payload
}
```

### Event Types

| Event | Data | Effect |
|-------|------|--------|
| `tab:ready` | `"<session_id>"` | Sets tab status to `new`, stores session ID |
| `tab:status:working` | null | Sets tab status to `working` |
| `tab:status:idle` | null | Sets tab status to `idle`, notifies if background tab |
| `tab:status:input` | null | Sets tab status to `requires_response`, notifies if background tab |
| `tab:generate-name` | `"prompt text..."` | Triggers AI-generated tab name via Claude Haiku |
| `tab:closed` | null | Removes the tab and kills PTY (debounced) |

## Named Pipe Server

`HookIpcServer` creates a `net.Server` listening on `\\.\pipe\claude-terminal`. It handles:

- Multiple concurrent connections (one per hook invocation)
- Newline-delimited JSON parsing
- Buffered reads (handles partial messages)
- Graceful shutdown on app exit

## Repository Hooks (separate system)

In addition to Claude Code hooks (described above), ClaudeTerminal has a **repository hook system** for running custom commands on lifecycle events like worktree creation, tab creation, and branch changes. This is configured via `.claude-terminal/hooks.json` in the workspace root and managed through the HookManagerDialog UI.

See `docs/architecture.md` § Repository Hooks for full documentation.
