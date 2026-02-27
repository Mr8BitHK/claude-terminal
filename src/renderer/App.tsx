import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionMode, Tab } from '../shared/types';
import StartupDialog from './components/StartupDialog';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import { destroyTerminal } from './components/terminalCache';
import StatusBar from './components/StatusBar';
import NewTabDialog from './components/NewTabDialog';

type AppState = 'startup' | 'running';

export default function App() {
  const [appState, setAppState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showNewTabDialog, setShowNewTabDialog] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Auto-start when a CLI directory was provided (skip StartupDialog)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cliDir = await window.claudeTerminal.getCliStartDir();
      if (!cliDir || cancelled) return;

      const savedMode = await window.claudeTerminal.getPermissionMode();
      if (cancelled) return;

      await window.claudeTerminal.startSession(cliDir, savedMode);
      if (cancelled) return;

      const savedTabs = await window.claudeTerminal.getSavedTabs(cliDir);
      if (savedTabs.length > 0) {
        for (const saved of savedTabs) {
          const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId);
          setActiveTabId(tab.id);
        }
      }

      const allTabs = await window.claudeTerminal.getTabs();
      const activeId = await window.claudeTerminal.getActiveTabId();
      if (cancelled) return;

      setTabs(allTabs);
      setActiveTabId(activeId);
      setAppState('running');

      if (allTabs.length === 0) {
        setShowNewTabDialog(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Listen for tab updates from main process (registered once)
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
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      setActiveTabId((prev) => {
        if (prev === tabId) {
          // Switch to another tab (use ref to avoid stale closure)
          const remaining = tabsRef.current.filter((t) => t.id !== tabId);
          return remaining.length > 0 ? remaining[0].id : null;
        }
        return prev;
      });
    });

    return () => {
      cleanupUpdate();
      cleanupRemoved();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle shortcuts when running
      if (appState !== 'running') return;

      // Ctrl+T: new tab
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        setShowNewTabDialog(true);
        return;
      }

      // Ctrl+F4: close tab
      if (e.ctrlKey && e.key === 'F4') {
        e.preventDefault();
        if (activeTabId) {
          handleCloseTab(activeTabId);
        }
        return;
      }

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
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [appState, tabs, activeTabId]);

  const handleStartSession = async (dir: string, mode: PermissionMode) => {
    await window.claudeTerminal.startSession(dir, mode);

    // Check for saved tabs from a previous session in this directory
    const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

    if (savedTabs.length > 0) {
      // Restore saved tabs with --resume
      for (const saved of savedTabs) {
        const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId);
        setActiveTabId(tab.id);
      }
    }

    // Load all tabs (includes any just-created ones)
    const allTabs = await window.claudeTerminal.getTabs();
    const activeId = await window.claudeTerminal.getActiveTabId();
    setTabs(allTabs);
    setActiveTabId(activeId);
    setAppState('running');

    // Only show new tab dialog if no tabs were restored
    if (allTabs.length === 0) {
      setShowNewTabDialog(true);
    }
  };

  const handleSelectTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    await window.claudeTerminal.switchTab(tabId);
  }, []);

  const handleCloseTab = useCallback(async (tabId: string) => {
    await window.claudeTerminal.closeTab(tabId);
  }, []);

  const handleRenameTab = useCallback(async (tabId: string, name: string) => {
    await window.claudeTerminal.renameTab(tabId, name);
  }, []);

  const handleNewTabWithWorktree = async (name: string) => {
    setShowNewTabDialog(false);
    await window.claudeTerminal.createWorktree(name);
    const tab = await window.claudeTerminal.createTab(name);
    setActiveTabId(tab.id);
  };

  const handleNewTabWithoutWorktree = async () => {
    setShowNewTabDialog(false);
    const tab = await window.claudeTerminal.createTab(null);
    setActiveTabId(tab.id);
  };

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  if (appState === 'startup') {
    return (
      <div className="app">
        <StartupDialog onStart={handleStartSession} />
      </div>
    );
  }

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onRenameTab={handleRenameTab}
        onNewTab={() => setShowNewTabDialog(true)}
      />
      <div className="terminal-area">
        {tabs.map((tab) => (
          <Terminal
            key={tab.id}
            tabId={tab.id}
            isVisible={tab.id === activeTabId}
          />
        ))}
      </div>
      <StatusBar tab={activeTab} tabCount={tabs.length} />
      {showNewTabDialog && (
        <NewTabDialog
          onCreateWithWorktree={handleNewTabWithWorktree}
          onCreateWithoutWorktree={handleNewTabWithoutWorktree}
          onCancel={() => setShowNewTabDialog(false)}
        />
      )}
    </div>
  );
}
