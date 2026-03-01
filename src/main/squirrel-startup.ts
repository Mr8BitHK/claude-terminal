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
    setUserPath(newPath);
  } catch {
    try {
      setUserPath(appFolder);
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
      setUserPath(filtered);
    }
  } catch {
    // best-effort
  }
}

/**
 * Write the user PATH environment variable via `reg add` instead of `setx`.
 * `setx` silently truncates values longer than 1024 characters, which can
 * corrupt a user's PATH. `reg add` has no such limit.
 *
 * After writing, broadcasts WM_SETTINGCHANGE so running processes (Explorer,
 * terminals) pick up the change without requiring a reboot.
 */
function setUserPath(newPath: string): void {
  execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, {
    stdio: 'ignore',
  });

  // Broadcast WM_SETTINGCHANGE so Explorer and other processes pick up the
  // environment change immediately (best-effort, mirrors what setx does).
  try {
    execSync(
      'powershell -NoProfile -Command "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition \'[DllImport(\\\"user32.dll\\\", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\'; $HWND_BROADCAST = [IntPtr]0xffff; $WM_SETTINGCHANGE = 0x1a; $result = [UIntPtr]::Zero; [Win32.NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, \'Environment\', 2, 5000, [ref]$result)"',
      { stdio: 'ignore' },
    );
  } catch {
    // best-effort — environment change will take effect on next login
  }
}
