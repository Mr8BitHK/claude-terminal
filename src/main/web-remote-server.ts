import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
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
  /** Serialize a terminal's visible buffer as ANSI escape sequences. */
  serializeTerminal: (tabId: string) => Promise<string>;
}

// Maps file extensions to Content-Type headers
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

interface AuthenticatedSocket {
  ws: WebSocket;
  authenticated: boolean;
}

export class WebRemoteServer {
  private readonly token: string;
  private readonly deps: WebRemoteServerDeps;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<AuthenticatedSocket> = new Set();

  constructor(deps: WebRemoteServerDeps) {
    this.deps = deps;
    // 4-digit PIN — easy to type on mobile
    this.token = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  }

  get accessToken(): string {
    return this.token;
  }

  async start(port: number): Promise<void> {
    const staticRoot = this.resolveStaticRoot();

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res, staticRoot);
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => this.handleWebSocketConnection(ws));

    return new Promise((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(port, '127.0.0.1', () => {
        log.info(`[web-remote] listening on http://127.0.0.1:${port}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.ws.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    log.info('[web-remote] stopped');
  }

  broadcast(msg: object): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async sendTerminalSnapshots(
    client: AuthenticatedSocket,
    tabs: { id: string }[],
  ): Promise<void> {
    for (const tab of tabs) {
      try {
        const data = await this.deps.serializeTerminal(tab.id);
        if (data && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'pty:data', tabId: tab.id, data }));
        }
      } catch (err) {
        log.warn(`[web-remote] serialize failed for tab ${tab.id}:`, String(err));
      }
    }
  }

  private resolveStaticRoot(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'web-client');
    }
    // Dev mode: project root -> dist/web-client/
    return path.join(__dirname, '..', '..', 'dist', 'web-client');
  }

  private handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    staticRoot: string,
  ): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let requestedPath = decodeURIComponent(url.pathname);

    // Default to index.html for root
    if (requestedPath === '/') {
      requestedPath = '/index.html';
    }

    const filePath = path.join(staticRoot, requestedPath);

    // Directory traversal protection: resolved path must be within staticRoot
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(staticRoot))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.stat(resolved, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(resolved).pipe(res);
    });
  }

  private handleWebSocketConnection(ws: WebSocket): void {
    const client: AuthenticatedSocket = { ws, authenticated: false };
    this.clients.add(client);

    log.info('[web-remote] new WebSocket connection');

    // Close unauthenticated connections after 10 seconds
    const authTimeout = setTimeout(() => {
      if (!client.authenticated) {
        log.warn('[web-remote] auth timeout, closing connection');
        ws.close(4001, 'Authentication timeout');
        this.clients.delete(client);
      }
    }, 10_000);

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log.warn('[web-remote] invalid JSON from client');
        return;
      }

      if (!client.authenticated) {
        this.handleAuth(client, msg);
        if (client.authenticated) clearTimeout(authTimeout);
        return;
      }

      this.handleMessage(client, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.clients.delete(client);
      log.info('[web-remote] client disconnected');
    });

    ws.on('error', (err) => {
      clearTimeout(authTimeout);
      log.warn('[web-remote] WebSocket error:', err.message);
      this.clients.delete(client);
    });
  }

  private handleAuth(client: AuthenticatedSocket, msg: any): void {
    const tokenValid = msg.type === 'auth'
      && typeof msg.token === 'string'
      && msg.token.length === this.token.length
      && crypto.timingSafeEqual(Buffer.from(msg.token), Buffer.from(this.token));
    if (tokenValid) {
      client.authenticated = true;
      log.info('[web-remote] sending auth:ok');
      client.ws.send(JSON.stringify({ type: 'auth:ok' }));

      // Send current tab state with terminal dimensions
      const tabs = this.deps.tabManager.getAllTabs();
      const activeTabId = this.deps.tabManager.getActiveTabId();

      // Build per-tab size map so the client creates terminals at the right dimensions
      const termSizes: Record<string, { cols: number; rows: number }> = {};
      for (const tab of tabs) {
        const size = this.deps.ptyManager.getSize(tab.id);
        if (size) termSizes[tab.id] = size;
      }

      const syncPayload = JSON.stringify({ type: 'tabs:sync', tabs, activeTabId, termSizes });
      log.info(`[web-remote] sending tabs:sync (${tabs.length} tabs, ${syncPayload.length} bytes)`);
      client.ws.send(syncPayload);

      log.info('[web-remote] client authenticated, sync sent');

      // Serialize each terminal's visible buffer and send as pty:data
      // so the client sees the current screen content immediately.
      this.sendTerminalSnapshots(client, tabs).catch((err) => {
        log.warn('[web-remote] failed to send terminal snapshots:', String(err));
      });
    } else {
      client.ws.send(JSON.stringify({ type: 'auth:fail' }));
      client.ws.close();
      this.clients.delete(client);
      log.warn('[web-remote] auth failed');
    }
  }

  private handleMessage(client: AuthenticatedSocket, msg: any): void {
    const { tabManager, ptyManager } = this.deps;

    switch (msg.type) {
      case 'pty:write':
        if (typeof msg.tabId === 'string' && typeof msg.data === 'string') {
          ptyManager.write(msg.tabId, msg.data);
        }
        break;

      case 'pty:resize':
        // Intentionally ignored: the Electron host owns the PTY dimensions.
        // Letting remote clients resize would shrink the terminal for the host.
        break;

      case 'tab:switch':
        if (typeof msg.tabId === 'string') {
          tabManager.setActiveTab(msg.tabId);
          // Mirror to Electron renderer and other web clients
          this.deps.sendToRenderer('tab:switched', msg.tabId);
          this.broadcast({ type: 'tab:switched', tabId: msg.tabId });
        }
        break;

      case 'tab:rename':
        if (typeof msg.tabId === 'string' && typeof msg.name === 'string') {
          tabManager.rename(msg.tabId, msg.name);
          const tab = tabManager.getTab(msg.tabId);
          if (tab) {
            this.deps.sendToRenderer('tab:updated', tab);
            this.broadcast({ type: 'tab:updated', tab });
            this.deps.persistSessions();
          }
        }
        break;

      case 'tab:getAll': {
        const tabs = tabManager.getAllTabs();
        const activeTabId = tabManager.getActiveTabId();
        client.ws.send(JSON.stringify({ type: 'tabs:sync', tabs, activeTabId }));
        break;
      }

      default:
        log.warn('[web-remote] unknown message type:', msg.type);
    }
  }
}
