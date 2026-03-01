import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import { PERMISSION_FLAGS } from '@shared/types';
import type { TabManager } from './tab-manager';
import type { PtyManager } from './pty-manager';
import type { AppState, WirePtyToTabFn } from './ipc-handlers';
import { log } from './logger';

export interface WebRemoteServerDeps {
  tabManager: TabManager;
  ptyManager: PtyManager;
  state: AppState;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  /** Serialize a terminal's visible buffer as ANSI escape sequences. */
  serializeTerminal: (tabId: string) => Promise<string>;
  wirePtyToTab: WirePtyToTabFn;
  settings: { addRecentDir: (dir: string) => Promise<void> };
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
  /** True once initial snapshots have been sent; broadcast() waits for this. */
  synced: boolean;
}

export class WebRemoteServer {
  private readonly token: string;
  private readonly deps: WebRemoteServerDeps;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<AuthenticatedSocket> = new Set();

  constructor(deps: WebRemoteServerDeps) {
    this.deps = deps;
    // 6-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    this.token = Array.from({ length: 6 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  }

  get accessToken(): string {
    return this.token;
  }

  /** Start the server. Pass 0 to let the OS pick a free port. Returns the actual port. */
  async start(port: number): Promise<number> {
    const staticRoot = this.resolveStaticRoot();

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res, staticRoot);
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => this.handleWebSocketConnection(ws));

