import { app, BrowserWindow, dialog, ipcMain, Menu, Notification } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { TabManager } from './tab-manager';
import { PtyManager } from './pty-manager';
import { WorktreeManager } from './worktree-manager';
import { HookIpcServer } from './ipc-server';
import { HookInstaller } from './hook-installer';
import { SettingsStore } from './settings-store';
import { PIPE_NAME, PERMISSION_FLAGS, IpcMessage } from '@shared/types';
import type { PermissionMode } from '@shared/types';
import { log } from './logger';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------
const tabManager = new TabManager();
const ptyManager = new PtyManager();
const settings = new SettingsStore();
const ipcServer = new HookIpcServer(PIPE_NAME);

let worktreeManager: WorktreeManager | null = null;
let hookInstaller: HookInstaller | null = null;
let mainWindow: BrowserWindow | null = null;
let workspaceDir: string | null = null;
let permissionMode: PermissionMode = 'bypassPermissions';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseCliStartDir(): string | null {
  // Look for a path argument in process.argv that isn't a flag and doesn't
  // look like part of the Electron / Forge launcher path.
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg.toLowerCase().includes('electron')) continue;
    // Skip common Forge / Vite dev paths
    if (arg.includes('.vite') || arg.includes('node_modules')) continue;
    // Treat anything remaining as a directory path
    return arg;
  }
  return null;
}

const cliStartDir = parseCliStartDir();

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
const createWindow = () => {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const workingDir = path.resolve(cliStartDir || process.cwd());

  // Load the renderer from the Vite dev server or production bundle.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Set title after page loads so it doesn't get overwritten by the HTML <title>.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(`ClaudeTerminal - ${workingDir}`);
  });

  // Open DevTools in development with Ctrl+Shift+I.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.control && input.shift && input.key === 'I') {
        mainWindow!.webContents.toggleDevTools();
      }
    });
  }

  mainWindow.webContents.on('did-finish-load', () => log.attach(mainWindow!));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// ---------------------------------------------------------------------------
// Helper: send event to renderer
// ---------------------------------------------------------------------------
function sendToRenderer(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// ---------------------------------------------------------------------------
// Helper: show notification for background tab activity
// ---------------------------------------------------------------------------
function notifyTabActivity(tabId: string, title: string, body: string) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title, body });
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    tabManager.setActiveTab(tabId);
    const tab = tabManager.getTab(tabId);
    if (tab) {
      sendToRenderer('tab:updated', tab);
    }
  });
  notification.show();
}

