import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, SquareTerminal } from 'lucide-react';
import { penguin } from '@lucide/lab';
import type { Tab as TabType } from '../../shared/types';
import TabIndicator from './TabIndicator';
import { useClickOutside } from '../hooks/useClickOutside';

interface TabProps {
  tab: TabType;
  index: number;
  isActive: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, name: string) => void;
  onOpenShell?: (shellType: 'powershell' | 'wsl', afterTabId: string) => void;
  onDragStart: (e: React.DragEvent, tabId: string) => void;
  onDragOver: (e: React.DragEvent, tabId: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, tabId: string) => void;
  isDragOver: boolean;
}

const Tab = React.memo(function Tab({ tab, index, isActive, onSelect, onClose, onRename, onOpenShell, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }: TabProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.name);
  const [showChevron, setShowChevron] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  // Listen for F2 rename event (dispatched from App shell)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ tabId: string }>;
      if (customEvent.detail.tabId === tab.id) {
        setRenameValue(tab.name);
        setIsRenaming(true);
      }
    };
    window.addEventListener('tab:startRename', handler);
    return () => window.removeEventListener('tab:startRename', handler);
  }, [tab.id, tab.name]);

  const closeChevron = useCallback(() => setShowChevron(false), []);
  useClickOutside(chevronRef, showChevron, closeChevron);

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.name) {
      onRename(tab.id, trimmed);
    }
  };

  const handleDoubleClick = () => {
    setRenameValue(tab.name);
    setIsRenaming(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(tab.id);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowChevron(!showChevron);
  };

  const handleOpenShell = (shellType: 'powershell' | 'wsl') => {
    setShowChevron(false);
    onOpenShell?.(shellType, tab.id);
  };

  const statusClass = `tab-status-${tab.status}`;
  const shellClass = tab.type !== 'claude' ? `tab-shell tab-shell-${tab.type}` : '';

  return (
    <div
      ref={tabRef}
      className={`tab ${isActive ? 'tab-active' : ''} ${statusClass} ${shellClass}${isDragOver ? ' tab-drag-over' : ''}`}
      onClick={() => onSelect(tab.id)}
      onDoubleClick={handleDoubleClick}
      draggable={!isRenaming}
      onDragStart={(e) => onDragStart(e, tab.id)}
      onDragOver={(e) => onDragOver(e, tab.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, tab.id)}
    >
      {tab.type === 'claude' ? (
        <TabIndicator status={tab.status} />
      ) : (
        <span className="tab-indicator">
          {tab.type === 'powershell' ? (
            <SquareTerminal size={12} />
          ) : (
            <Icon iconNode={penguin} size={12} />
          )}
        </span>
      )}
      <div className="tab-labels">
        {isRenaming ? (
          <input
            ref={inputRef}
            className="tab-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
          />
        ) : (
          <span className="tab-name">{index < 9 && <span className="tab-number">{index + 1}</span>}{tab.name}</span>
        )}
        {tab.worktree && (
          <span className="tab-worktree">{tab.worktree}</span>
        )}
      </div>
      {tab.type === 'claude' && onOpenShell && (
        <div className="tab-chevron-wrapper" ref={chevronRef}>
          <button className="tab-chevron" onClick={handleChevronClick} title="Open shell here">&#9662;</button>
          {showChevron && (
            <div className="tab-chevron-dropdown">
              <button className="tab-chevron-item" onClick={() => handleOpenShell('powershell')}>PowerShell here</button>
              <button className="tab-chevron-item" onClick={() => handleOpenShell('wsl')}>WSL here</button>
            </div>
          )}
        </div>
      )}
      <button className="tab-close" onClick={handleCloseClick} title="Close tab">
        &times;
      </button>
    </div>
  );
});

export default Tab;
