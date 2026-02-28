import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Tab, RemoteAccessInfo } from '../shared/types';
import { WebSocketBridge } from './ws-bridge';
import TabBar from '../renderer/components/TabBar';
import Terminal from '../renderer/components/Terminal';
import StatusBar from '../renderer/components/StatusBar';
import { destroyTerminal } from '../renderer/components/terminalCache';
import '../renderer/index.css';
import './web-client.css';

const bridge = new WebSocketBridge();

// ---------------------------------------------------------------------------
// TokenScreen — shown before authentication
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'claude-remote-token';

async function connectWithToken(
  token: string,
  onConnected: (tabs: Tab[], activeTabId: string | null, termSizes: Record<string, { cols: number; rows: number }>) => void,
): Promise<void> {
  const result = await bridge.connect(token);
  sessionStorage.setItem(TOKEN_KEY, token);
  (window as any).claudeTerminal = bridge.api;
  onConnected(result.tabs, result.activeTabId, result.termSizes);
}

function TokenScreen({ onConnected }: {
  onConnected: (tabs: Tab[], activeTabId: string | null, termSizes: Record<string, { cols: number; rows: number }>) => void;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Auto-connect with saved token from a previous session
  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    setConnecting(true);
    connectWithToken(saved, onConnected).catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      setConnecting(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.length !== 6 || connecting) return;

    setConnecting(true);
    setError(null);

    try {
      await connectWithToken(token, onConnected);
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      setConnecting(false);
    }
  };

  return (
    <div className="app">
      <div className="dialog-overlay">
        <div className="dialog startup-dialog">
          <div className="startup-header">
            <h1>Claude Terminal Remote</h1>
          </div>
          {connecting ? (
            <p style={{ color: '#808080', textAlign: 'center' }}>Reconnecting...</p>
          ) : (
          <form onSubmit={handleSubmit}>
            <label className="section-label">Access Code</label>
            <input
              type="text"
              autoComplete="off"
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              autoFocus
              disabled={connecting}
              style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.5em' }}
            />
            {error && <div className="validation-error">{error}</div>}
            <div className="dialog-actions" style={{ marginTop: 20 }}>
              <button
                type="submit"
                className="start-btn-primary"
                disabled={token.length !== 6 || connecting}
              >
                Connect
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RemoteApp — shown after successful authentication
// ---------------------------------------------------------------------------

function RemoteApp({ initialTabs, initialActiveTabId, initialTermSizes, onDisconnected }: {
  initialTabs: Tab[];
  initialActiveTabId: string | null;
  initialTermSizes: Record<string, { cols: number; rows: number }>;
  onDisconnected: () => void;
}) {
  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialActiveTabId);
  const [termSizes, setTermSizes] = useState(initialTermSizes);

  // Stub remote info — remote access controls don't make sense in the web client
  const remoteInfo: RemoteAccessInfo = {
    status: 'inactive', tunnelUrl: null, token: null, error: null,
  };

  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    window.claudeTerminal.switchTab(tabId);
  }, []);

  const handleRenameTab = useCallback((tabId: string, name: string) => {
    window.claudeTerminal.renameTab(tabId, name);
  }, []);

  // Listen for tab updates/removals/disconnect from the server
  useEffect(() => {
    const cleanupUpdate = window.claudeTerminal.onTabUpdate((tab) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tab.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = tab;
          return next;
        }
        return [...prev, tab];
      });
    });

    const cleanupRemoved = window.claudeTerminal.onTabRemoved((tabId) => {
      destroyTerminal(tabId);
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        setActiveTabId((prevActive) => {
          if (prevActive === tabId) {
            return remaining.length > 0 ? remaining[0].id : null;
          }
          return prevActive;
        });
        return remaining;
      });
    });

    const cleanupDisconnect = bridge.api.onDisconnect(onDisconnected);

    const cleanupResized = bridge.api.onPtyResized((tabId, cols, rows) => {
      setTermSizes((prev) => ({ ...prev, [tabId]: { cols, rows } }));
    });

    const cleanupSwitched = bridge.api.onTabSwitched((tabId) => {
      setActiveTabId(tabId);
    });

    return () => {
      cleanupUpdate();
      cleanupRemoved();
      cleanupDisconnect();
      cleanupResized();
      cleanupSwitched();
    };
  }, []);

  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab: switch tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length <= 1) return;
        const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? tabs.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= tabs.length - 1 ? 0 : currentIdx + 1;
        }
        handleSelectTab(tabs[nextIdx].id);
        return;
      }

      // Ctrl+1-9: jump to tab
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          handleSelectTab(tabs[idx].id);
        }
        return;
      }

      // F2: rename active tab
      if (e.key === 'F2') {
        e.preventDefault();
        if (activeTabId) {
          window.dispatchEvent(
            new CustomEvent('tab:startRename', { detail: { tabId: activeTabId } })
          );
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, activeTabId, handleSelectTab]);

  // No-ops for actions not available remotely
  const noop = () => {};

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={noop}
        onRenameTab={handleRenameTab}
        onNewClaudeTab={noop}
        onNewWorktreeTab={noop}
        onNewShellTab={noop}
        onReorderTabs={noop}
        worktreeCount={0}
        onManageWorktrees={noop}
        remoteInfo={remoteInfo}
        onActivateRemote={noop}
        onDeactivateRemote={noop}
      />
      <div className="terminal-area">
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            tabId={tab.id}
            isVisible={tab.id === activeTabId}
            fixedCols={termSizes[tab.id]?.cols}
            fixedRows={termSizes[tab.id]?.rows}
          />
        ))}
      </div>
      <StatusBar tabs={tabs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component — two-screen flow
// ---------------------------------------------------------------------------

type AppScreen = 'token' | 'connected' | 'disconnected';

function DisconnectedScreen({ onReconnected }: {
  onReconnected: (tabs: Tab[], activeTabId: string | null, termSizes: Record<string, { cols: number; rows: number }>) => void;
}) {
  const [status, setStatus] = useState<'reconnecting' | 'failed'>('reconnecting');

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) {
      setStatus('failed');
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 20;
    const baseDelay = 1000;

    const tryReconnect = () => {
      if (cancelled) return;
      attempt++;
      connectWithToken(saved, onReconnected).catch(() => {
        if (cancelled) return;
        if (attempt >= maxAttempts) {
          sessionStorage.removeItem(TOKEN_KEY);
          setStatus('failed');
        } else {
          const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), 10000);
          setTimeout(tryReconnect, delay);
        }
      });
    };

    // Small initial delay to let the server recover from whatever caused the disconnect
    setTimeout(tryReconnect, 1000);

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app">
      <div className="dialog-overlay">
        <div className="dialog startup-dialog" style={{ textAlign: 'center' }}>
          <div className="startup-header">
            <h1>Disconnected</h1>
          </div>
          {status === 'reconnecting' ? (
            <p style={{ color: '#808080', marginBottom: 20 }}>Reconnecting...</p>
          ) : (
            <>
              <p style={{ color: '#808080', marginBottom: 20 }}>
                Could not reconnect to the remote session.
              </p>
              <button
                className="start-btn-primary"
                onClick={() => window.location.reload()}
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WebClientApp() {
  const [screen, setScreen] = useState<AppScreen>('token');
  const [initialTabs, setInitialTabs] = useState<Tab[]>([]);
  const [initialActiveTabId, setInitialActiveTabId] = useState<string | null>(null);
  const [initialTermSizes, setInitialTermSizes] = useState<Record<string, { cols: number; rows: number }>>({});

  const handleConnected = (tabs: Tab[], activeTabId: string | null, termSizes: Record<string, { cols: number; rows: number }>) => {
    setInitialTabs(tabs);
    setInitialActiveTabId(activeTabId);
    setInitialTermSizes(termSizes);
    setScreen('connected');
  };

  const handleDisconnected = useCallback(() => {
    setScreen('disconnected');
  }, []);

  if (screen === 'token') {
    return <TokenScreen onConnected={handleConnected} />;
  }

  if (screen === 'disconnected') {
    return <DisconnectedScreen onReconnected={handleConnected} />;
  }

  return (
    <RemoteApp
      initialTabs={initialTabs}
      initialActiveTabId={initialActiveTabId}
      initialTermSizes={initialTermSizes}
      onDisconnected={handleDisconnected}
    />
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <WebClientApp />
  </StrictMode>
);
