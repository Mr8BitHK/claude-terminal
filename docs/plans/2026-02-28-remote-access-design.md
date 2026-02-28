# Remote Access via Quick Tunnel — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

Make Claude Terminal accessible from any browser (mobile or desktop) by adding an embedded WebSocket server and Cloudflare Quick Tunnel integration. One-click activation from the Electron app, zero external setup required.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  PtyManager   │  │  TabManager   │  │SettingsStore  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │                  │                              │
│  ┌──────┴──────────────────┴──────┐                      │
│  │      WebRemoteServer           │                      │
│  │  - HTTP (serve web client)     │                      │
│  │  - WebSocket (terminal I/O)    │                      │
│  │  - Token auth                  │                      │
│  │  - localhost:3456              │                      │
│  └──────────────┬─────────────────┘                      │
│                 │                                         │
│  ┌──────────────┴─────────────────┐                      │
│  │      TunnelManager             │                      │
│  │  - npm "cloudflared" package   │                      │
│  │  - Auto-install binary         │                      │
│  │  - Start/stop quick tunnel     │                      │
│  │  - Emit public URL             │                      │
│  └────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────┘
         │
         ▼ outbound-only connection
   Cloudflare Edge (trycloudflare.com)
         │
         ▼
   https://random-words.trycloudflare.com
         │
         ▼
   Browser (phone/tablet/laptop)
```

## How Cloudflare Quick Tunnel Works

1. The `cloudflared` npm package auto-downloads the `cloudflared` binary on first use
2. A quick tunnel is created pointing to `localhost:3456`
3. Cloudflare assigns a random `https://xyz.trycloudflare.com` URL
4. All HTTP/WebSocket traffic from that URL is proxied through Cloudflare's edge network to the local server
5. No Cloudflare account, domain, or DNS configuration needed
6. Tunnel lives as long as the process runs; URL changes on restart

## New Modules

### 1. `WebRemoteServer` (`src/main/web-remote-server.ts`)

HTTP + WebSocket server using `ws` (WebSocket library) + Node's built-in `http` module.

**Responsibilities:**
- Serve the web client as static files over HTTP (`GET /`)
- Accept WebSocket connections at `ws://localhost:3456/ws`
- Token-based authentication on WebSocket handshake
- Bridge WebSocket messages to PtyManager and TabManager

**WebSocket Protocol:**

JSON messages over a single connection, mirroring the existing IPC channels:

```
// Client → Server
{ type: "pty:write",   tabId: "abc", data: "ls\n" }
{ type: "pty:resize",  tabId: "abc", cols: 80, rows: 24 }
{ type: "tab:create",  cwd: "/home/user" }
{ type: "tab:switch",  tabId: "abc" }
{ type: "tab:close",   tabId: "abc" }
{ type: "tab:rename",  tabId: "abc", name: "my-task" }

// Server → Client
{ type: "pty:data",     tabId: "abc", data: "file1.txt\n" }
{ type: "tab:updated",  tab: { id, name, status, ... } }
{ type: "tab:removed",  tabId: "abc" }
{ type: "tabs:sync",    tabs: [...] }  // Full state on connect
```

**Authentication flow:**
1. Client connects to WebSocket
2. First message must be `{ type: "auth", token: "..." }`
3. Server validates token, responds with `{ type: "auth:ok" }` + `tabs:sync`
4. If invalid, responds with `{ type: "auth:fail" }` and closes connection

### 2. `TunnelManager` (`src/main/tunnel-manager.ts`)

Wraps the `cloudflared` npm package to manage quick tunnel lifecycle.

**Responsibilities:**
- Install `cloudflared` binary on first use
- Start quick tunnel pointing to the local WebSocket server port
- Parse and emit the generated public URL
- Stop tunnel on deactivation or app close
- Emit status events (connecting, connected, error, disconnected)

**API:**
```typescript
class TunnelManager extends EventEmitter {
  async start(localPort: number): Promise<void>
  stop(): void
  get url(): string | null
  get isActive(): boolean
}
// Events: 'url', 'connected', 'error', 'exit'
```

### 3. Web Client

Built from the same React/xterm.js renderer code, with an adapter layer that replaces Electron IPC with WebSocket communication.

**Key differences from Electron renderer:**
- `window.claudeTerminal` API backed by WebSocket instead of `ipcRenderer`
- Token entry screen on first connection
- No Electron-specific features (dialog:selectDirectory, worktree management, etc.)
- Built as a separate Vite entry point, output as static files served by WebRemoteServer

**Shared code:**
- `Terminal.tsx` component (xterm.js rendering)
- `TabBar.tsx` component
- `StatusBar.tsx` component
- Terminal cache, theme, keybindings

**Web-only code:**
- `WebSocketBridge.ts` — implements `window.claudeTerminal` API over WebSocket
- `TokenScreen.tsx` — simple token entry on first visit
- `web-entry.tsx` — web app entry point

## UI Design

### Cloud Icon in Tab Bar

A cloud icon positioned to the left of the hamburger menu in the tab bar.

**States:**
- **Grey** — remote access inactive
- **Green** — tunnel active and connected
- **Pulsing** — connecting (tunnel establishing)

### Dropdown Panel

Clicking the cloud icon opens a dropdown panel anchored to the icon.

**Inactive state:**
```
┌──────────────────────┐
│ Remote Access         │
│                       │
│ Access your terminal  │
│ from any browser.     │
│                       │
│   [  Activate  ]      │
└──────────────────────┘
```

**Active state:**
```
┌──────────────────────┐
│ Remote Access         │
│ ● Connected           │
│                       │
│ ┌──────────────────┐  │
│ │     QR CODE      │  │
│ │                  │  │
│ │                  │  │
│ └──────────────────┘  │
│                       │
│ https://abc.try...    │
│              [📋 Copy]│
│                       │
│ Token: a8f3b2...      │
│              [📋 Copy]│
│                       │
│   [ Deactivate ]      │
└──────────────────────┘
```

## UX Flow

1. User clicks grey cloud icon → dropdown appears with "Activate" button
2. Click "Activate" → icon starts pulsing, app:
   a. Generates random access token
   b. Starts WebSocket server on `localhost:3456`
   c. Starts quick tunnel via `cloudflared` npm package
3. Tunnel connects → icon turns green, dropdown shows QR + URL + token
4. User scans QR on phone → browser opens → enters token → full terminal access
5. Click "Deactivate" → stops tunnel, stops server, icon turns grey

## Security

- **Random URL**: Cloudflare generates a random subdomain, hard to guess
- **Access token**: Generated per activation, required on WebSocket handshake
- **Single active session**: Optionally reject additional connections while one is active
- **Ephemeral**: URL changes every time remote access is re-activated
- **No ports exposed**: Cloudflare tunnel uses outbound-only connections

## Dependencies

- `ws` — WebSocket server library
- `cloudflared` — npm wrapper for cloudflared binary (auto-installs)
- `qrcode` — QR code generation for the dropdown panel (or use a lightweight canvas-based approach)

## Build Changes

- Add a separate Vite config/entry for the web client (`vite.web.config.mjs`)
- Web client built to `dist/web-client/` and bundled with the Electron app
- WebRemoteServer serves these static files

## Scope Exclusions

- No named/permanent tunnel support (can be added later)
- No multi-user support (single client at a time)
- No worktree management from web client (create/remove worktrees locally)
- No directory picker from web client
- No session persistence across tunnel restarts
