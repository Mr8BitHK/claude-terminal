import { useCallback, useEffect, useState } from 'react';
import type { PermissionMode, Tab } from '../shared/types';
import StartupDialog from './components/StartupDialog';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import { destroyTerminal } from './components/terminalCache';
import StatusBar from './components/StatusBar';
import NewTabDialog from './components/NewTabDialog';
import { buildWindowTitle } from '../shared/window-title';
import WorktreeNameDialog from './components/WorktreeNameDialog';

type AppState = 'startup' | 'running';

export default function App() {
  const [appState, setAppState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showNewTabDialog, setShowNewTabDialog] = useState(false);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  // Auto-start when a CLI directory was provided (skip StartupDialog)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cliDir = await window.claudeTerminal.getCliStartDir();
      if (!cliDir || cancelled) return;

      setWorkspaceDir(cliDir);

      const savedMode = await window.claudeTerminal.getPermissionMode();
      if (cancelled) return;

      await window.claudeTerminal.startSession(cliDir, savedMode);
      if (cancelled) return;

      const savedTabs = await window.claudeTerminal.getSavedTabs(cliDir);
      for (const saved of savedTabs) {
        if (cancelled) return;
        const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name);
        if (cancelled) return;
        setActiveTabId(tab.id);
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
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        // Update active tab inside the same updater to avoid stale ref reads
        setActiveTabId((prevActive) => {
          if (prevActive === tabId) {
            return remaining.length > 0 ? remaining[0].id : null;
          }
          return prevActive;
        });
        return remaining;
      });
    });

    return () => {
      cleanupUpdate();
      cleanupRemoved();
    };
  }, []);

  // Update window title when tabs or workspace change
  useEffect(() => {
    const title = buildWindowTitle(workspaceDir, tabs);
    window.claudeTerminal.setWindowTitle(title);
  }, [tabs, workspaceDir]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle shortcuts when running
      if (appState !== 'running') return;

      // Ctrl+T: new tab (no worktree, no dialog)
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        handleNewTabWithoutWorktree();
        return;
      }

      // Ctrl+W: new worktree tab (prompt for name)
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        setShowWorktreeDialog(true);
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
    setWorkspaceDir(dir);

    // Check for saved tabs from a previous session in this directory
    const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

    if (savedTabs.length > 0) {
      // Restore saved tabs with --resume
      for (const saved of savedTabs) {
        const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name);
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
    setShowWorktreeDialog(false);
    await window.claudeTerminal.createWorktree(name);
    const tab = await window.claudeTerminal.createTab(name);
    setActiveTabId(tab.id);
  };

  const handleNewTabWithoutWorktree = async () => {
    setShowNewTabDialog(false);
    const tab = await window.claudeTerminal.createTab(null);
    setActiveTabId(tab.id);
  };

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
      <StatusBar tabs={tabs} />
      {showNewTabDialog && (
        <NewTabDialog
          onCreateWithWorktree={handleNewTabWithWorktree}
          onCreateWithoutWorktree={handleNewTabWithoutWorktree}
          onCancel={() => setShowNewTabDialog(false)}
        />
      )}
      {showWorktreeDialog && (
        <WorktreeNameDialog
          onCreateWithWorktree={handleNewTabWithWorktree}
          onCancel={() => setShowWorktreeDialog(false)}
        />
      )}
    </div>
  );
}
