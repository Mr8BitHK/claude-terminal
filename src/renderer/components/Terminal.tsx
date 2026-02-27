import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
}

// Cache terminals per tabId so switching tabs preserves scrollback
const terminalCache = new Map<string, { term: XTerm; fitAddon: FitAddon }>();

export function destroyTerminal(tabId: string): void {
  const cached = terminalCache.get(tabId);
  if (cached) {
    cached.term.dispose();
    terminalCache.delete(tabId);
  }
}

export default function Terminal({ tabId, isVisible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !isVisible) return;

    const container = containerRef.current;

    // Get or create terminal for this tab
    let cached = terminalCache.get(tabId);
    if (!cached) {
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          selectionBackground: '#264f78',
          black: '#1e1e1e',
          red: '#f44747',
          green: '#6a9955',
          yellow: '#dcdcaa',
          blue: '#569cd6',
          magenta: '#c586c0',
          cyan: '#4ec9b0',
          white: '#d4d4d4',
          brightBlack: '#808080',
          brightRed: '#f44747',
          brightGreen: '#6a9955',
          brightYellow: '#dcdcaa',
          brightBlue: '#569cd6',
          brightMagenta: '#c586c0',
          brightCyan: '#4ec9b0',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      // Forward keyboard input to PTY
      term.onData((data) => {
        window.claudeTerminal.writeToPty(tabId, data);
      });

      cached = { term, fitAddon };
      terminalCache.set(tabId, cached);
    }

    const { term, fitAddon } = cached;

    // If already attached to this container, just fit
    if (attachedRef.current === tabId && container.querySelector('.xterm')) {
      fitAddon.fit();
      return;
    }

    // Clear container and attach
    container.innerHTML = '';
    term.open(container);

    // Try to load WebGL addon (falls back gracefully)
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, use canvas renderer
    }

    fitAddon.fit();
    attachedRef.current = tabId;

    // Report initial size to PTY
    window.claudeTerminal.resizePty(tabId, term.cols, term.rows);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.claudeTerminal.resizePty(tabId, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [tabId, isVisible]);

  // Listen for PTY data
  useEffect(() => {
    const cleanup = window.claudeTerminal.onPtyData((dataTabId, data) => {
      const cached = terminalCache.get(dataTabId);
      if (cached) {
        cached.term.write(data);
      }
    });
    return cleanup;
  }, []);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: isVisible ? 'block' : 'none' }}
    />
  );
}
