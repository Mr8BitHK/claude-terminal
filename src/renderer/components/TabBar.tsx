import { useEffect, useRef, useState } from 'react';
import type { Tab as TabType, RemoteAccessInfo } from '../../shared/types';
import Tab from './Tab';
import HamburgerMenu from './HamburgerMenu';
import RemoteAccessButton from './RemoteAccessButton';

interface TabBarProps {
  tabs: TabType[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onNewClaudeTab: () => void;
  onNewWorktreeTab: () => void;
  onNewShellTab: (shellType: 'powershell' | 'wsl', afterTabId?: string) => void;
  onReorderTabs: (tabs: TabType[]) => void;
  worktreeCount: number;
  onManageWorktrees: () => void;
  onManageHooks: () => void;
  remoteInfo: RemoteAccessInfo;
  onActivateRemote: () => void;
  onDeactivateRemote: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewClaudeTab,
  onNewWorktreeTab,
  onNewShellTab,
  onReorderTabs,
  worktreeCount,
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

  useEffect(() => {
    if (!showNewTabMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowNewTabMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNewTabMenu]);

  return (
    <div className={`tab-bar${isDragging ? ' tab-bar-dragging' : ''}`}>
      {tabs.map((tab, index) => (
        <Tab
          key={tab.id}
          tab={tab}
          index={index}
          isActive={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onRename={(name) => onRenameTab(tab.id, name)}
          onOpenShell={(shellType) => onNewShellTab(shellType, tab.id)}
          isDragOver={dragOverTabId === tab.id}
          onDragStart={(e) => {
            dragTabId.current = tab.id;
            e.dataTransfer.effectAllowed = 'move';
            setIsDragging(true);
            document.body.classList.add('tab-dragging');
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragTabId.current && dragTabId.current !== tab.id) {
              setDragOverTabId(tab.id);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTabId(null);
            const fromId = dragTabId.current;
            if (!fromId || fromId === tab.id) return;
            const fromIdx = tabs.findIndex((t) => t.id === fromId);
            const toIdx = tabs.findIndex((t) => t.id === tab.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const reordered = [...tabs];
            const [moved] = reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, moved);
            onReorderTabs(reordered);
          }}
          onDragEnd={() => {
            dragTabId.current = null;
            setDragOverTabId(null);
            setIsDragging(false);
            document.body.classList.remove('tab-dragging');
          }}
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
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('powershell'); }}
            >
              <span>PowerShell</span>
              <span className="new-tab-shortcut">Ctrl+P</span>
            </button>
            <button
              className="new-tab-item"
              onClick={() => { setShowNewTabMenu(false); onNewShellTab('wsl'); }}
            >
              <span>WSL</span>
              <span className="new-tab-shortcut">Ctrl+L</span>
            </button>
          </div>
        )}
      </div>
      <RemoteAccessButton
        remoteInfo={remoteInfo}
        onActivate={onActivateRemote}
        onDeactivate={onDeactivateRemote}
      />
      <HamburgerMenu worktreeCount={worktreeCount} onManageWorktrees={onManageWorktrees} onManageHooks={onManageHooks} />
    </div>
  );
}
