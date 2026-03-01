import { useCallback, useRef, useState } from 'react';
import type { Tab as TabType, RemoteAccessInfo } from '../../shared/types';
import Tab from './Tab';
import HamburgerMenu from './HamburgerMenu';
import RemoteAccessButton from './RemoteAccessButton';
import UpdateButton from './UpdateButton';
import { useClickOutside } from '../hooks/useClickOutside';

interface TabBarProps {
  tabs: TabType[];
  activeTabId: string | null;
  renamingTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onRenameHandled: () => void;
  onNewClaudeTab: () => void;
  onNewWorktreeTab: () => void;
  onNewShellTab: (shellType: 'powershell' | 'wsl', afterTabId?: string) => void;
  onReorderTabs: (tabs: TabType[]) => void;
  onManageWorktrees: () => void;
  onManageHooks: () => void;
  remoteInfo: RemoteAccessInfo;
  onActivateRemote: () => void;
  onDeactivateRemote: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  renamingTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onRenameHandled,
  onNewClaudeTab,
  onNewWorktreeTab,
  onNewShellTab,
  onReorderTabs,
  onManageWorktrees,
  onManageHooks,
  remoteInfo,
  onActivateRemote,
  onDeactivateRemote,
}: TabBarProps) {
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragTabId = useRef<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const closeNewTabMenu = useCallback(() => setShowNewTabMenu(false), []);
  useClickOutside(menuRef, showNewTabMenu, closeNewTabMenu);

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    dragTabId.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
    document.body.classList.add('tab-dragging');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragTabId.current && dragTabId.current !== tabId) {
      setDragOverTabId(tabId);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    setDragOverTabId(null);
    const fromId = dragTabId.current;
    if (!fromId || fromId === tabId) return;
    const currentTabs = tabsRef.current;
    const fromIdx = currentTabs.findIndex((t) => t.id === fromId);
    const toIdx = currentTabs.findIndex((t) => t.id === tabId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...currentTabs];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    onReorderTabs(reordered);
  }, [onReorderTabs]);

  const handleDragEnd = useCallback(() => {
    dragTabId.current = null;
    setDragOverTabId(null);
    setIsDragging(false);
    document.body.classList.remove('tab-dragging');
  }, []);

  return (
    <div className={`tab-bar${isDragging ? ' tab-bar-dragging' : ''}`}>
      {tabs.map((tab, index) => (
        <Tab
          key={tab.id}
          tab={tab}
          index={index}
          isActive={tab.id === activeTabId}
          isRenaming={tab.id === renamingTabId}
          onSelect={onSelectTab}
          onClose={onCloseTab}
          onRename={onRenameTab}
          onRenameHandled={onRenameHandled}
          onOpenShell={tab.type === 'claude' ? onNewShellTab : undefined}
          isDragOver={dragOverTabId === tab.id}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
      <div className="new-tab-menu" ref={menuRef}>
        <button
          className="new-tab-btn"
          onClick={() => setShowNewTabMenu(!showNewTabMenu)}
          title="New tab"
        >
          +
        </button>
        {showNewTabMenu && (
          <div className="new-tab-dropdown">
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewClaudeTab(); }}
            >
              <span>Claude Tab</span>
              <span className="new-tab-shortcut">Ctrl+T</span>
            </button>
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewWorktreeTab(); }}
            >
              <span>Claude Worktree</span>
              <span className="new-tab-shortcut">Ctrl+W</span>
            </button>
            <div className="new-tab-separator" />
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('powershell', activeTabId ?? undefined); }}
            >
              <span>PowerShell</span>
              <span className="new-tab-shortcut">Ctrl+P</span>
            </button>
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('wsl', activeTabId ?? undefined); }}
            >
              <span>WSL</span>
              <span className="new-tab-shortcut">Ctrl+L</span>
            </button>
          </div>
        )}
      </div>
      <div className="tab-bar-right">
        <UpdateButton />
        <RemoteAccessButton
          remoteInfo={remoteInfo}
          onActivate={onActivateRemote}
          onDeactivate={onDeactivateRemote}
        />
        <HamburgerMenu onManageWorktrees={onManageWorktrees} onManageHooks={onManageHooks} />
      </div>
    </div>
  );
}