    return new Promise((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(port, '127.0.0.1', () => {
        const addr = this.httpServer!.address() as import('node:net').AddressInfo;
        log.info(`[web-remote] listening on http://127.0.0.1:${addr.port}`);
        resolve(addr.port);
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
      if (client.synced && client.ws.readyState === WebSocket.OPEN) {
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
    const client: AuthenticatedSocket = { ws, authenticated: false, synced: false };
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

      // Serialize each terminal's visible buffer and send as pty:data
      // so the client sees the current screen content immediately.
      // Only after snapshots are sent do we set synced=true so
      // broadcast() starts forwarding live PTY data to this client.
      // This prevents live data from interleaving with the snapshot.
      this.sendTerminalSnapshots(client, tabs).then(() => {
        client.synced = true;
        log.info('[web-remote] client synced, snapshots sent');
      }).catch((err) => {
        log.warn('[web-remote] failed to send terminal snapshots:', String(err));
        client.synced = true;
      });
    } else {
      client.ws.send(JSON.stringify({ type: 'auth:fail' }));
      client.ws.close();
      this.clients.delete(client);
      log.warn('[web-remote] auth failed');
    }
  }

  private async handleMessage(client: AuthenticatedSocket, msg: any): Promise<void> {
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

          // Re-send the terminal snapshot so the client always has current
          // content, even if the initial snapshot was missed or the tab was
          // created after the client connected.
          this.sendTerminalSnapshots(client, [{ id: msg.tabId }]).catch(() => {});
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

      case 'tab:create': {
        const { state } = this.deps;
        if (!state.workspaceDir) {
          log.warn('[web-remote] tab:create ignored: no workspace');
          break;
        }
        const cwd = state.workspaceDir;
        const tab = tabManager.createTab(cwd, null, 'claude');

        if (state.hookInstaller) {
          state.hookInstaller.install(cwd);
        }

        const args: string[] = [...(PERMISSION_FLAGS[state.permissionMode] ?? [])];
        const extraEnv: Record<string, string> = {
          CLAUDE_TERMINAL_TAB_ID: tab.id,
          CLAUDE_TERMINAL_PIPE: state.pipeName,
          CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
        };

        const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
        await this.deps.settings.addRecentDir(state.workspaceDir);
        this.deps.wirePtyToTab(proc, tab, cwd);

        // Switch the Electron renderer to the new tab so FitAddon.fit()
        // runs and resizes the PTY to the actual window dimensions.
        tabManager.setActiveTab(tab.id);
        this.deps.sendToRenderer('tab:switched', tab.id);

        // Respond after switching so the PTY has been resized by the
        // Electron renderer before the mobile client renders.
        const termSize = ptyManager.getSize(tab.id);
        client.ws.send(JSON.stringify({ type: 'tab:created', tab, termSize }));
        break;
      }

      case 'tab:createWithWorktree': {
        const { state } = this.deps;
        if (!state.workspaceDir || !state.worktreeManager) {
          log.warn('[web-remote] tab:createWithWorktree ignored: no workspace/worktreeManager');
          break;
        }
        const worktreeName = msg.name;
        if (typeof worktreeName !== 'string' || !worktreeName) break;

        const CYAN = '\x1b[36m';
        const GREEN = '\x1b[32m';
        const RED = '\x1b[31m';
        const DIM = '\x1b[2m';
        const RESET = '\x1b[0m';

        const cwd = path.join(state.workspaceDir, '.claude', 'worktrees', worktreeName);
        const tab = tabManager.createTab(cwd, worktreeName, 'claude');
        this.deps.sendToRenderer('tab:updated', tab);
        this.deps.persistSessions();

        // Switch Electron to the new tab so FitAddon sizes it correctly
        tabManager.setActiveTab(tab.id);
        this.deps.sendToRenderer('tab:switched', tab.id);

        // Respond immediately so createTabWithWorktree() promise resolves.
        // PTY isn't spawned yet, so use an existing tab's size as a proxy.
        const existingTabs = tabManager.getAllTabs().filter(t => t.id !== tab.id);
        const proxySize = existingTabs.length > 0 ? ptyManager.getSize(existingTabs[0].id) : null;
        client.ws.send(JSON.stringify({ type: 'tab:created', tab, termSize: proxySize }));

        const sendProgress = (text: string) => {
          this.deps.sendToRenderer('tab:worktreeProgress', tab.id, text);
        };

        const baseBranch = await state.worktreeManager.getCurrentBranch();

        // Async setup (mirrors ipc-handlers tab:createWithWorktree)
        const doSetup = async () => {
          if (!tabManager.getTab(tab.id)) return;

          sendProgress(`${CYAN}❯${RESET} Creating worktree "${worktreeName}"...\r\n`);
          sendProgress(`  Branch: ${worktreeName} (from ${baseBranch})\r\n`);
          sendProgress(`  Path: .claude/worktrees/${worktreeName}\r\n`);

          try {
            await state.worktreeManager!.createAsync(worktreeName, (text) => {
              sendProgress(`${DIM}${text}${RESET}`);
            });

            if (!tabManager.getTab(tab.id)) return;

            sendProgress(`${GREEN}✓${RESET} Worktree created\r\n\r\n`);

            if (state.hookEngine) {
              state.hookEngine.emit('worktree:created', {
                contextRoot: cwd, name: worktreeName, path: cwd, branch: worktreeName,
              });
            }

            sendProgress(`${CYAN}❯${RESET} Starting Claude...\r\n`);

            if (state.hookInstaller) {
              state.hookInstaller.install(cwd);
            }

            const args: string[] = [
              ...(PERMISSION_FLAGS[state.permissionMode] ?? []),
              '-w', worktreeName,
            ];
            const extraEnv: Record<string, string> = {
              CLAUDE_TERMINAL_TAB_ID: tab.id,
              CLAUDE_TERMINAL_PIPE: state.pipeName,
              CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
            };

            const proc = ptyManager.spawn(tab.id, state.workspaceDir!, args, extraEnv);
            await this.deps.settings.addRecentDir(state.workspaceDir!);
            this.deps.wirePtyToTab(proc, tab, cwd);
          } catch (err) {
            sendProgress(`\r\n${RED}✗${RESET} Failed to create worktree\r\n`);
            if (err instanceof Error) {
              sendProgress(`${RED}${err.message}${RESET}\r\n`);
            }
            if (tabManager.getTab(tab.id)) {
              tabManager.removeTab(tab.id);
              this.deps.sendToRenderer('tab:removed', tab.id);
              this.deps.persistSessions();
            }
          }
        };

        setTimeout(doSetup, 50);
        break;
      }

      case 'worktree:currentBranch': {
        const { state } = this.deps;
        const branch = state.worktreeManager
          ? await state.worktreeManager.getCurrentBranch()
          : '';
        client.ws.send(JSON.stringify({ type: 'worktree:currentBranch', branch }));
        break;
      }

      default:
        log.warn('[web-remote] unknown message type:', msg.type);
    }
  }
}
