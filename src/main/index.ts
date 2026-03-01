import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handleSquirrelEvent } from './squirrel-startup';

import { TabManager } from './tab-manager';
import { PtyManager } from './pty-manager';
import { HookIpcServer } from './ipc-server';
import { SettingsStore } from './settings-store';
import { createTabNamer } from './tab-namer';
import { createHookRouter } from './hook-router';
import { registerIpcHandlers, type AppState } from './ipc-handlers';
import { TunnelManager } from './tunnel-manager';
import { WebRemoteServer } from './web-remote-server';
import type { RemoteAccessInfo } from '@shared/types';
import { log } from './logger';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (handleSquirrelEvent(app)) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------
const tabManager = new TabManager();
const ptyManager = new PtyManager();
const settings = new SettingsStore();
const PIPE_NAME = `\\\\.\\pipe\\claude-terminal-${process.pid}`;
let ipcServer: HookIpcServer | null = null;
const tunnelManager = new TunnelManager();
let webRemoteServer: WebRemoteServer | null = null;
let cleanupIpcHandlers: (() => void) | null = null;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseCliStartDir(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg === '.') continue; // Electron Forge passes '.' as the app entry
    if (arg.toLowerCase().includes('electron')) continue;
    if (arg.includes('.vite') || arg.includes('node_modules')) continue;
    try {
      if (fs.statSync(arg).isDirectory()) return arg;
    } catch { /* not a valid path */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------
const state: AppState = {
  workspaceDir: null,
  permissionMode: 'bypassPermissions',
  worktreeManager: null,
  hookInstaller: null,
  hookConfigStore: null,
  hookEngine: null,
  mainWindow: null,
  cliStartDir: parseCliStartDir(),
  pipeName: PIPE_NAME,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
    } else if (channel === 'pty:resized') {
      webRemoteServer.broadcast({ type: 'pty:resized', tabId: args[0], cols: args[1], rows: args[2] });
    } else if (channel === 'tab:switched') {
      webRemoteServer.broadcast({ type: 'tab:switched', tabId: args[0] });
    }
  }
}

let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

async function doPersistSessions() {
  if (shuttingDown) return;
  if (!state.workspaceDir) return;
  const allTabs = tabManager.getAllTabs();
  const claudeTabs = allTabs.filter(t => t.type === 'claude');
  const savedTabs = claudeTabs
    .filter(t => t.sessionId && t.status !== 'new')
    .map(t => ({
      name: t.name,
      cwd: t.cwd,
      worktree: t.worktree,
      sessionId: t.sessionId!,
    }));
  // Don't wipe sessions.json while tabs are still initializing (no sessionId yet).
  // This prevents reload transitions from clearing saved sessions.
  if (savedTabs.length === 0 && claudeTabs.length > 0) {
    log.debug('[sessions] skip persist: %d claude tab(s) still initializing', claudeTabs.length);
    return;
  }
  await settings.saveSessions(state.workspaceDir, savedTabs);
}

function persistSessions() {
  if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    doPersistSessions();
  }, 200);
}

function flushPersistSessions() {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
    persistDebounceTimer = null;
  }
  doPersistSessions();
}

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
    serializeTerminal: async (tabId: string): Promise<string> => {
      const win = state.mainWindow as BrowserWindow | null;
      if (!win || win.isDestroyed()) return '';
      return win.webContents.executeJavaScript(
        `window.__serializeTerminal(${JSON.stringify(tabId)})`,
      );
    },
  });

  try {
    const localPort = await webRemoteServer.start(0);
    await tunnelManager.start(localPort);
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

// ---------------------------------------------------------------------------
// Wire up extracted modules
// ---------------------------------------------------------------------------
const { generateTabName, cleanupNamingFlag } = createTabNamer({
  tabManager, sendToRenderer, persistSessions,
});

const { handleHookMessage } = createHookRouter({
  tabManager, sendToRenderer, persistSessions,
  generateTabName, cleanupNamingFlag,
  getMainWindow: () => state.mainWindow as BrowserWindow | null,
  hookEngine: { emit: (event: any, context: any) => state.hookEngine?.emit(event, context) ?? Promise.resolve() } as any,
});

// ---------------------------------------------------------------------------
// Tunnel event listeners
// ---------------------------------------------------------------------------
tunnelManager.on('installing', (percent: number) => {
  sendToRenderer('remote:updated', {
    status: 'installing', tunnelUrl: null, token: null, error: null, progress: percent,
  } satisfies RemoteAccessInfo);
});
tunnelManager.on('url', () => {
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});
tunnelManager.on('connected', () => {
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});
tunnelManager.on('error', (err: Error) => {
  // Tear down the web server so the state resets to a retryable error.
  webRemoteServer?.stop();
  webRemoteServer = null;
  sendToRenderer('remote:updated', {
    status: 'error', tunnelUrl: null, token: null, error: String(err),
  });
});
tunnelManager.on('exit', () => {
  // If an error already tore things down, getRemoteAccessInfo returns 'inactive'
  // which is fine — the renderer already has the error state from the error event.
  if (!webRemoteServer) return;
  sendToRenderer('remote:updated', getRemoteAccessInfo());
});

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
const createWindow = () => {
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.resolve(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  state.mainWindow = mainWindow;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const initialTitle = state.cliStartDir
    ? `ClaudeTerminal - ${path.resolve(state.cliStartDir)}`
    : 'ClaudeTerminal';
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(initialTitle);
    log.attach(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('close', (event) => {
    const workingTabs = tabManager.getAllTabs().filter(t => t.status === 'working');
    if (workingTabs.length > 0) {
      const names = workingTabs.map(t => t.name).join(', ');
      const result = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        title: 'Close ClaudeTerminal?',
        message: `${workingTabs.length === 1 ? '1 tab is' : `${workingTabs.length} tabs are`} still running`,
        detail: names,
      });
      if (result === 1) {
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    state.mainWindow = null;
  });
};

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.setPath(
  'sessionData',
  path.join(app.getPath('temp'), `claude-terminal-${process.pid}`),
);

app.on('ready', async () => {
  ipcServer = new HookIpcServer(PIPE_NAME);
  try {
    await ipcServer.start();
    log.info('[ipc-server] listening on pipe');
    ipcServer.onMessage(handleHookMessage);
  } catch (err) {
    log.error('[ipc-server] FAILED to start:', String(err));
  }

  cleanupIpcHandlers = registerIpcHandlers({
    tabManager, ptyManager, settings, state,
    sendToRenderer, persistSessions, cleanupNamingFlag,
    activateRemoteAccess, deactivateRemoteAccess, getRemoteAccessInfo,
  });

  createWindow();
});

app.on('window-all-closed', async () => {
  log.info('[quit] workspaceDir:', state.workspaceDir, 'tabs:', tabManager.getAllTabs().length);
  flushPersistSessions();
  shuttingDown = true;

  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
  }

  ptyManager.killAll();
  cleanupIpcHandlers?.();
  tunnelManager.stop();
  webRemoteServer?.stop();
  if (ipcServer) {
    try { await ipcServer.stop(); } catch { /* best-effort */ }
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------------------------------------------------------------------------
// Forge Vite plugin globals (injected at build time)
// ---------------------------------------------------------------------------
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
