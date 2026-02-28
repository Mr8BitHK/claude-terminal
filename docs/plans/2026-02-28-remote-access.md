# Remote Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Claude Terminal accessible from any browser (mobile/desktop) via embedded WebSocket server + Cloudflare Quick Tunnel, activated from a cloud icon in the tab bar.

**Architecture:** An HTTP+WebSocket server (`WebRemoteServer`) runs inside the Electron main process, bridging the existing PtyManager/TabManager to browser clients via JSON messages over WebSocket. A `TunnelManager` wraps the `cloudflared` npm package to create a Quick Tunnel on-demand. The web client reuses the existing React/xterm.js renderer with a WebSocket adapter replacing the Electron IPC bridge.

**Tech Stack:** `ws` (WebSocket), `cloudflared` (npm), `qrcode` (QR generation), React 19, xterm.js 6, Vite 5

**Design doc:** `docs/plans/2026-02-28-remote-access-design.md`

---

### Task 1: Add npm dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install `ws`, `cloudflared`, and `qrcode` packages**

```bash
npm install ws cloudflared qrcode
npm install -D @types/ws @types/qrcode
```

**Step 2: Verify installation**

Run: `npm ls ws cloudflared qrcode`
Expected: All three packages listed without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add ws, cloudflared, qrcode for remote access"
```

---

### Task 2: Add shared types for remote access

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add remote access types to `src/shared/types.ts`**

Add at the end of the file (after line 42):

```typescript
// Remote access
export type RemoteAccessStatus = 'inactive' | 'connecting' | 'active' | 'error';

export interface RemoteAccessInfo {
  status: RemoteAccessStatus;
  tunnelUrl: string | null;
  token: string | null;
  error: string | null;
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add RemoteAccessInfo shared types"
```

---

### Task 3: Create `TunnelManager` module

**Files:**
- Create: `src/main/tunnel-manager.ts`

**Step 1: Write the TunnelManager**

Create `src/main/tunnel-manager.ts`:

```typescript
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { log } from './logger';

// cloudflared is an ESM-only package; use dynamic import
let cloudflaredModule: typeof import('cloudflared') | null = null;
async function getCloudflared() {
  if (!cloudflaredModule) {
    cloudflaredModule = await import('cloudflared');
  }
  return cloudflaredModule;
}

export class TunnelManager extends EventEmitter {
  private tunnel: any | null = null;
  private _url: string | null = null;
  private _isActive = false;

  get url(): string | null {
    return this._url;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  async start(localPort: number): Promise<void> {
    if (this._isActive) return;

    const { tunnel: cloudflaredTunnel, bin, install } = await getCloudflared();

    // Auto-install cloudflared binary on first use
    if (!fs.existsSync(bin)) {
      log.info('[tunnel] Installing cloudflared binary...');
      await install(bin);
      log.info('[tunnel] Installed cloudflared binary');
    }

    log.info(`[tunnel] Starting quick tunnel for localhost:${localPort}`);
    this.tunnel = cloudflaredTunnel({ '--url': `http://localhost:${localPort}` });

    this.tunnel.on('url', (url: string) => {
      this._url = url;
      log.info(`[tunnel] URL: ${url}`);
      this.emit('url', url);
    });

    this.tunnel.on('connected', (conn: unknown) => {
      this._isActive = true;
      log.info('[tunnel] Connected');
      this.emit('connected', conn);
    });

    this.tunnel.on('error', (err: Error) => {
      log.error('[tunnel] Error:', String(err));
      this.emit('error', err);
    });

    this.tunnel.on('exit', (code: number) => {
      this._isActive = false;
      this._url = null;
      log.info(`[tunnel] Exited with code ${code}`);
      this.emit('exit', code);
    });
  }

  stop(): void {
    if (this.tunnel) {
      log.info('[tunnel] Stopping');
      this.tunnel.stop();
      this.tunnel = null;
      this._isActive = false;
      this._url = null;
    }
  }
}
```

> **Note on `cloudflared` npm package API:** The package exports a `tunnel()` function (not a class). Check the actual export shape when implementing — it may be `Tunnel.quick()` or `tunnel({...})`. The above uses `tunnel()` with options. If the API differs, adjust accordingly. Consult `node_modules/cloudflared/src/tunnel.ts` for the actual API.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to tunnel-manager.ts (may have unrelated errors).

**Step 3: Commit**

```bash
git add src/main/tunnel-manager.ts
git commit -m "feat: add TunnelManager module wrapping cloudflared"
```

---

### Task 4: Create `WebRemoteServer` module

**Files:**
- Create: `src/main/web-remote-server.ts`

**Step 1: Write the WebRemoteServer**

This module creates an HTTP+WebSocket server on a local port. It bridges WebSocket messages to the existing PtyManager and TabManager.

Create `src/main/web-remote-server.ts`:

```typescript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { TabManager } from './tab-manager';
import type { PtyManager } from './pty-manager';
import type { AppState } from './ipc-handlers';
import { log } from './logger';

export interface WebRemoteServerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
}

export class WebRemoteServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private token: string;
  private authenticatedClients = new Set<WebSocket>();
  private ptyCleanups = new Map<string, () => void>(); // tabId -> cleanup