// ---------------------------------------------------------------------------
// Helper: clean up naming flag file for a tab
// ---------------------------------------------------------------------------
function cleanupNamingFlag(tabId: string) {
  const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tabId}`);
  fs.unlink(flagFile, () => {}); // best-effort, ignore errors
}

// ---------------------------------------------------------------------------
// Helper: generate a smart tab name using Claude Haiku
// ---------------------------------------------------------------------------
function generateTabName(tabId: string, prompt: string) {
  log.debug('[generateTabName] starting for tab', tabId, 'prompt:', prompt.substring(0, 80));
  const namePrompt = `Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:\n\n${prompt}`;

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'cmd.exe' : 'claude';
  const args = isWindows
    ? ['/c', 'claude', '-p', '--model', 'claude-haiku-4-5-20251001']
    : ['-p', '--model', 'claude-haiku-4-5-20251001'];

  log.debug('[generateTabName] spawning:', cmd, args.join(' '));
  const child = execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      log.error('[generateTabName] FAILED:', err.message);
      log.error('[generateTabName] stderr:', stderr);
      return;
    }
    log.debug('[generateTabName] stdout:', JSON.stringify(stdout));

    const name = stdout.trim().replace(/^["']|["']$/g, '').substring(0, 50);
    if (!name) return;

    const tab = tabManager.getTab(tabId);
    if (!tab) return;

    tabManager.rename(tabId, name);
    const updated = tabManager.getTab(tabId);
    if (updated) {
      sendToRenderer('tab:updated', updated);
    }
  });

  child.stdin?.write(namePrompt);
  child.stdin?.end();
}

// ---------------------------------------------------------------------------
// Hook message handling (from named-pipe IPC server)
// ---------------------------------------------------------------------------
function handleHookMessage(msg: IpcMessage) {
  const { tabId, event, data } = msg;
  log.debug('[hook]', event, tabId, data ? data.substring(0, 80) : null);
  const tab = tabManager.getTab(tabId);
  if (!tab && event !== 'tab:closed') return;

  const isActive = tabManager.getActiveTabId() === tabId;

  switch (event) {
    case 'tab:ready':
      tabManager.updateStatus(tabId, 'new');
      if (data) {
        tabManager.setSessionId(tabId, data);
        log.info('[tab:ready] sessionId set for', tabId, '→', data);
      } else {
        log.warn('[tab:ready] no sessionId received for', tabId);
      }
      break;

    case 'tab:status:working':
      tabManager.updateStatus(tabId, 'working');
      break;

    case 'tab:status:idle':
      tabManager.updateStatus(tabId, 'idle');
      if (!isActive && tab) {
        notifyTabActivity(tabId, tab.name, 'Claude has finished working');
      }
      break;

    case 'tab:status:input':
      tabManager.updateStatus(tabId, 'requires_response');
      if (!isActive && tab) {
        notifyTabActivity(tabId, tab.name, 'Claude needs your input');
      }
      break;

    case 'tab:closed':
      cleanupNamingFlag(tabId);
      tabManager.removeTab(tabId);
      ptyManager.kill(tabId);
      sendToRenderer('tab:removed', tabId);
      return; // no tab:updated to send

    case 'tab:name':
      if (data) {
        tabManager.rename(tabId, data);
      }
      break;

    case 'tab:generate-name':
      if (data) {
        generateTabName(tabId, data);
      }
      return; // don't broadcast tab:updated yet — the async call will do it

    default:
      return;
  }

  // Broadcast updated tab state to the renderer.
  const updated = tabManager.getTab(tabId);
  if (updated) {
    sendToRenderer('tab:updated', updated);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers (invoke = async request/response)
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  // ---- Session ----
  ipcMain.handle(
    'session:start',
    async (_event, dir: string, mode: PermissionMode) => {
      workspaceDir = dir;
      permissionMode = mode;
      settings.addRecentDir(dir);
      settings.setPermissionMode(mode);
      worktreeManager = new WorktreeManager(dir);
      // In dev, __dirname is .vite/build/ — go up to project root.
      // In production, hooks are copied to resources/hooks/ by forge config.
      const projectRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'hooks')
        : path.join(__dirname, '..', '..', 'src', 'hooks');
      log.debug('[session:start] __dirname:', __dirname);
      log.debug('[session:start] hooksDir:', projectRoot);
      log.debug('[session:start] hooks exist:', fs.existsSync(path.join(projectRoot, 'pipe-send.js')));
      hookInstaller = new HookInstaller(projectRoot);
    },
  );

  ipcMain.handle('session:getSavedTabs', async (_event, dir: string) => {
    const saved = settings.getSessions(dir);
    settings.clearSessions(dir);
    return saved;
  });

  // ---- Tabs ----
  ipcMain.handle('tab:create', async (_event, worktree: string | null, resumeSessionId?: string) => {
    const cwd = worktree ?? workspaceDir!;
    const tab = tabManager.createTab(cwd, worktree);

    // Install hooks so Claude Code can communicate back to us.
    if (hookInstaller) {
      hookInstaller.install(cwd);
    }

    // Build claude CLI arguments.
    const args: string[] = [...(PERMISSION_FLAGS[permissionMode] ?? [])];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    // Extra env vars so hooks know which pipe to talk to.
    const extraEnv: Record<string, string> = {
      CLAUDE_TERMINAL_TAB_ID: tab.id,
      CLAUDE_TERMINAL_PIPE: PIPE_NAME,
      CLAUDE_TERMINAL_TMPDIR: os.tmpdir(),
    };

    // Spawn the Claude PTY.
    const proc = ptyManager.spawn(tab.id, cwd, args, extraEnv);
    tab.pid = proc.pid;

    // Forward PTY output to the renderer.
    proc.onData((data: string) => {
      sendToRenderer('pty:data', tab.id, data);
    });

    // When the PTY exits, clean up.
    proc.onExit(() => {
      cleanupNamingFlag(tab.id);
      tabManager.removeTab(tab.id);
      sendToRenderer('tab:removed', tab.id);
    });

    // Set as active if it's the first tab.
    if (tabManager.getAllTabs().length === 1) {
      tabManager.setActiveTab(tab.id);
    }

    sendToRenderer('tab:updated', tab);
    return tab;
  });

  ipcMain.handle('tab:close', async (_event, tabId: string) => {
    ptyManager.kill(tabId);
    cleanupNamingFlag(tabId);
    const tab = tabManager.getTab(tabId);
    if (tab?.worktree && worktreeManager) {
      try {
        worktreeManager.remove(tab.worktree);
      } catch {
        // worktree removal is best-effort
      }
    }
    tabManager.removeTab(tabId);
    sendToRenderer('tab:removed', tabId);
  });

  ipcMain.handle('tab:switch', async (_event, tabId: string) => {
    tabManager.setActiveTab(tabId);
  });

  ipcMain.handle(
    'tab:rename',
    async (_event, tabId: string, name: string) => {
      tabManager.rename(tabId, name);
      const tab = tabManager.getTab(tabId);
      if (tab) {
        sendToRenderer('tab:updated', tab);
      }
    },
  );

  ipcMain.handle('tab:getAll', async () => {
    return tabManager.getAllTabs();
  });

  ipcMain.handle('tab:getActiveId', async () => {
    return tabManager.getActiveTabId();
  });

  // ---- Worktree ----
  ipcMain.handle('worktree:create', async (_event, name: string) => {
    if (!worktreeManager) throw new Error('Session not started');
    return worktreeManager.create(name);
  });

  ipcMain.handle('worktree:currentBranch', async () => {
    if (!worktreeManager) throw new Error('Session not started');
    return worktreeManager.getCurrentBranch();
  });

  // ---- Settings ----
  ipcMain.handle('settings:recentDirs', async () => {
    return settings.getRecentDirs();
  });

  ipcMain.handle('settings:permissionMode', async () => {
    return settings.getPermissionMode();
  });

  // ---- Dialog ----
  ipcMain.handle('dialog:selectDirectory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- CLI ----
  ipcMain.handle('cli:getStartDir', async () => {
    return cliStartDir;
  });

  // ---- PTY (fire-and-forget via ipcMain.on) ----
  ipcMain.on('pty:write', (_event, tabId: string, data: string) => {
    ptyManager.write(tabId, data);
  });

  ipcMain.on(
    'pty:resize',
    (_event, tabId: string, cols: number, rows: number) => {
      ptyManager.resize(tabId, cols, rows);
    },
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('ready', async () => {
  // Start the named-pipe IPC server for hook communication.
  try {
    await ipcServer.start();
    log.info('[ipc-server] listening on pipe');
  } catch (err) {
    log.error('[ipc-server] FAILED to start:', String(err));
  }

  ipcServer.onMessage(handleHookMessage);

  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', async () => {
  // Save tab sessions before cleanup
  const allTabs = tabManager.getAllTabs();
  log.info('[quit] workspaceDir:', workspaceDir, 'tabs:', allTabs.length,
    'sessionIds:', allTabs.map(t => t.sessionId ?? 'null').join(', '));
  if (workspaceDir) {
    const savedTabs = allTabs
      .filter(t => t.sessionId)
      .map(t => ({
        name: t.name,
        cwd: t.cwd,
        worktree: t.worktree,
        sessionId: t.sessionId!,
      }));
    log.info('[quit] saving', savedTabs.length, 'tabs to', workspaceDir);
    if (savedTabs.length > 0) {
      settings.saveSessions(workspaceDir, savedTabs);
    }
  }

  // Clean up all naming flag files
  for (const tab of tabManager.getAllTabs()) {
    cleanupNamingFlag(tab.id);
  }

  ptyManager.killAll();
  try {
    await ipcServer.stop();
  } catch {
    // best-effort cleanup
  }
  app.quit();
});

app.on('activate', () => {
  // On macOS re-create the window when the dock icon is clicked.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------------------------------------------------------------------------
// Forge Vite plugin globals (injected at build time)
// ---------------------------------------------------------------------------
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
