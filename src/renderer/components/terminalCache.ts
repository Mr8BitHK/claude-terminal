import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebglAddon } from '@xterm/addon-webgl';
import type { IDisposable } from '@xterm/xterm';

export interface CachedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  onDataDisposable?: IDisposable;
  webglAddon?: WebglAddon;
}

export const terminalCache = new Map<string, CachedTerminal>();

// Buffer for worktree progress messages that arrive before xterm is mounted
export const pendingWrites = new Map<string, string[]>();

// Renderer-side flow control state
export const pendingBytes = new Map<string, number>();
export const pausedTabs = new Set<string>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.webglAddon?.dispose();
    cached.onDataDisposable?.dispose();
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
  pendingBytes.delete(tabId);
  pausedTabs.delete(tabId);
  pendingWrites.delete(tabId);
}

/**
 * Serialize a terminal's visible buffer + scrollback as ANSI escape sequences.
 * Exposed as a global so the main process can call it via executeJavaScript.
 */
(window as any).__serializeTerminal = (tabId: string): string => {
  const cached = terminalCache.get(tabId);
  if (!cached) return '';
  return cached.serializeAddon.serialize();
};
