import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PermissionMode, Tab, RemoteAccessInfo, HookExecutionStatus, ProjectConfig } from '../shared/types';
import { PROJECT_COLORS } from '../shared/types';
import type { ShellOption } from '../shared/platform';
import { getAllShellOptions } from '../shared/platform';
import { ShellContext } from './shell-context';
import StartupDialog from './components/StartupDialog';
import TabBar from './components/TabBar';
import Terminal from './components/Terminal';
import { destroyTerminal } from './components/terminalCache';
import StatusBar from './components/StatusBar';
import ProjectSidebar from './components/ProjectSidebar';
import ProjectSwitcherDialog from './components/ProjectSwitcherDialog';
import { buildWindowTitle } from '../shared/window-title';
import { matchKeybinding, isTabJump, type KeybindingContext } from './keybindings';
import WorktreeNameDialog from './components/WorktreeNameDialog';
import WorktreeManagerDialog from './components/WorktreeManagerDialog';
import WorktreeCloseDialog from './components/WorktreeCloseDialog';
import HookManagerDialog from './components/HookManagerDialog';
import SettingsDialog from './components/SettingsDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type AppState = 'startup' | 'running';

export default function App() {
  const [appState, setAppState] = useState<AppState>('startup');
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [showWorktreeManager, setShowWorktreeManager] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Multi-project state
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);

  // Remember last active tab per project for Up/Down navigation
  const lastActiveTabByProject = useRef<Map<string, string>>(new Map());

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteAccessInfo>({
    status: 'inactive', tunnelUrl: null, token: null, error: null,
  });
  const [branch, setBranch] = useState<string | null>(null);
  const [showHookManager, setShowHookManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [defaultShell, setDefaultShell] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [availableShells, setAvailableShells] = useState<ShellOption[]>(
    () => getAllShellOptions(window.claudeTerminal?.platform ?? 'linux')
  );
  const defaultShellRef = useRef(defaultShell);
  defaultShellRef.current = defaultShell;
  const availableShellsRef = useRef(availableShells);
  availableShellsRef.current = availableShells;
  const [hookStatus, setHookStatus] = useState<{ hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null>(null);
  const hookDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [worktreeCloseConfirm, setWorktreeCloseConfirm] = useState<{
    tabId: string; worktreeName: string; clean: boolean; changesCount: number;
  } | null>(null);

  // Fetch available shells (filter to installed ones) and default shell preference
  useEffect(() => {
    window.claudeTerminal.getAvailableShells().then(setAvailableShells).catch(() => {});
    window.claudeTerminal.getDefaultShell().then(setDefaultShell).catch(() => {});
  }, []);

  // Filter tabs by active project
  const activeProjectTabs = useMemo(
    () => activeProjectId ? tabs.filter(t => t.projectId === activeProjectId) : tabs,
    [tabs, activeProjectId]
  );

  // Compute tab counts per project for sidebar
  const tabCounts = useMemo(() => {
    const counts: Record<string, { idle: number; working: number; requires_response: number; total: number }> = {};
    for (const project of projects) {
      counts[project.id] = { idle: 0, working: 0, requires_response: 0, total: 0 };
    }
    for (const tab of tabs) {
      const c = counts[tab.projectId];
      if (c) {
        c.total++;
        if (tab.status === 'idle') c.idle++;
        else if (tab.status === 'working') c.working++;
        else if (tab.status === 'requires_response') c.requires_response++;
      }
    }
    return counts;
  }, [tabs, projects]);

  // Set per-project color tint
  useEffect(() => {
    const project = projects.find(p => p.id === activeProjectId);
    if (project) {
      const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;
      document.documentElement.style.setProperty('--project-hue', String(hue));
    }
  }, [activeProjectId, projects]);

  const handleSelectTab = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    // Remember this tab as the last active for its project
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab) {
      lastActiveTabByProject.current.set(tab.projectId, tabId);
    }
    await window.claudeTerminal.switchTab(tabId);
  }, []);

  const handleSelectProject = useCallback(async (projectId: string) => {
    // Save current tab for the project we're leaving
    const leavingProjectId = activeProjectIdRef.current;
    const leavingTabId = activeTabIdRef.current;
    if (leavingProjectId && leavingTabId) {
      lastActiveTabByProject.current.set(leavingProjectId, leavingTabId);
    }

    setActiveProjectId(projectId);
    setShowProjectSwitcher(false);

    const projectTabs = tabsRef.current.filter(t => t.projectId === projectId);
    if (projectTabs.length > 0) {
      // Restore last active tab for this project, or fall back to first tab
      const rememberedTabId = lastActiveTabByProject.current.get(projectId);
      const targetTab = rememberedTabId && projectTabs.some(t => t.id === rememberedTabId)
        ? rememberedTabId
        : projectTabs[0].id;
      handleSelectTab(targetTab);
    } else {
      const tab = await window.claudeTerminal.createTab(projectId, null);
      setActiveTabId(tab.id);
    }
  }, [handleSelectTab]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab?.worktree) {
      try {
        const status = await window.claudeTerminal.checkWorktreeStatus(tab.cwd, tab.projectId);
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
    const projectId = activeProjectIdRef.current ?? '';
    const tab = await window.claudeTerminal.createTab(projectId, null);
    setActiveTabId(tab.id);
  }, []);

  const handleNewShellTab = useCallback(async (shellType: string, afterTabId?: string) => {
    const tab = await window.claudeTerminal.createShellTab(shellType, afterTabId);
    setTabs((prev) => {
      const filtered = prev.filter(t => t.id !== tab.id);
      if (afterTabId) {
        const afterIdx = filtered.findIndex(t => t.id === afterTabId);
        if (afterIdx >= 0) {
          const next = [...filtered];
          next.splice(afterIdx + 1, 0, tab);
          return next;
        }
      }
      return [...filtered, tab];
    });
    setActiveTabId(tab.id);
    await window.claudeTerminal.switchTab(tab.id);
  }, []);

  const handleNewDefaultShellTab = useCallback(async (afterTabId?: string) => {
    const shells = availableShellsRef.current;
    const shellId = defaultShellRef.current ?? shells[0]?.id;
    if (!shellId) return;
    await handleNewShellTab(shellId, afterTabId);
  }, [handleNewShellTab]);

  const handleDefaultShellChange = useCallback(async (shellId: string) => {
    setDefaultShell(shellId);
    await window.claudeTerminal.setDefaultShell(shellId);
  }, []);

  const handleReorderTabs = useCallback((reordered: Tab[]) => {
    setTabs(reordered);
    window.claudeTerminal.reorderTabs(reordered.map((t) => t.id));
  }, []);

  const handleRefreshTab = useCallback((tabId: string) => {
    // Send Ctrl+L to the PTY so the running app redraws the current screen
    window.claudeTerminal.writeToPty(tabId, '\x0c');
  }, []);

  const handleActivateRemote = useCallback(async () => {
    const info = await window.claudeTerminal.activateRemoteAccess();
    setRemoteInfo(info);
  }, []);

  const handleDeactivateRemote = useCallback(async () => {
    await window.claudeTerminal.deactivateRemoteAccess();
    setRemoteInfo({ status: 'inactive', tunnelUrl: null, token: null, error: null });
  }, []);

  const tryShowWorktreeDialog = useCallback(async () => {
    try {
      await window.claudeTerminal.getCurrentBranch(activeProjectIdRef.current ?? undefined);
      setShowWorktreeDialog(true);
    } catch {
      setAlertMessage('Cannot create a worktree: this workspace is not a Git repository, or the repository has no commits yet.');
    }
  }, []);

  const handleNewTabWithWorktree = useCallback(async (name: string) => {
    try {
      const projectId = activeProjectIdRef.current ?? '';
      const tab = await window.claudeTerminal.createTabWithWorktree(projectId, name);
      setActiveTabId(tab.id);
      setShowWorktreeDialog(false);
    } catch (err) {
      console.error('Failed to create tab with worktree:', err);
    }
  }, []);

  const handleRemoveProject = useCallback(async (projectId: string) => {
    try {
      await window.claudeTerminal.removeProject(projectId);
      // onProjectRemoved listener handles state cleanup
    } catch (err) {
      setAlertMessage(`Failed to remove project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const handleRenameProject = useCallback((projectId: string, name: string) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, displayName: name } : p
    ));
  }, []);

  const handleAddProject = useCallback(() => {
    setShowAddProjectDialog(true);
  }, []);

  const handleAddProjectConfirm = useCallback(async (dir: string) => {
    setShowAddProjectDialog(false);
    try {
      const config = await window.claudeTerminal.addProject(dir);
      // Dedup: onProjectAdded listener may have already added it
      setProjects(prev => {
        if (prev.some(p => p.id === config.id)) return prev;
        return [...prev, config];
      });
      setActiveProjectId(config.id);
      // Auto-create first tab for the new project
      const tab = await window.claudeTerminal.createTab(config.id, null);
      setActiveTabId(tab.id);
    } catch (err) {
      setAlertMessage(`Failed to add project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // Auto-start when a CLI directory was provided (skip StartupDialog)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cliDir = await window.claudeTerminal.getCliStartDir();
      if (!cliDir || cancelled) return;

      setWorkspaceDir(cliDir);

      const savedMode = await window.claudeTerminal.getPermissionMode();
      if (cancelled) return;

      const result = await window.claudeTerminal.startSession(cliDir, savedMode);
      if (cancelled) return;

      const projectId = result.projectId;
      const config: ProjectConfig = { id: projectId, dir: cliDir, colorIndex: 0 };
      setProjects([config]);
      setActiveProjectId(projectId);

      // Check if tabs already exist in the main process (renderer reload)
      const existingTabs = await window.claudeTerminal.getTabs();
      if (cancelled) return;

      if (existingTabs.length > 0) {
        const activeId = await window.claudeTerminal.getActiveTabId();
        if (cancelled) return;
        setTabs(existingTabs);
        setActiveTabId(activeId);
        setAppState('running');
        try {
          setBranch(await window.claudeTerminal.getCurrentBranch(projectId));
        } catch { /* not a git repo */ }
        return;
      }

      // Fresh start — restore from saved sessions
      const savedTabs = await window.claudeTerminal.getSavedTabs(cliDir);
      if (cancelled) return;

      await Promise.allSettled(
        savedTabs.map(saved =>
          window.claudeTerminal.createTab(projectId, saved.worktree, saved.sessionId, saved.name)
        )
      );
      if (cancelled) return;

      const allTabs = await window.claudeTerminal.getTabs();
      const activeId = await window.claudeTerminal.getActiveTabId();
      if (cancelled) return;

      setTabs(allTabs);
      setActiveTabId(activeId);
      setAppState('running');

      try {
        setBranch(await window.claudeTerminal.getCurrentBranch(projectId));
      } catch { /* not a git repo */ }

      if (allTabs.length === 0) {
        const tab = await window.claudeTerminal.createTab(projectId, null);
        setActiveTabId(tab.id);
      }
    })();

    return () => {
      cancelled = true;
    };
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
        const closingTab = prev.find((t) => t.id === tabId);
        const remaining = prev.filter((t) => t.id !== tabId);
        setActiveTabId((prevActive) => {
          if (prevActive === tabId) {
            if (remaining.length === 0) return null;
            const sameProject = remaining.filter((t) => t.projectId === closingTab?.projectId);
            return sameProject.length > 0 ? sameProject[0].id : null;
          }
          return prevActive;
        });
        return remaining;
      });
    });

    const cleanupRemote = window.claudeTerminal.onRemoteAccessUpdate((info) => {
      setRemoteInfo(info);
    });

    const cleanupSwitched = window.claudeTerminal.onTabSwitched((tabId) => {
      setActiveTabId(tabId);
    });

    const cleanupBranch = window.claudeTerminal.onBranchChanged((b, projectId) => {
      // Only update branch display if it's for the active project
      if (!projectId || projectId === activeProjectIdRef.current) {
        setBranch(b);
      }
    });

    const cleanupHookStatus = window.claudeTerminal.onHookStatus((status: HookExecutionStatus) => {
      if (hookDismissTimer.current) {
        clearTimeout(hookDismissTimer.current);
        hookDismissTimer.current = null;
      }
      setHookStatus({ hookName: status.hookName, status: status.status, error: status.error ?? status.stderr });
      if (status.status === 'done') {
        hookDismissTimer.current = setTimeout(() => setHookStatus(null), 3000);
      }
    });

    const cleanupProjectAdded = window.claudeTerminal.onProjectAdded((project) => {
      setProjects(prev => {
        if (prev.some(p => p.id === project.id)) return prev;
        return [...prev, project];
      });
    });

    const cleanupProjectRemoved = window.claudeTerminal.onProjectRemoved((projectId) => {
      setProjects(prev => prev.filter(p => p.id !== projectId));
      setActiveProjectId(prev => prev === projectId ? null : prev);
    });

    const cleanupProjectSwitch = window.claudeTerminal.onProjectSwitch((projectId) => {
      setActiveProjectId(projectId);
    });

    return () => {
      cleanupUpdate();
      cleanupRemoved();
      cleanupRemote();
      cleanupSwitched();
      cleanupBranch();
      cleanupHookStatus();
      cleanupProjectAdded();
      cleanupProjectRemoved();
      cleanupProjectSwitch();
    };
  }, []);

  // Update window title when tabs, active project, or branch change
  useEffect(() => {
    const activeProject = projects.find(p => p.id === activeProjectId);
    const dir = activeProject?.dir ?? workspaceDir;
    const title = buildWindowTitle(dir, activeProjectTabs, branch);
    window.claudeTerminal.setWindowTitle(title);
  }, [activeProjectTabs, activeProjectId, projects, workspaceDir, branch]);

  // Keyboard shortcuts
  useEffect(() => {
    if (appState !== 'running') return;

    const ctx: KeybindingContext = {
      activeTabId: () => activeTabIdRef.current,
      tabs: () => {
        // When project filtering is active, cycle within project tabs
        const projectId = activeProjectIdRef.current;
        if (projectId) {
          return tabsRef.current.filter(t => t.projectId === projectId);
        }
        return tabsRef.current;
      },
      projects: () => projectsRef.current,
      activeProjectId: () => activeProjectIdRef.current,
      addProject: handleAddProject,
      newTab: handleNewTabWithoutWorktree,
      newWorktreeTab: tryShowWorktreeDialog,
      newDefaultShellTab: handleNewDefaultShellTab,
      closeTab: handleCloseTab,
      selectTab: handleSelectTab,
      selectProject: handleSelectProject,
      renameTab: (id) => setRenamingTabId(id),
      openProjectSwitcher: () => setShowProjectSwitcher(true),
    };

    const handler = (e: KeyboardEvent) => {
      if (isTabJump(e)) {
        e.preventDefault();
        const projectTabs = activeProjectIdRef.current
          ? tabsRef.current.filter(t => t.projectId === activeProjectIdRef.current)
          : tabsRef.current;
        const idx = parseInt(e.key) - 1;
        if (idx < projectTabs.length) handleSelectTab(projectTabs[idx].id);
        return;
      }

      const kb = matchKeybinding(e);
      if (kb?.action) {
        e.preventDefault();
        kb.action(ctx);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [appState, handleAddProject, handleNewTabWithoutWorktree, handleNewDefaultShellTab, handleSelectTab, handleSelectProject, handleCloseTab, tryShowWorktreeDialog]);

  const handleStartSession = useCallback(async (dir: string, mode: PermissionMode) => {
    const result = await window.claudeTerminal.startSession(dir, mode);
    setWorkspaceDir(dir);

    const projectId = result.projectId;
    const config: ProjectConfig = { id: projectId, dir, colorIndex: 0 };
    setProjects([config]);
    setActiveProjectId(projectId);

    const savedTabs = await window.claudeTerminal.getSavedTabs(dir);

    if (savedTabs.length > 0) {
      await Promise.allSettled(
        savedTabs.map(saved =>
          window.claudeTerminal.createTab(projectId, saved.worktree, saved.sessionId, saved.name)
        )
      );
    }

    const allTabs = await window.claudeTerminal.getTabs();
    const activeId = await window.claudeTerminal.getActiveTabId();
    setTabs(allTabs);
    setActiveTabId(activeId);
    setAppState('running');

    try {
      setBranch(await window.claudeTerminal.getCurrentBranch(projectId));
    } catch { /* not a git repo */ }

    if (allTabs.length === 0) {
      const tab = await window.claudeTerminal.createTab(projectId, null);
      setActiveTabId(tab.id);
    }
  }, []);

  if (appState === 'startup') {
    return (
      <ShellContext.Provider value={availableShells}>
        <div className="flex flex-col h-screen border border-[hsl(var(--project-hue)_40%_25%)]">
          <StartupDialog onStart={handleStartSession} />
        </div>
      </ShellContext.Provider>
    );
  }

  return (
    <ShellContext.Provider value={availableShells}>
    <div className="flex flex-row h-screen border border-[hsl(var(--project-hue)_40%_25%)]">
      {projects.length > 0 && (
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId ?? ''}
          tabCounts={tabCounts}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onRenameProject={handleRenameProject}
        />
      )}
      <div className="flex flex-col flex-1 min-w-0">
        <TabBar
          tabs={activeProjectTabs}
          activeTabId={activeTabId}
          renamingTabId={renamingTabId}
          defaultShell={defaultShell}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
          onRenameHandled={() => setRenamingTabId(null)}
          onNewClaudeTab={handleNewTabWithoutWorktree}
          onNewWorktreeTab={tryShowWorktreeDialog}
          onNewShellTab={handleNewShellTab}
          onReorderTabs={handleReorderTabs}
          onRefreshTab={handleRefreshTab}
          onManageWorktrees={() => setShowWorktreeManager(true)}
          onManageHooks={() => setShowHookManager(true)}
          onOpenSettings={() => setShowSettings(true)}
          remoteInfo={remoteInfo}
          onActivateRemote={handleActivateRemote}
          onDeactivateRemote={handleDeactivateRemote}
        />
        <div className="flex-1 relative overflow-hidden" data-terminal-area>
          {tabs.map((tab) => (
            <Terminal
              key={tab.id}
              tabId={tab.id}
              isVisible={tab.id === activeTabId}
            />
          ))}
        </div>
        <StatusBar tabs={activeProjectTabs} hookStatus={hookStatus} />
      </div>
      {showWorktreeDialog && (
        <WorktreeNameDialog
          onCreateWithWorktree={handleNewTabWithWorktree}
          onCancel={() => setShowWorktreeDialog(false)}
        />
      )}
      {showWorktreeManager && (
        <WorktreeManagerDialog
          tabs={activeProjectTabs}
          onClose={() => setShowWorktreeManager(false)}
          onOpenClaude={async (worktreeName) => {
            const projectId = activeProjectIdRef.current ?? '';
            const tab = await window.claudeTerminal.createTab(projectId, worktreeName);
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
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        defaultShell={defaultShell}
        onDefaultShellChange={handleDefaultShellChange}
      />
      {showProjectSwitcher && (
        <ProjectSwitcherDialog
          projects={projects.map(p => ({
            ...p,
            tabCount: tabCounts[p.id]?.total ?? 0,
          }))}
          onSelect={handleSelectProject}
          onAddProject={() => {
            setShowProjectSwitcher(false);
            handleAddProject();
          }}
          onCancel={() => setShowProjectSwitcher(false)}
        />
      )}
      {showAddProjectDialog && (
        <StartupDialog
          title="Add Project"
          hidePermissions
          onStart={(dir) => handleAddProjectConfirm(dir)}
          onCancel={() => setShowAddProjectDialog(false)}
        />
      )}
      <Dialog open={!!alertMessage} onOpenChange={() => setAlertMessage(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Error</DialogTitle></DialogHeader>
          <DialogDescription>{alertMessage}</DialogDescription>
          <DialogFooter>
            <Button autoFocus onClick={() => setAlertMessage(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </ShellContext.Provider>
  );
}