  constructor(private deps: WebRemoteServerDeps) {
    this.token = crypto.randomBytes(16).toString('hex');
  }

  get accessToken(): string {
    return this.token;
  }

  async start(port: number): Promise<void> {
    const { tabManager, ptyManager, state } = this.deps;

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws) => {
      log.info('[remote] WebSocket client connected');

      ws.on('message', (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
          return;
        }

        // Auth check
        if (!this.authenticatedClients.has(ws)) {
          if (msg.type === 'auth' && msg.token === this.token) {
            this.authenticatedClients.add(ws);
            ws.send(JSON.stringify({ type: 'auth:ok' }));
            // Send current tab state
            const tabs = tabManager.getAllTabs();
            const activeId = tabManager.getActiveTabId();
            ws.send(JSON.stringify({ type: 'tabs:sync', tabs, activeTabId: activeId }));
            // Register PTY data forwarding for all existing tabs
            this.registerPtyForwarding(ws);
          } else {
            ws.send(JSON.stringify({ type: 'auth:fail' }));
            ws.close();
          }
          return;
        }

        // Handle authenticated messages
        this.handleMessage(ws, msg);
      });

      ws.on('close', () => {
        log.info('[remote] WebSocket client disconnected');
        this.authenticatedClients.delete(ws);
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, '127.0.0.1', () => {
        log.info(`[remote] Server listening on localhost:${port}`);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  stop(): void {
    for (const cleanup of this.ptyCleanups.values()) cleanup();
    this.ptyCleanups.clear();
    this.authenticatedClients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    log.info('[remote] Server stopped');
  }

  /** Broadcast a message to all authenticated WebSocket clients */
  broadcast(msg: object): void {
    const data = JSON.stringify(msg);
    for (const ws of this.authenticatedClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Serve the web client static files
    const webClientDir = this.getWebClientDir();

    let filePath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    filePath = path.join(webClientDir, filePath);

    // Prevent directory traversal
    if (!filePath.startsWith(webClientDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  private getWebClientDir(): string {
    // In dev: project_root/dist/web-client
    // In production: resources/web-client
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'web-client');
    }
    return path.join(__dirname, '..', '..', 'dist', 'web-client');
  }

  private handleMessage(ws: WebSocket, msg: any): void {
    const { tabManager, ptyManager } = this.deps;

    switch (msg.type) {
      case 'pty:write':
        ptyManager.write(msg.tabId, msg.data);
        break;

      case 'pty:resize':
        ptyManager.resize(msg.tabId, msg.cols, msg.rows);
        break;

      case 'tab:switch':
        tabManager.setActiveTab(msg.tabId);
        break;

      case 'tab:rename': {
        tabManager.rename(msg.tabId, msg.name);
        const tab = tabManager.getTab(msg.tabId);
        if (tab) {
          this.deps.sendToRenderer('tab:updated', tab);
          this.broadcast({ type: 'tab:updated', tab });
          this.deps.persistSessions();
        }
        break;
      }

      case 'tab:getAll': {
        const tabs = tabManager.getAllTabs();
        ws.send(JSON.stringify({ type: 'tabs:sync', tabs, activeTabId: tabManager.getActiveTabId() }));
        break;
      }

      default:
        log.warn(`[remote] Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Register PTY data forwarding from all current tabs to a WebSocket client.
   * Also hooks into the ptyManager to forward data from future tabs.
   */
  private registerPtyForwarding(_ws: WebSocket): void {
    // PTY data forwarding is handled via the sendToRemoteClients
    // hook registered in index.ts, not per-client here.
    // This method is a placeholder — actual forwarding uses broadcast().
  }
}
```

> **Important:** The actual PTY data forwarding will be wired in `index.ts` by modifying `sendToRenderer` to also call `webRemoteServer.broadcast()`. See Task 6.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to web-remote-server.ts.

**Step 3: Commit**

```bash
git add src/main/web-remote-server.ts
git commit -m "feat: add WebRemoteServer with HTTP + WebSocket bridge"
```

---

### Task 5: Add IPC handlers for remote access control

**Files:**
- Modify: `src/preload.ts` (add remote access IPC methods)
- Modify: `src/main/ipc-handlers.ts` (add remote access handlers)

**Step 1: Add remote access methods to the preload bridge**

In `src/preload.ts`, add these methods to the `api` object (before the `// Events from main process` comment at line 59):

```typescript
  // Remote access
  activateRemoteAccess: (): Promise<RemoteAccessInfo> =>
    ipcRenderer.invoke('remote:activate'),
  deactivateRemoteAccess: (): Promise<void> =>
    ipcRenderer.invoke('remote:deactivate'),
  getRemoteAccessInfo: (): Promise<RemoteAccessInfo> =>
    ipcRenderer.invoke('remote:getInfo'),
```

Also add the import for `RemoteAccessInfo` at line 2:

```typescript
import type { PermissionMode, Tab, SavedTab, RemoteAccessInfo } from './shared/types';
```

**Step 2: Add IPC handlers in `src/main/ipc-handlers.ts`**

Extend the `IpcHandlerDeps` interface (at line 31, before the closing `}`):

```typescript
  activateRemoteAccess: () => Promise<RemoteAccessInfo>;
  deactivateRemoteAccess: () => Promise<void>;
  getRemoteAccessInfo: () => RemoteAccessInfo;
```

Add the import for `RemoteAccessInfo`:

```typescript
import type { PermissionMode, RemoteAccessInfo } from '@shared/types';
```

Add these handlers inside `registerIpcHandlers()` (before the closing `}` of the function, after the window title handler at line 263):

```typescript
  // ---- Remote access ----
  ipcMain.handle('remote:activate', async () => {
    return deps.activateRemoteAccess();
  });

  ipcMain.handle('remote:deactivate', async () => {
    return deps.deactivateRemoteAccess();
  });

  ipcMain.handle('remote:getInfo', async () => {
    return deps.getRemoteAccessInfo();
  });
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/preload.ts src/main/ipc-handlers.ts
git commit -m "feat: add remote access IPC handlers and preload methods"
```

---

### Task 6: Wire WebRemoteServer and TunnelManager into main process

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Import and instantiate the new modules**

At the top of `src/main/index.ts`, add imports (after line 13):

```typescript
import { TunnelManager } from './tunnel-manager';
import { WebRemoteServer } from './web-remote-server';
import type { RemoteAccessInfo } from '@shared/types';
```

After the singletons section (after line 27), add:

```typescript
const tunnelManager = new TunnelManager();
let webRemoteServer: WebRemoteServer | null = null;
const REMOTE_PORT = 3456;
```

**Step 2: Create the activate/deactivate/getInfo functions**

Add these after `persistSessions()` (after line 80):

```typescript
// ---------------------------------------------------------------------------
// Remote access
// ---------------------------------------------------------------------------
function getRemoteAccessInfo(): RemoteAccessInfo {
  if (!webRemoteServer) {
    return { status: 'inactive', tunnelUrl: null, token: null, error: null };
  }
  return {
    status: tunnelManager.isActive ? 'active' : 'connecting',
    tunnelUrl: tunnelManager.url,
    token: webRemoteServer.accessToken,
    error: null,
  };
}

async function activateRemoteAccess(): Promise<RemoteAccessInfo> {
  if (webRemoteServer) return getRemoteAccessInfo();

  webRemoteServer = new WebRemoteServer({
    tabManager, ptyManager, state,
    sendToRenderer, persistSessions,
  });

  try {
    await webRemoteServer.start(REMOTE_PORT);
    await tunnelManager.start(REMOTE_PORT);
  } catch (err) {
    log.error('[remote] Failed to activate:', String(err));
    webRemoteServer?.stop();
    webRemoteServer = null;
    tunnelManager.stop();
    return { status: 'error', tunnelUrl: null, token: null, error: String(err) };
  }

  return getRemoteAccessInfo();
}

async function deactivateRemoteAccess(): Promise<void> {
  tunnelManager.stop();
  webRemoteServer?.stop();
  webRemoteServer = null;
}
```

**Step 3: Modify `sendToRenderer` to also broadcast to WebSocket clients**

Replace the existing `sendToRenderer` function (lines 61-66) with:

```typescript
function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = state.mainWindow as BrowserWindow | null;
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
  // Forward relevant events to remote WebSocket clients
  if (webRemoteServer) {
    if (channel === 'pty:data') {
      webRemoteServer.broadcast({ type: 'pty:data', tabId: args[0], data: args[1] });
    } else if (channel === 'tab:updated') {
      webRemoteServer.broadcast({ type: 'tab:updated', tab: args[0] });
    } else if (channel === 'tab:removed') {
      webRemoteServer.broadcast({ type: 'tab:removed', tabId: args[0] });
    }
  }
}
```

**Step 4: Pass remote access functions to IPC handler deps**

Update the `registerIpcHandlers` call (around line 192) to include the new deps:

```typescript
registerIpcHandlers({
  tabManager, ptyManager, settings, state,
  sendToRenderer, persistSessions, cleanupNamingFlag,
  activateRemoteAccess, deactivateRemoteAccess, getRemoteAccessInfo,
});
```

**Step 5: Forward tunnel URL events to renderer**

After creating the tunnel manager, add event listeners (after the singletons section):

```typescript
tunnelManager.on('url', (url: string) => {
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});
tunnelManager.on('connected', () => {
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});
tunnelManager.on('error', (err: Error) => {
  sendToRenderer('remote:updated', {
    status: 'error', tunnelUrl: null, token: null, error: String(err),
  });
});
tunnelManager.on('exit', () => {
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});
```

**Step 6: Clean up on app close**

In the `window-all-closed` handler (around line 200), add before `app.quit()`:

```typescript
tunnelManager.stop();
webRemoteServer?.stop();
```

**Step 7: Add onRemoteAccessUpdate event to preload**

In `src/preload.ts`, add another event listener (after `onTabRemoved` at line 85):

```typescript
  onRemoteAccessUpdate: (callback: (info: RemoteAccessInfo) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: RemoteAccessInfo) =>
      callback(info);
    ipcRenderer.on('remote:updated', handler);
    return () => {
      ipcRenderer.removeListener('remote:updated', handler);
    };
  },
```

**Step 8: Verify it compiles**

Run: `npx tsc --noEmit`

**Step 9: Commit**

```bash
git add src/main/index.ts src/preload.ts
git commit -m "feat: wire WebRemoteServer and TunnelManager into main process"
```

---

### Task 7: Create the `RemoteAccessButton` UI component

**Files:**
- Create: `src/renderer/components/RemoteAccessButton.tsx`
- Modify: `src/renderer/index.css` (add styles)

**Step 1: Create the component**

Create `src/renderer/components/RemoteAccessButton.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Cloud } from 'lucide-react';
import type { RemoteAccessInfo } from '../../shared/types';

interface RemoteAccessButtonProps {
  remoteInfo: RemoteAccessInfo;
  onActivate: () => void;
  onDeactivate: () => void;
}

export default function RemoteAccessButton({
  remoteInfo,
  onActivate,
  onDeactivate,
}: RemoteAccessButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'url' | 'token' | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside click to close dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Generate QR code when URL changes
  useEffect(() => {
    if (!remoteInfo.tunnelUrl) {
      setQrDataUrl(null);
      return;
    }
    // Dynamic import to avoid bundling qrcode in renderer
    // QR generation happens in the renderer since it's a canvas operation
    import('qrcode').then((QRCode) => {
      QRCode.toDataURL(remoteInfo.tunnelUrl!, {
        width: 160,
        margin: 2,
        color: { dark: '#d4d4d4', light: '#1e1e1e' },
      }).then(setQrDataUrl);
    }).catch(() => {
      // QR code generation failed, URL is still copyable
    });
  }, [remoteInfo.tunnelUrl]);

  const copyToClipboard = (text: string, which: 'url' | 'token') => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const isActive = remoteInfo.status === 'active';
  const isConnecting = remoteInfo.status === 'connecting';

  return (
    <div className="remote-access-menu" ref={menuRef}>
      <button
        className={`remote-access-btn ${isActive ? 'remote-active' : ''} ${isConnecting ? 'remote-connecting' : ''}`}
        onClick={() => setOpen(!open)}
        title="Remote access"
      >
        <Cloud size={16} />
      </button>
      {open && (
        <div className="remote-access-dropdown">
          <div className="remote-access-header">Remote Access</div>
          {remoteInfo.status === 'inactive' && (
            <>
              <p className="remote-access-desc">
                Access your terminal from any browser.
              </p>
              <button className="remote-access-action" onClick={onActivate}>
                Activate
              </button>
            </>
          )}
          {isConnecting && (
            <p className="remote-access-desc">Connecting tunnel...</p>
          )}
          {remoteInfo.status === 'error' && (
            <>
              <p className="remote-access-error">{remoteInfo.error}</p>
              <button className="remote-access-action" onClick={onActivate}>
                Retry
              </button>
            </>
          )}
          {isActive && remoteInfo.tunnelUrl && (
            <>
              <div className="remote-access-status">● Connected</div>
              {qrDataUrl && (
                <div className="remote-access-qr">
                  <img src={qrDataUrl} alt="QR Code" width={160} height={160} />
                </div>
              )}
              <div className="remote-access-field">
                <span className="remote-access-label">URL</span>
                <code className="remote-access-value">
                  {remoteInfo.tunnelUrl.replace('https://', '')}
                </code>
                <button
                  className="remote-access-copy"
                  onClick={() => copyToClipboard(remoteInfo.tunnelUrl!, 'url')}
                >
                  {copied === 'url' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {remoteInfo.token && (
                <div className="remote-access-field">
                  <span className="remote-access-label">Token</span>
                  <code className="remote-access-value">
                    {remoteInfo.token.substring(0, 12)}...
                  </code>
                  <button
                    className="remote-access-copy"
                    onClick={() => copyToClipboard(remoteInfo.token!, 'token')}
                  >
                    {copied === 'token' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
              <button className="remote-access-action remote-deactivate" onClick={onDeactivate}>
                Deactivate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add CSS styles**

Add to `src/renderer/index.css` (after the hamburger menu styles, after line 182):

```css
/* Remote access button & dropdown */
.remote-access-menu { position: relative; -webkit-app-region: no-drag; }

.remote-access-btn {
  background: none; border: none; color: #555;
  cursor: pointer; padding: 4px 8px; display: flex; align-items: center;
  transition: color 0.2s;
}
.remote-access-btn:hover { color: #808080; }
.remote-access-btn.remote-active { color: #6a9955; }
.remote-access-btn.remote-connecting { color: #dcdcaa; animation: pulse 1.5s infinite; }

.remote-access-dropdown {
  position: absolute; top: 100%; right: 0;
  background: #252526; border: 1px solid #3c3c3c; border-radius: 8px;
  min-width: 260px; padding: 12px; z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.remote-access-header {
  font-size: 13px; font-weight: 600; color: #d4d4d4; margin-bottom: 8px;
}

.remote-access-desc { font-size: 12px; color: #808080; margin: 0 0 12px 0; }

.remote-access-status { font-size: 12px; color: #6a9955; margin-bottom: 8px; }

.remote-access-error { font-size: 12px; color: #f44747; margin: 0 0 8px 0; }

.remote-access-qr { text-align: center; margin-bottom: 8px; }
.remote-access-qr img { border-radius: 4px; }

.remote-access-field {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 6px; font-size: 12px;
}

.remote-access-label { color: #808080; min-width: 36px; }

.remote-access-value {
  flex: 1; color: #d4d4d4; background: #1e1e1e; padding: 2px 6px;
  border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px;
}

.remote-access-copy {
  background: none; border: 1px solid #3c3c3c; color: #808080;
  font-size: 11px; padding: 2px 6px; border-radius: 3px; cursor: pointer;
  white-space: nowrap;
}
.remote-access-copy:hover { color: #d4d4d4; border-color: #555; }

.remote-access-action {
  width: 100%; padding: 6px 12px; margin-top: 8px;
  background: #007acc; border: none; color: #fff;
  border-radius: 4px; font-size: 13px; cursor: pointer;
}
.remote-access-action:hover { background: #1a8ad4; }
.remote-access-action.remote-deactivate { background: #3c3c3c; color: #d4d4d4; }
.remote-access-action.remote-deactivate:hover { background: #4a4a4a; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

**Step 3: Commit**

```bash
git add src/renderer/components/RemoteAccessButton.tsx src/renderer/index.css
git commit -m "feat: add RemoteAccessButton component with QR code and dropdown"
```

---

### Task 8: Integrate RemoteAccessButton into App and TabBar

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/TabBar.tsx`

**Step 1: Add remote access state and handlers to App.tsx**

In `src/renderer/App.tsx`, add the import (after line 2):

```typescript
import type { PermissionMode, Tab, RemoteAccessInfo } from '../shared/types';
```

(Replace the existing `import type { PermissionMode, Tab }` line.)

Add state variable (after `workspaceDir` state at line 21):

```typescript
const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo>({
  status: 'inactive', tunnelUrl: null, token: null, error: null,
});
```

Add event listener for remote access updates (inside the existing `useEffect` that listens for tab updates, around line 94, after `cleanupRemoved`):

```typescript
const cleanupRemote = window.claudeTerminal.onRemoteAccessUpdate((info) => {
  setRemoteInfo(info);
});
```

Update the cleanup return (around line 122) to also call `cleanupRemote()`:

```typescript
return () => {
  cleanupUpdate();
  cleanupRemoved();
  cleanupRemote();
};
```

Add handler functions (after `handleNewTabWithWorktree` around line 51):

```typescript
const handleActivateRemote = useCallback(async () => {
  const info = await window.claudeTerminal.activateRemoteAccess();
  setRemoteInfo(info);
}, []);

const handleDeactivateRemote = useCallback(async () => {
  await window.claudeTerminal.deactivateRemoteAccess();
  setRemoteInfo({ status: 'inactive', tunnelUrl: null, token: null, error: null });
}, []);
```

**Step 2: Add remote access props to TabBar**

In `src/renderer/components/TabBar.tsx`, update the `TabBarProps` interface to add:

```typescript
remoteInfo: RemoteAccessInfo;
onActivateRemote: () => void;
onDeactivateRemote: () => void;
```

Add the import:

```typescript
import type { RemoteAccessInfo } from '../../shared/types';
import RemoteAccessButton from './RemoteAccessButton';
```

In the component destructuring, add the new props. In the JSX, add `<RemoteAccessButton />` between the new-tab-menu and `<HamburgerMenu />` (before line 100):

```tsx
<RemoteAccessButton
  remoteInfo={remoteInfo}
  onActivate={onActivateRemote}
  onDeactivate={onDeactivateRemote}
/>
```

**Step 3: Pass props from App.tsx to TabBar**

In `src/renderer/App.tsx`, update the `<TabBar>` JSX (around line 270) to include:

```tsx
remoteInfo={remoteInfo}
onActivateRemote={handleActivateRemote}
onDeactivateRemote={handleDeactivateRemote}
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`

**Step 5: Test manually**

Run: `npm start`
Expected: Cloud icon appears in tab bar next to hamburger menu. Clicking it shows "Remote Access" dropdown with "Activate" button. (Activation may fail if `cloudflared` is not available — that's fine for this step.)

**Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/TabBar.tsx
git commit -m "feat: integrate RemoteAccessButton into App and TabBar"
```

---

### Task 9: Build the web client

This is the browser-side client that connects via WebSocket instead of Electron IPC.

**Files:**
- Create: `src/web-client/index.html`
- Create: `src/web-client/main.tsx`
- Create: `src/web-client/ws-bridge.ts` (WebSocket adapter implementing ClaudeTerminalApi)
- Create: `vite.web.config.mjs`

**Step 1: Create the WebSocket bridge**

Create `src/web-client/ws-bridge.ts`:

```typescript
import type { Tab, RemoteAccessInfo } from '../shared/types';

type Callback<T extends unknown[]> = (...args: T) => void;

export class WebSocketBridge {
  private ws: WebSocket | null = null;
  private ptyListeners: Callback<[string, string]>[] = [];
  private tabUpdateListeners: Callback<[Tab]>[] = [];
  private tabRemovedListeners: Callback<[string]>[] = [];
  private connectionResolve: ((value: Tab[]) => void) | null = null;
  private _activeTabId: string | null = null;

  connect(url: string, token: string): Promise<Tab[]> {
    return new Promise((resolve, reject) => {
      const wsUrl = url.replace(/^http/, 'ws') + '/ws';
      this.ws = new WebSocket(wsUrl);
      this.connectionResolve = resolve;

      this.ws.onopen = () => {
        this.ws!.send(JSON.stringify({ type: 'auth', token }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      };

      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
      this.ws.onclose = () => { this.ws = null; };
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'auth:ok':
        // Wait for tabs:sync
        break;
      case 'auth:fail':
        this.ws?.close();
        break;
      case 'tabs:sync':
        this._activeTabId = msg.activeTabId;
        if (this.connectionResolve) {
          this.connectionResolve(msg.tabs);
          this.connectionResolve = null;
        }
        break;
      case 'pty:data':
        for (const cb of this.ptyListeners) cb(msg.tabId, msg.data);
        break;
      case 'tab:updated':
        for (const cb of this.tabUpdateListeners) cb(msg.tab);
        break;
      case 'tab:removed':
        for (const cb of this.tabRemovedListeners) cb(msg.tabId);
        break;
    }
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Implement the ClaudeTerminalApi interface (subset for web client)
  get api() {
    return {
      // Tab operations (most are read-only or send-only for web client)
      createTab: async () => { throw new Error('Cannot create tabs from web client'); },
      createShellTab: async () => { throw new Error('Cannot create shell tabs from web client'); },
      closeTab: async () => { throw new Error('Cannot close tabs from web client'); },
      switchTab: async (tabId: string) => { this.send({ type: 'tab:switch', tabId }); },
      renameTab: async (tabId: string, name: string) => {
        this.send({ type: 'tab:rename', tabId, name });
      },
      getTabs: async (): Promise<Tab[]> => {
        // Request fresh tab list
        this.send({ type: 'tab:getAll' });
        return []; // Will arrive via tabs:sync
      },
      getActiveTabId: async (): Promise<string | null> => this._activeTabId,

      // PTY operations
      writeToPty: (tabId: string, data: string) => {
        this.send({ type: 'pty:write', tabId, data });
      },
      resizePty: (tabId: string, cols: number, rows: number) => {
        this.send({ type: 'pty:resize', tabId, cols, rows });
      },

      // Stubs for Electron-only features
      createWorktree: async () => { throw new Error('Not available in web client'); },
      getCurrentBranch: async () => 'unknown',
      listWorktreeDetails: async () => [],
      removeWorktree: async () => {},
      getRecentDirs: async () => [],
      removeRecentDir: async () => {},
      getPermissionMode: async () => 'bypassPermissions' as const,
      setWindowTitle: () => {},
      selectDirectory: async () => null,
      startSession: async () => {},
      getSavedTabs: async () => [],
      getCliStartDir: async () => null,
      activateRemoteAccess: async (): Promise<RemoteAccessInfo> => ({
        status: 'inactive', tunnelUrl: null, token: null, error: null,
      }),
      deactivateRemoteAccess: async () => {},
      getRemoteAccessInfo: async (): Promise<RemoteAccessInfo> => ({
        status: 'inactive', tunnelUrl: null, token: null, error: null,
      }),

      // Event listeners
      onPtyData: (callback: (tabId: string, data: string) => void) => {
        this.ptyListeners.push(callback);
        return () => {
          this.ptyListeners = this.ptyListeners.filter(cb => cb !== callback);
        };
      },
      onTabUpdate: (callback: (tab: Tab) => void) => {
        this.tabUpdateListeners.push(callback);
        return () => {
          this.tabUpdateListeners = this.tabUpdateListeners.filter(cb => cb !== callback);
        };
      },
      onTabRemoved: (callback: (tabId: string) => void) => {
        this.tabRemovedListeners.push(callback);
        return () => {
          this.tabRemovedListeners = this.tabRemovedListeners.filter(cb => cb !== callback);
        };
      },
      onRemoteAccessUpdate: () => () => {},
    };
  }
}
```

**Step 2: Create the web client entry point**

Create `src/web-client/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { WebSocketBridge } from './ws-bridge';
import type { Tab } from '../shared/types';

// Import shared renderer styles and components
import '../renderer/index.css';
import TabBar from '../renderer/components/TabBar';
import Terminal from '../renderer/components/Terminal';
import StatusBar from '../renderer/components/StatusBar';

const bridge = new WebSocketBridge();

function TokenScreen({ onConnect }: { onConnect: (tabs: Tab[]) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    try {
      // Connect to the same origin (tunnel URL)
      const tabs = await bridge.connect(window.location.origin, token);
      // Mount the bridge as window.claudeTerminal
      (window as any).claudeTerminal = bridge.api;
      onConnect(tabs);
    } catch (err) {
      setError('Connection failed. Check your token.');
      setConnecting(false);
    }
  };

  return (
    <div className="app">
      <div className="dialog-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="dialog" style={{ padding: '24px', minWidth: '320px' }}>
          <h2 style={{ fontSize: '16px', color: '#d4d4d4', margin: '0 0 16px 0' }}>
            Claude Terminal — Remote Access
          </h2>
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter access token"
              autoFocus
              style={{
                width: '100%', padding: '8px', fontSize: '14px',
                background: '#1e1e1e', border: '1px solid #3c3c3c', borderRadius: '4px',
                color: '#d4d4d4', boxSizing: 'border-box',
              }}
            />
            {error && <p style={{ color: '#f44747', fontSize: '12px', margin: '8px 0 0 0' }}>{error}</p>}
            <button
              type="submit"
              disabled={!token || connecting}
              style={{
                width: '100%', padding: '8px', marginTop: '12px',
                background: '#007acc', border: 'none', color: '#fff',
                borderRadius: '4px', fontSize: '14px', cursor: 'pointer',
              }}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RemoteApp({ initialTabs }: { initialTabs: Tab[] }) {
  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initialTabs.length > 0 ? initialTabs[0].id : null,
  );

  // Register event listeners
  useState(() => {
    window.claudeTerminal.onTabUpdate((tab) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tab.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = tab;
          return next;
        }
        return [...prev, tab];
      });
    });

    window.claudeTerminal.onTabRemoved((tabId) => {
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        setActiveTabId((prevActive) =>
          prevActive === tabId ? (remaining.length > 0 ? remaining[0].id : null) : prevActive
        );
        return remaining;
      });
    });
  });

  const handleSelectTab = async (tabId: string) => {
    setActiveTabId(tabId);
    await window.claudeTerminal.switchTab(tabId);
  };

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={() => {}}
        onRenameTab={async (tabId, name) => {
          await window.claudeTerminal.renameTab(tabId, name);
        }}
        onNewClaudeTab={() => {}}
        onNewWorktreeTab={() => {}}
        onNewShellTab={() => {}}
        worktreeCount={0}
        onManageWorktrees={() => {}}
        remoteInfo={{ status: 'inactive', tunnelUrl: null, token: null, error: null }}
        onActivateRemote={() => {}}
        onDeactivateRemote={() => {}}
      />
      <div className="terminal-area">
        {tabs.map((tab) => (
          <Terminal key={tab.id} tabId={tab.id} isVisible={tab.id === activeTabId} />
        ))}
      </div>
      <StatusBar tabs={tabs} />
    </div>
  );
}

function WebApp() {
  const [tabs, setTabs] = useState<Tab[] | null>(null);

  if (!tabs) {
    return <TokenScreen onConnect={setTabs} />;
  }

  return <RemoteApp initialTabs={tabs} />;
}

const root = createRoot(document.getElementById('root')!);
root.render(<WebApp />);
```

**Step 3: Create `src/web-client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Terminal</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

**Step 4: Create `vite.web.config.mjs`**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: './src/web-client',
  plugins: [react()],
  build: {
    outDir: '../../dist/web-client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve('src/shared'),
    },
  },
});
```

**Step 5: Add build script to package.json**

Add to the `scripts` section:

```json
"build:web": "vite build --config vite.web.config.mjs"
```

**Step 6: Build the web client**

Run: `npm run build:web`
Expected: Output files in `dist/web-client/`.

**Step 7: Commit**

```bash
git add src/web-client/ vite.web.config.mjs package.json
git commit -m "feat: add web client with WebSocket bridge and token screen"
```

---

### Task 10: Package web client in Electron build

**Files:**
- Modify: `forge.config.ts`

**Step 1: Copy web client to packaged app**

In `forge.config.ts`, inside the `afterCopy` callback (around line 53, after the hooks copy block), add:

```typescript
// 4. Copy web client build output
const webClientSrc = path.join(__dirname, 'dist', 'web-client');
const webClientDest = path.join(buildPath, '..', 'web-client');
if (fs.existsSync(webClientSrc)) {
  fs.cpSync(webClientSrc, webClientDest, { recursive: true });
}
```

**Step 2: Update the build workflow**

The web client must be built before packaging. Update the `make` script:

```json
"make": "npm run build:web && electron-forge make"
```

**Step 3: Commit**

```bash
git add forge.config.ts package.json
git commit -m "feat: package web client in Electron build"
```

---

### Task 11: Mark `cloudflared` as external in Vite main config

The `cloudflared` npm package includes a binary downloader that shouldn't be bundled by Vite.

**Files:**
- Modify: `vite.main.config.mjs`

**Step 1: Add `cloudflared` and `ws` to externals**

In `vite.main.config.mjs`, update the `external` array (around line 13):

```javascript
external: ['node-pty', 'cloudflared', 'ws', 'qrcode'],
```

**Step 2: Verify the dev build works**

Run: `npm start`
Expected: App starts without module resolution errors for cloudflared/ws.

**Step 3: Commit**

```bash
git add vite.main.config.mjs
git commit -m "build: mark cloudflared, ws, qrcode as Vite externals"
```

---

### Task 12: End-to-end manual test

**Step 1: Start the app**

Run: `npm start`

**Step 2: Test activation**

1. Click the grey cloud icon in the tab bar
2. Click "Activate" in the dropdown
3. Wait for the icon to turn green and the QR code / URL to appear
4. Copy the URL

**Step 3: Test browser access**

1. Open the copied URL in a different browser (or phone)
2. Enter the token shown in the Electron app
3. Verify: you see all tabs, terminal output streams in real-time
4. Type in the web terminal — verify input reaches the PTY

**Step 4: Test deactivation**

1. Click the green cloud icon
2. Click "Deactivate"
3. Verify: icon turns grey, browser client disconnects

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end remote access fixes from manual testing"
```

---

## Notes for the implementing engineer

### `cloudflared` npm package API

The `cloudflared` npm package API may differ from what's documented. When implementing Task 3, check the actual exports:

```javascript
// Inspect the module:
const cf = require('cloudflared');
console.log(Object.keys(cf));
```

Possible variations:
- `tunnel()` function vs `Tunnel` class vs `Tunnel.quick()`
- Options format: `{ '--url': 'http://...' }` vs `{ url: 'http://...' }`

### Web client Terminal.tsx compatibility

The `Terminal.tsx` component uses `window.claudeTerminal.writeToPty()` and `onPtyData()`. These must work identically via the WebSocket bridge. If Terminal.tsx registers a global singleton PTY listener (it does — see `terminalCache.ts`), verify that the web client doesn't conflict.

### `qrcode` in renderer

The `qrcode` package needs to be available in the renderer process. Since the renderer uses Vite, it should bundle the import. If `qrcode` has Node.js dependencies that fail in the browser, use the browser-compatible `qrcode` build or switch to a pure-browser QR library.

### `ws` in Electron main process

The `ws` package is a Node.js-only WebSocket implementation. It must run in the main process (not renderer). The web client uses the browser's native `WebSocket` API — no `ws` needed there.
