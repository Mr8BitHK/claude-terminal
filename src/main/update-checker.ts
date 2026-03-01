import { ipcMain, type BrowserWindow } from 'electron';
import { log } from './logger';

declare const __APP_VERSION__: string;

const REPO = 'Mr8BitHK/claude-terminal';

export interface UpdateInfo {
  version: string;
  url: string;
}

let cachedUpdate: UpdateInfo | null = null;

function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

export function registerUpdateHandlers(): void {
  ipcMain.handle('app:getUpdateInfo', () => cachedUpdate);
}

export async function checkForUpdate(win: BrowserWindow): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;
    const data = await res.json();
    const tag: string = data.tag_name ?? '';
    const version = tag.replace(/^v/, '');
    if (version && isNewer(version, __APP_VERSION__)) {
      const url: string = data.html_url ?? `https://github.com/${REPO}/releases/latest`;
      log.info(`[update] new version available: ${version} (current: ${__APP_VERSION__})`);
      cachedUpdate = { version, url };
      if (!win.isDestroyed()) {
        win.webContents.send('app:updateAvailable', cachedUpdate);
      }
    }
  } catch {
    // Silent — network errors, rate limits, etc.
  }
}
