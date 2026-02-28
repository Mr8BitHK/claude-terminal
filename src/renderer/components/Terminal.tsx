import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { terminalCache } from './terminalCache';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
}

// Single global PTY data listener (registered once, not per component).
// We store the cleanup handle on `window` so it survives Vite HMR module
// reloads — a module-level variable would reset, leaving the old listener
// on ipcRenderer and causing duplicate writes (doubled characters).
let ptyListenerRegistered = false;

function ensurePtyListener(): void {
  if (ptyListenerRegistered) return;
  ptyListenerRegistered = true;

  // Clean up any stale listener from a previous HMR module instance
  const win = window as any;
  if (typeof win.__cleanupPtyListener === 'function') {
    win.__cleanupPtyListener();
  }

  win.__cleanupPtyListener = window.claudeTerminal.onPtyData((dataTabId, data) => {
    const cached = terminalCache.get(dataTabId);
    if (cached) {
      cached.term.write(data);
    }
  });
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

      // Let app-level shortcuts pass through to the window handler
      term.attachCustomKeyEventHandler((e) => {
        if (e.altKey && e.key === 'F4') return false;
        if (e.ctrlKey && (e.key === 'F4' || e.key === 't' || e.key === 'w' || e.key === 'p' || e.key === 'l' || e.key === 'Tab'))
          return false;
        if (e.ctrlKey && e.key >= '1' && e.key <= '9') return false;
        if (e.key === 'F2') return false;
        // Ctrl+Enter: insert newline instead of submitting
        if (e.ctrlKey && e.key === 'Enter') {
          if (e.type === 'keydown') {
            window.claudeTerminal.writeToPty(tabId, '\x1b\r');
          }
          return false;
        }
        return true;
      });

      // Forward keyboard input to PTY
      term.onData((data) => {
        window.claudeTerminal.writeToPty(tabId, data);
      });

      cached = { term, fitAddon };
      terminalCache.set(tabId, cached);
    }

    const { term, fitAddon } = cached;

    // Ensure the global PTY data listener is registered
    ensurePtyListener();

    // Helper: fit terminal and sync PTY dimensions
    const fitAndSync = () => {
      fitAddon.fit();
      if (term.cols > 0 && term.rows > 0) {
        window.claudeTerminal.resizePty(tabId, term.cols, term.rows);
      }
    };

    // If already attached to this container, just fit and set up resize observer
    const alreadyAttached =
      attachedRef.current === tabId && container.querySelector('.xterm');

    if (!alreadyAttached) {
      // Clear container and attach
      container.innerHTML = '';
      term.open(container);

      attachedRef.current = tabId;
    }

    // Right-click: copy selection if any, otherwise paste from clipboard
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        term.clearSelection();
      } else {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            term.paste(text);
          }
        });
      }
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // Defer initial fit to next frame so the container has final layout dimensions
    const rafId = requestAnimationFrame(() => {
      fitAndSync();
      term.focus();
    });

    // Handle resize — always set up observer (even for already-attached terminals)
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      // Debounce rapid resize events to avoid flooding the PTY
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(fitAndSync, 50);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [tabId, isVisible]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ display: isVisible ? 'block' : 'none' }}
    />
  );
}
