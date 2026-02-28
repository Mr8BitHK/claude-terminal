import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import type { IDisposable } from '@xterm/xterm';

export interface CachedTerminal {
  term: XTerm;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  onDataDisposable?: IDisposable;
}

export const terminalCache = new Map<string, CachedTerminal>();

// Renderer-side flow control state
export const pendingBytes = new Map<string, number>();
export const pausedTabs = new Set<string>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.onDataDisposable?.dispose();
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
  pendingBytes.delete(tabId);
  pausedTabs.delete(tabId);
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
