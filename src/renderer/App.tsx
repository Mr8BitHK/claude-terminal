import { useCallback, useEffect, useRef, useState } from 'react';
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
import HookManagerDialog from './components/HookManagerDialog';

type AppState = 'startup' | 'running';

export default function App() {
  const [appState, setAppState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [showWorktreeManager, setShowWorktreeManager] = useState(false);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo>({
    status: 'inactive', tunnelUrl: null, token: null, error: null,
  });
  const [branch, setBranch] = useState<string | null>(null);
  const [showHookManager, setShowHookManager] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [worktreeCloseConfirm, setWorktreeCloseConfirm] = useState<{
    tabId: string; worktreeName: string; clean: boolean; changesCount: number;
  } | null>(null);

  const handleSelectTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    await window.claudeTerminal.switchTab(tabId);
  }, []);

  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
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
  }, []);

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

  const handleNewTabWithWorktree = useCallback(async (name: string) => {
    try {
      const tab = await window.claudeTerminal.createTabWithWorktree(name);
      setActiveTabId(tab.id);
      setShowWorktreeDialog(false);
    } catch (err) {
      console.error('Failed to create tab with worktree:', err);
    }
  }, []);

  // Auto-start when a CLI directory was provided (skip StartupDialog)
  useEffect(() => {
    let cancelled = false;
    const createdTabIds: string[] = [];

    (async () => {
      const cliDir = await window.claudeTerminal.getCliStartDir();
      if (!cliDir || cancelled) return;

      setWorkspaceDir(cliDir);

      const savedMode = await window.claudeTerminal.getPermissionMode();
      if (cancelled) return;

      await window.claudeTerminal.startSession(cliDir, savedMode);
      if (cancelled) return;

      const savedTabs = await window.claudeTerminal.getSavedTabs(cliDir);
      if (cancelled) return;

      // Create all tabs in parallel for faster startup
      const results = await Promise.allSettled(
        savedTabs.map(saved =>
          window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name)
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') createdTabIds.push(r.value.id);
      }
      if (cancelled) return;

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

    return () => {
      cancelled = true;
      // Clean up any PTY processes spawned before the unmount
      createdTabIds.forEach(id => window.claudeTerminal.closeTab(id));
    };
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



  // Keyboard shortcuts — use refs to avoid re-registering on every state change
  useEffect(() => {
    if (appState !== 'running') return;

    const handler = (e: KeyboardEvent) => {
      const currentTabs = tabsRef.current;
      const currentActiveId = activeTabIdRef.current;

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
        if (currentActiveId) {
          handleCloseTab(currentActiveId);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: switch tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (currentTabs.length <= 1) return;
        const currentIdx = currentTabs.findIndex((t) => t.id === currentActiveId);
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? currentTabs.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= currentTabs.length - 1 ? 0 : currentIdx + 1;
        }
        handleSelectTab(currentTabs[nextIdx].id);
        return;
      }

      // Ctrl+1-9: jump to tab
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < currentTabs.length) {
          handleSelectTab(currentTabs[idx].id);
        }
        return;
      }

      // F2: rename active tab
      if (e.key === 'F2') {
        e.preventDefault();
        if (currentActiveId) {
          setRenamingTabId(currentActiveId);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [appState, handleNewTabWithoutWorktree, handleNewShellTab, handleSelectTab, handleCloseTab]);

  const handleStartSession = useCallback(async (dir: string, mode: PermissionMode) => {
    await window.claudeTerminal.startSession(dir, mode);
    setWorkspaceDir(dir);

    // Check for saved tabs from a previous session in this directory
    const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

    if (savedTabs.length > 0) {
      // Create all tabs in parallel for faster startup
      await Promise.allSettled(
        savedTabs.map(saved =>
          window.claudeTerminal.createTab(saved.worktree, saved.sessionId, saved.name)
        )
      );
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
  }, [handleNewTabWithoutWorktree]);

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
        renamingTabId={renamingTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onRenameTab={handleRenameTab}
        onRenameHandled={() => setRenamingTabId(null)}
        onNewClaudeTab={handleNewTabWithoutWorktree}
        onNewWorktreeTab={() => setShowWorktreeDialog(true)}
        onNewShellTab={handleNewShellTab}
        onReorderTabs={handleReorderTabs}
        onManageWorktrees={() => setShowWorktreeManager(true)}
        onManageHooks={() => setShowHookManager(true)}
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
      {showHookManager && (
        <HookManagerDialog onClose={() => setShowHookManager(false)} />
      )}
    </div>
  );
}
