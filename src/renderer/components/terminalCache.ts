import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export const terminalCache = new Map<string, { term: XTerm; fitAddon: FitAddon }>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
}
