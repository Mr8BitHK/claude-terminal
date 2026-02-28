import { useEffect, useRef, useState } from 'react';
import type { Tab as TabType } from '../../shared/types';
import TabIndicator from './TabIndicator';

interface TabProps {
  tab: TabType;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

export default function Tab({ tab, isActive, onClick, onClose, onRename }: TabProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);

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

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tab.name) {
      onRename(trimmed);
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
    onClose();
  };

  const statusClass = `tab-status-${tab.status}`;

  return (
    <div
      ref={tabRef}
      className={`tab ${isActive ? 'tab-active' : ''} ${statusClass}`}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      <TabIndicator status={tab.status} />
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
        <span className="tab-name">{tab.name}</span>
      )}
      {tab.worktree && (
        <span className="tab-worktree">[{tab.worktree}]</span>
      )}
      <button className="tab-close" onClick={handleCloseClick} title="Close tab">
        &times;
      </button>
    </div>
  );
}
