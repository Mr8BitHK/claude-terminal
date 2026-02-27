# Installer & CLI Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Windows installer for ClaudeTerminal that registers a `claudeterm` CLI command and auto-starts when a directory argument is provided.

**Architecture:** Squirrel installer (already partially configured) with a post-install step that creates a `claudeterm.cmd` shim and adds the install directory to the user PATH. The renderer auto-starts the session when a CLI directory is detected, skipping the StartupDialog.

**Tech Stack:** Electron Forge, MakerSquirrel, Windows PATH manipulation via `setx`, React

---

### Task 1: Configure MakerSquirrel with proper metadata

**Files:**
- Modify: `forge.config.ts:48-49`

**Step 1: Update MakerSquirrel config**

In `forge.config.ts`, replace the empty `new MakerSquirrel({})` with proper configuration:

```typescript
new MakerSquirrel({
  name: 'ClaudeTerminal',
  exe: 'ClaudeTerminal.exe',
  setupExe: 'ClaudeTerminalSetup.exe',
  description: 'A Windows Terminal-like app for managing multiple Claude Code instances in tabs',
  authors: 'Yaron Guan Golan',
  noMsi: true,
}),
```

**Step 2: Verify config compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add forge.config.ts
git commit -m "feat: configure MakerSquirrel with app metadata"
```

---

### Task 2: Add Squirrel install/uninstall event handling for CLI shim and PATH

**Files:**
- Modify: `src/main/index.ts:6-21` (replace simple `electron-squirrel-startup` import)

**Context:** The current code uses `electron-squirrel-startup` which just checks if Squirrel is running and quits. We need to handle the Squirrel events ourselves to create the CLI shim and manage PATH.

**Step 1: Replace `electron-squirrel-startup` with custom Squirrel handler**

In `src/main/index.ts`, replace lines 6 and 18-21:

```typescript
// OLD:
import started from 'electron-squirrel-startup';
// ...
if (started) {
  app.quit();
}

// NEW:
import { handleSquirrelEvent } from './squirrel-startup';

if (handleSquirrelEvent(app)) {
  // Squirrel is handling install/update/uninstall — exit immediately.
  process.exit(0);
}
```

**Step 2: Create `src/main/squirrel-startup.ts`**

```typescript
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';

/**
 * Handle Squirrel.Windows install/update/uninstall events.
 * Returns true if a Squirrel event was handled (caller should exit).
 */
export function handleSquirrelEvent(app: App): boolean {
  if (process.platform !== 'win32') return false;

  const squirrelCommand = process.argv[1];
  if (!squirrelCommand) return false;

  const appFolder = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);

  switch (squirrelCommand) {
    case '--squirrel-install':
    case '--squirrel-updated':
      createCliShim(appFolder);
      addToPath(appFolder);
      // Create desktop & start menu shortcuts
      execSync(`"${path.join(appFolder, '..', 'Update.exe')}" --createShortcut="${exeName}"`, {
        stdio: 'ignore',
      });
      return true;

    case '--squirrel-uninstall':
      removeCliShim(appFolder);
      removeFromPath(appFolder);
      execSync(`"${path.join(appFolder, '..', 'Update.exe')}" --removeShortcut="${exeName}"`, {
        stdio: 'ignore',
      });
      return true;

    case '--squirrel-obsolete':
      return true;

    default:
      return false;
  }
}

function createCliShim(appFolder: string): void {
  const shimPath = path.join(appFolder, 'claudeterm.cmd');
  const shimContent = '@echo off\r\n"%~dp0ClaudeTerminal.exe" %*\r\n';
  fs.writeFileSync(shimPath, shimContent, 'utf-8');
}

function removeCliShim(appFolder: string): void {
  const shimPath = path.join(appFolder, 'claudeterm.cmd');
  try {
    fs.unlinkSync(shimPath);
  } catch {
    // best-effort
  }
}

function addToPath(appFolder: string): void {
  try {
    // Read current user PATH
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    // Extract the PATH value (after "REG_SZ" or "REG_EXPAND_SZ")
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    const existingPath = match ? match[1].trim() : '';

    // Check if already in PATH
    const pathEntries = existingPath.split(';').map(p => p.toLowerCase());
    if (pathEntries.includes(appFolder.toLowerCase())) return;

    // Append to PATH using setx (persists across reboots)
    const newPath = existingPath ? `${existingPath};${appFolder}` : appFolder;
    execSync(`setx Path "${newPath}"`, { stdio: 'ignore' });
  } catch {
    // If reg query fails (no Path set), create it fresh
    try {
      execSync(`setx Path "${appFolder}"`, { stdio: 'ignore' });
    } catch {
      // best-effort — user may need to add to PATH manually
    }
  }
}

