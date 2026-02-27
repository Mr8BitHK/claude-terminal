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
    const currentPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
    });
    const match = currentPath.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    const existingPath = match ? match[1].trim() : '';

    const pathEntries = existingPath.split(';').map(p => p.toLowerCase());
    if (pathEntries.includes(appFolder.toLowerCase())) return;

    const newPath = existingPath ? `${existingPath};${appFolder}` : appFolder;
    execSync(`setx Path "${newPath}"`, { stdio: 'ignore' });
  } catch {
    try {
      execSync(`setx Path "${appFolder}"`, { stdio: 'ignore' });
    } catch {
      // best-effort
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
