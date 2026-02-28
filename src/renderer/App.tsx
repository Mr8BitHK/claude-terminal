import { useCallback, useEffect, useState } from 'react';
import type { PermissionMode, Tab, RemoteAccessInfo } from '../shared/types';
import StartupDialog from './components/StartupDialog';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import { destroyTerminal } from './components/terminalCache';
import StatusBar from './components/StatusBar';
import { buildWindowTitle } from '../shared/window-title';
import WorktreeNameDialog from './components/WorktreeNameDialog';
import WorktreeManagerDialog from './components/WorktreeManagerDialog';
import WorktreeCloseDialog from './components/WorktreeCloseDialog';

type AppState = 'startup' | 'running';

export default function App() {
  const [appState, setAppState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [showWorktreeManager, setShowWorktreeManager] = useState(false);
  const [worktreeCount, setWorktreeCount] = useState(0);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo>({
    status: 'inactive', tunnelUrl: null, token: null, error: null,
  });
  const [branch, setBranch] = useState<string | null>(null);
  const [worktreeCloseConfirm, setWorktreeCloseConfirm] = useState<{
    tabId: string; worktreeName: string; clean: boolean; changesCount: number;
  } | null>(null);

  const handleSelectTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    await window.claudeTerminal.switchTab(tabId);
  }, []);

  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.worktree) {
      try {
        const status = await window.claudeTerminal.checkWorktreeStatus(tab.cwd);
        setWorktreeCloseConfirm({
          tabId, worktreeName: tab.worktree, clean: status.clean, changesCount: status.changesCount,
        });
        return;
      } catch {
        // If status check fails, close without removing worktree
      }
    }
    await window.claudeTerminal.closeTab(tabId);
  }, [tabs]);

  const handleRenameTab = useCallback(async (tabId: string, name: string) => {
    await window.claudeTerminal.renameTab(tabId, name);
  }, []);

  const handleNewTabWithoutWorktree = useCallback(async () => {
    const tab = await window.claudeTerminal.createTab(null);
    setActiveTabId(tab.id);
  }, []);

  const handleNewShellTab = useCallback(async (shellType: 'powershell' | 'wsl', afterTabId?: string) => {
    const tab = await window.claudeTerminal.createShellTab(shellType, afterTabId);
    setActiveTabId(tab.id);
  }, []);

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabs(reordered);
    window.claudeTerminal.reorderTabs(reordered.map((t) => t.id));
  }, []);

  const handleActivateRemote = useCallback(async () => {
    const info = await window.claudeTerminal.activateRemoteAccess();
    setRemoteInfo(info);
  }, []);

  const handleDeactivateRemote = useCallback(async () => {
    await window.claudeTerminal.deactivateRemoteAccess();
    setRemoteInfo({ status: 'inactive', tunnelUrl: null, token: null, error: null });
  }, []);

  const handleNewTabWithWorktree = async (name: string) => {
    setShowWorktreeDialog(false);
    await window.claudeTerminal.createWorktree(name);
    const tab = await window.claudeTerminal.createTab(name);
    setActiveTabId(tab.id);
  };

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
        try {
          const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name);
          if (cancelled) return;
          setActiveTabId(tab.id);
        } catch {
          // Worktree may have been removed — skip this tab
        }
      }

      const allTabs = await window.claudeTerminal.getTabs();
      const activeId = await window.claudeTerminal.getActiveTabId();
      if (cancelled) return;

      setTabs(allTabs);
      setActiveTabId(activeId);
      setAppState('running');

      try {
        setBranch(await window.claudeTerminal.getCurrentBranch());
      } catch { /* not a git repo */ }

      if (allTabs.length === 0) {
        handleNewTabWithoutWorktree();
      }
    })();

    return () => { cancelled = true; };
  }, [handleNewTabWithoutWorktree]);

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

    const cleanupRemote = window.claudeTerminal.onRemoteAccessUpdate((info) => {
      setRemoteInfo(info);
    });

    // Remote client switched tabs — mirror locally
    const cleanupSwitched = window.claudeTerminal.onTabSwitched((tabId) => {
      setActiveTabId(tabId);
    });

    const cleanupBranch = window.claudeTerminal.onBranchChanged((b) => {
      setBranch(b);
    });

    return () => {
      cleanupUpdate();
      cleanupRemoved();
      cleanupRemote();
      cleanupSwitched();
      cleanupBranch();
    };
  }, []);

  // Update window title when tabs, workspace, or branch change
  useEffect(() => {
    const title = buildWindowTitle(workspaceDir, tabs, branch);
    window.claudeTerminal.setWindowTitle(title);
  }, [tabs, workspaceDir, branch]);

  // Track worktree count for hamburger menu
  useEffect(() => {
    if (appState !== 'running') return;
    const updateCount = async () => {
      try {
        const details = await window.claudeTerminal.listWorktreeDetails();
        setWorktreeCount(details.length);
      } catch { /* session may not be started */ }
    };
    updateCount();
    const interval = setInterval(updateCount, 5000);
    return () => clearInterval(interval);
  }, [appState]);

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

      // Ctrl+P: new PowerShell tab
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        handleNewShellTab('powershell');
        return;
      }

      // Ctrl+L: new WSL tab
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        handleNewShellTab('wsl');
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
  }, [appState, tabs, activeTabId, handleNewTabWithoutWorktree, handleNewShellTab, handleSelectTab, handleCloseTab]);

  const handleStartSession = async (dir: string, mode: PermissionMode) => {
    await window.claudeTerminal.startSession(dir, mode);
    setWorkspaceDir(dir);

    // Check for saved tabs from a previous session in this directory
    const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

    if (savedTabs.length > 0) {
      // Restore saved tabs with --resume
      for (const saved of savedTabs) {
        try {
          const tab = await window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name);
          setActiveTabId(tab.id);
        } catch {
          // Worktree may have been removed — skip this tab
        }
      }
    }

    // Load all tabs (includes any just-created ones)
    const allTabs = await window.claudeTerminal.getTabs();
    const activeId = await window.claudeTerminal.getActiveTabId();
    setTabs(allTabs);
    setActiveTabId(activeId);
    setAppState('running');

    try {
      setBranch(await window.claudeTerminal.getCurrentBranch());
    } catch { /* not a git repo */ }

    // Only create a tab if no tabs were restored
    if (allTabs.length === 0) {
      handleNewTabWithoutWorktree();
    }
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
        onNewClaudeTab={handleNewTabWithoutWorktree}
        onNewWorktreeTab={() => setShowWorktreeDialog(true)}
        onNewShellTab={handleNewShellTab}
        onReorderTabs={handleReorderTabs}
        worktreeCount={worktreeCount}
        onManageWorktrees={() => setShowWorktreeManager(true)}
        remoteInfo={remoteInfo}
        onActivateRemote={handleActivateRemote}
        onDeactivateRemote={handleDeactivateRemote}
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
      {showWorktreeDialog && (
        <WorktreeNameDialog
          onCreateWithWorktree={handleNewTabWithWorktree}
          onCancel={() => setShowWorktreeDialog(false)}
        />
      )}
      {showWorktreeManager && (
        <WorktreeManagerDialog
          tabs={tabs}
          onClose={() => setShowWorktreeManager(false)}
          onOpenClaude={async (worktreeName) => {
            const tab = await window.claudeTerminal.createTab(worktreeName);
            setActiveTabId(tab.id);
          }}
          onOpenShell={async (shellType, cwd) => {
            const tab = await window.claudeTerminal.createShellTab(shellType, undefined, cwd);
            setActiveTabId(tab.id);
          }}
        />
      )}
      {worktreeCloseConfirm && (
        <WorktreeCloseDialog
          worktreeName={worktreeCloseConfirm.worktreeName}
          clean={worktreeCloseConfirm.clean}
          changesCount={worktreeCloseConfirm.changesCount}
          onConfirm={async (removeWorktree) => {
            const { tabId } = worktreeCloseConfirm;
            setWorktreeCloseConfirm(null);
            await window.claudeTerminal.closeTab(tabId, removeWorktree);
          }}
          onCancel={() => setWorktreeCloseConfirm(null)}
        />
      )}
    </div>
  );
}
