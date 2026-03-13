import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { terminalCache, pendingBytes, pausedTabs, pendingWrites } from './terminalCache';
import { matchKeybinding, isTabJump } from '../keybindings';

interface TerminalProps {
  tabId: string;
  isVisible: boolean;
  /** When set, terminal uses fixed dimensions instead of FitAddon. */
  fixedCols?: number;
  fixedRows?: number;
}

const HIGH_WATERMARK = 50 * 1024; // 50KB
const LOW_WATERMARK = 10 * 1024;  // 10KB

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
    if (!cached) return;

    const pending = (pendingBytes.get(dataTabId) ?? 0) + data.length;
    pendingBytes.set(dataTabId, pending);

    cached.term.write(data, () => {
      const updated = (pendingBytes.get(dataTabId) ?? 0) - data.length;
      pendingBytes.set(dataTabId, Math.max(0, updated));

      if (pausedTabs.has(dataTabId) && updated < LOW_WATERMARK) {
        pausedTabs.delete(dataTabId);
        window.claudeTerminal.resumePty(dataTabId);
      }
    });

    if (!pausedTabs.has(dataTabId) && pending > HIGH_WATERMARK) {
      pausedTabs.add(dataTabId);
      window.claudeTerminal.pausePty(dataTabId);
    }
  });

  // Also register for worktree progress events (same HMR-safe pattern)
  if (typeof win.__cleanupWorktreeProgressListener === 'function') {
    win.__cleanupWorktreeProgressListener();
  }

  win.__cleanupWorktreeProgressListener =
    window.claudeTerminal.onWorktreeProgress((dataTabId, text) => {
      const cached = terminalCache.get(dataTabId);
      if (cached) {
        cached.term.write(text);
      } else {
        // Terminal not mounted yet — buffer for replay when it's created
        const pending = pendingWrites.get(dataTabId) ?? [];
        pending.push(text);
        pendingWrites.set(dataTabId, pending);
      }
    });
}

const Terminal = React.memo(function Terminal({ tabId, isVisible, fixedCols, fixedRows }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<string | null>(null);

  useEffect(() => {
    // Create terminal and register in cache on mount, even for hidden tabs.
    // This ensures PTY data is buffered by xterm (not dropped) while the tab is hidden.
    let cached = terminalCache.get(tabId);
    if (!cached) {
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        scrollback: 5000,
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
      const serializeAddon = new SerializeAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(serializeAddon);
      term.loadAddon(new WebLinksAddon((_event, uri) => {
        window.claudeTerminal.openExternal(uri);
      }));

      // Let registered app-level shortcuts pass through xterm
      term.attachCustomKeyEventHandler((e) => {
        if (isTabJump(e)) return false;
        const kb = matchKeybinding(e);
        if (kb) {
          if (kb.onTerminal && e.type === 'keydown') kb.onTerminal(tabId);
          return false;
        }
        // Ctrl+V / Ctrl+Shift+V: paste from clipboard into terminal.
        // Without this, xterm sends \x16 (literal-next) to the PTY, which
        // breaks clipboard-based text insertion tools like Wisprflow.
        if (e.ctrlKey && e.key === 'v' && e.type === 'keydown') {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text) term.paste(text);
          });
          return false;
        }
        return true;
      });

      // Forward keyboard input to PTY
      const onDataDisposable = term.onData((data) => {
        window.claudeTerminal.writeToPty(tabId, data);
      });

      cached = { term, fitAddon, serializeAddon, onDataDisposable };
      terminalCache.set(tabId, cached);

      // Flush any worktree progress messages that arrived before xterm was mounted
      const buffered = pendingWrites.get(tabId);
      if (buffered) {
        for (const text of buffered) {
          term.write(text);
        }
        pendingWrites.delete(tabId);
      }
    }

    // Ensure the global PTY data listener is registered (even for hidden tabs,
    // so data is buffered in xterm rather than dropped)
    ensurePtyListener();

    if (!containerRef.current || !isVisible) return;

    const container = containerRef.current;
    const { term, fitAddon } = cached;

    const isFixedSize = fixedCols !== undefined && fixedRows !== undefined;

    // Helper: fit terminal and sync PTY dimensions
    const fitAndSync = () => {
      if (isFixedSize) {
        // Remote mode: use exact host terminal dimensions
        term.resize(fixedCols, fixedRows);
      } else {
        fitAddon.fit();
        if (term.cols > 0 && term.rows > 0) {
          window.claudeTerminal.resizePty(tabId, term.cols, term.rows);
        }
      }
    };

    // If already attached to this container, just fit and set up resize observer
    const alreadyAttached =
      attachedRef.current === tabId && container.querySelector('.xterm');

    if (!alreadyAttached) {
      // Clear container and attach
      container.innerHTML = '';
      term.open(container);

      // Activate WebGL renderer (replaces default DOM renderer)
      if (!cached.webglAddon) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            console.log(`[WebGL:${tabId}] context lost — falling back to DOM`);
            webglAddon.dispose();
            if (cached) cached.webglAddon = undefined;
          });
          term.loadAddon(webglAddon);
          cached.webglAddon = webglAddon;
        } catch (err) {
          console.error(`[WebGL:${tabId}] addon load FAILED:`, err);
          // WebGL unavailable — DOM renderer remains active
        }
      }

      attachedRef.current = tabId;
    }

    // Two-finger swipe: scroll through terminal scrollback on touch devices.
    // Single-finger swipe is consumed by browser overflow scrolling (panning the
    // oversized terminal in remote mode), so we use two fingers for scrollback.
    let twoFingerLastY: number | null = null;
    let scrollRemainder = 0;
    const LINE_PX = 20; // approximate pixels per terminal line

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        twoFingerLastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        scrollRemainder = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && twoFingerLastY !== null) {
        e.preventDefault();
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rawDelta = twoFingerLastY - currentY + scrollRemainder;
        const lines = Math.trunc(rawDelta / LINE_PX);
        if (lines !== 0) {
          term.scrollLines(lines);
          scrollRemainder = rawDelta - lines * LINE_PX;
          twoFingerLastY = currentY;
        }
      }
    };

    const handleTouchEnd = () => {
      twoFingerLastY = null;
      scrollRemainder = 0;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

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

    // Handle resize — for Electron, observe container; for remote, size is driven by props
    let resizeTimeout: ReturnType<typeof setTimeout>;
    let resizeObserver: ResizeObserver | null = null;
    if (!isFixedSize) {
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(fitAndSync, 50);
      });
      resizeObserver.observe(container);
    }

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimeout);
      resizeObserver?.disconnect();
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [tabId, isVisible, fixedCols, fixedRows]);

  // Toggle cursor blink off for hidden terminals to stop idle GPU repaints
  useEffect(() => {
    const cached = terminalCache.get(tabId);
    if (!cached) return;
    cached.term.options.cursorBlink = isVisible;
  }, [tabId, isVisible]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ display: isVisible ? 'block' : 'none' }}
    />
  );
});

export default Terminal;