function removeFromPath(appFolder: string): void {
  try {
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    if (!match) return;

    const existingPath = match[1].trim();
    const filtered = existingPath
      .split(';')
      .filter(p => p.toLowerCase() !== appFolder.toLowerCase())
      .join(';');

    if (filtered !== existingPath) {
      execSync(`setx Path "${filtered}"`, { stdio: 'ignore' });
    }
  } catch {
    // best-effort
  }
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main/squirrel-startup.ts src/main/index.ts
git commit -m "feat: add Squirrel event handling with CLI shim and PATH management"
```

---

### Task 3: Copy hooks to resources in packaged build

**Files:**
- Modify: `forge.config.ts:12-42` (packagerConfig)

**Context:** The `afterCopy` hook already copies `node-pty` and the renderer build. It also needs to copy the hooks directory to `resources/hooks/` so the packaged app can find them. Looking at `src/main/index.ts:289-293`, it already expects hooks at `resources/hooks/` when packaged.

**Step 1: Add hooks copy to afterCopy**

In `forge.config.ts`, inside the `afterCopy` callback, after the renderer copy, add:

```typescript
// 3. Copy hook scripts to resources/hooks/ for production.
const hooksSrc = path.join(__dirname, 'src', 'hooks');
const hooksDest = path.join(buildPath, '..', 'hooks');

fs.cp(hooksSrc, hooksDest, { recursive: true }, (err3) => {
  if (err3) return callback(err3);
  callback();
});
```

And remove the existing final `callback()` call since the new copy chain now calls it.

The full afterCopy callback body becomes:

```typescript
(buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (err?: Error) => void) => {
  const ptySrc = path.join(__dirname, 'node_modules', 'node-pty');
  const ptyDest = path.join(buildPath, 'node_modules', 'node-pty');

  const rendererSrc = path.join(__dirname, 'src', 'renderer', '.vite', 'renderer');
  const rendererDest = path.join(buildPath, '.vite', 'renderer');

  const hooksSrc = path.join(__dirname, 'src', 'hooks');
  const hooksDest = path.join(buildPath, '..', 'hooks');

  fs.cp(ptySrc, ptyDest, { recursive: true }, (err) => {
    if (err) return callback(err);
    fs.cp(rendererSrc, rendererDest, { recursive: true }, (err2) => {
      if (err2) return callback(err2);
      fs.cp(hooksSrc, hooksDest, { recursive: true }, (err3) => {
        if (err3) return callback(err3);
        callback();
      });
    });
  });
},
```

**Step 2: Verify config compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add forge.config.ts
git commit -m "feat: copy hooks to resources in production builds"
```

---

### Task 4: Auto-start session when CLI directory is provided

**Files:**
- Modify: `src/renderer/App.tsx:12-14` (add auto-start effect)

**Context:** When the user runs `claudeterm D:\dev\project`, `cliStartDir` is set in the main process. The renderer fetches it via `getCliStartDir()`. Currently, `StartupDialog` fetches this and pre-selects it, but the user still has to click "Start". We want to skip the dialog entirely.

**Step 1: Add auto-start effect in App.tsx**

In `src/renderer/App.tsx`, add a `useEffect` after the existing state declarations (around line 17) that checks for a CLI directory and auto-starts:

```typescript
// Auto-start when a CLI directory was provided
useEffect(() => {
  if (appState !== 'startup') return;

  const tryAutoStart = async () => {
    const cliDir = await window.claudeTerminal.getCliStartDir();
    if (!cliDir) return;

    // Use saved permission mode (defaults to 'bypassPermissions')
    const savedMode = await window.claudeTerminal.getPermissionMode();
    handleStartSession(cliDir, savedMode);
  };

  tryAutoStart().catch(() => {});
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Note: `handleStartSession` is defined later in the component but hoisted as a function expression. We need to move its definition before this effect, or convert this to use a ref. The simplest approach: extract the auto-start check into the effect and inline the session start logic.

Actually, looking at the code more carefully, `handleStartSession` is a regular `async` function (not wrapped in useCallback), so it's recreated each render. The simplest fix: just inline the relevant logic in the effect:

```typescript
// Auto-start when a CLI directory was provided
useEffect(() => {
  let cancelled = false;

  (async () => {
    const cliDir = await window.claudeTerminal.getCliStartDir();
    if (!cliDir || cancelled) return;

    const savedMode = await window.claudeTerminal.getPermissionMode();
    if (cancelled) return;

    // Same logic as handleStartSession
    await window.claudeTerminal.startSession(cliDir, savedMode);
    if (cancelled) return;

    const savedTabs = await window.claudeTerminal.getSavedTabs(cliDir);
    if (savedTabs.length > 0) {
      for (const saved of savedTabs) {
        const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId);
        setActiveTabId(tab.id);
      }
    }

    const allTabs = await window.claudeTerminal.getTabs();
    const activeId = await window.claudeTerminal.getActiveTabId();
    if (cancelled) return;

    setTabs(allTabs);
    setActiveTabId(activeId);
    setAppState('running');

    if (allTabs.length === 0) {
      setShowNewTabDialog(true);
    }
  })();

  return () => { cancelled = true; };
}, []);
```

Place this `useEffect` right after line 17 (after the `tabsRef.current = tabs;` line) in `App.tsx`.

**Step 2: Test manually in dev mode**

Run: `npx electron-forge start -- D:\dev\claude-terminal`
Expected: App opens directly into the running state without showing the StartupDialog. A new tab dialog appears since there are no saved sessions for that directory.

Run: `npx electron-forge start`
Expected: App shows the StartupDialog as before (no CLI arg).

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: auto-start session when directory provided via CLI argument"
```

---

### Task 5: Build the installer and test

**Step 1: Run the Electron Forge make command**

Run: `npx electron-forge make`
Expected: Produces output in `out/make/squirrel.windows/x64/` including `ClaudeTerminalSetup.exe`

**Step 2: Test the installer**

Run the generated `ClaudeTerminalSetup.exe`. Verify:
- App installs to `%LOCALAPPDATA%\ClaudeTerminal`
- Start Menu shortcut is created
- `claudeterm.cmd` exists in the install directory
- Install directory was added to user PATH (open new terminal, run `claudeterm --version` or just `claudeterm`)
- `claudeterm D:\dev\some-project` opens the app and auto-starts in that directory

**Step 3: Test uninstall**

Uninstall via Windows Settings > Apps. Verify:
- `claudeterm.cmd` is removed
- Install directory is removed from PATH

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: installer adjustments after testing"
```
