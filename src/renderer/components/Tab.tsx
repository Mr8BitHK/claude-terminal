import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, SquareTerminal } from 'lucide-react';
import { penguin } from '@lucide/lab';
import type { Tab as TabType } from '../../shared/types';
import TabIndicator from './TabIndicator';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface TabProps {
  tab: TabType;
  index: number;
  isActive: boolean;
  isRenaming: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, name: string) => void;
  onRenameHandled: () => void;
  onOpenShell?: (shellType: 'powershell' | 'wsl', afterTabId: string) => void;
  onDragStart: (e: React.DragEvent, tabId: string) => void;
  onDragOver: (e: React.DragEvent, tabId: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, tabId: string) => void;
  isDragOver: boolean;
}

const Tab = React.memo(function Tab({ tab, index, isActive, isRenaming: isRenamingProp, onSelect, onClose, onRename, onRenameHandled, onOpenShell, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }: TabProps) {
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

  // Enter rename mode when triggered via F2 from App
  useEffect(() => {
    if (isRenamingProp) {
      setRenameValue(tab.name);
      setIsRenaming(true);
      onRenameHandled();
    }
  }, [isRenamingProp, tab.name, onRenameHandled]);

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

  const handleOpenShell = useCallback((shellType: 'powershell' | 'wsl') => {
    onOpenShell?.(shellType, tab.id);
  }, [onOpenShell, tab.id]);

  return (
    <div
      ref={tabRef}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-border text-[13px] select-none [-webkit-app-region:no-drag]',
        isActive && 'bg-[hsl(var(--instance-hue)_45%_30%)] outline outline-1 outline-[#c9d1d9] font-semibold',
        !isActive && 'hover:bg-[hsl(var(--instance-hue)_20%_24%)]',
        isDragOver && 'border-l-2 border-l-primary'
      )}
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
        <span className="inline-flex items-center [&_svg]:size-3 text-[#569cd6]">
          {tab.type === 'powershell' ? (
            <SquareTerminal size={12} />
          ) : (
            <Icon iconNode={penguin} size={12} />
          )}
        </span>
      )}
      <div className="flex flex-col min-w-0">
        {isRenaming ? (
          <Input
            ref={inputRef}
            className="h-6 w-[120px] text-[13px]"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
          />
        ) : (
          <span className="truncate">
            {index < 9 && <span className="text-muted-foreground mr-1 text-[11px]">{index + 1}</span>}
            {tab.name}
          </span>
        )}
        {tab.worktree && (
          <span className="text-[10px] text-muted-foreground truncate">{tab.worktree}</span>
        )}
      </div>
      {tab.type === 'claude' && onOpenShell && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground text-xs px-0.5"
              onClick={(e) => e.stopPropagation()}
              title="Open shell here"
            >
              &#9662;
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleOpenShell('powershell')}>PowerShell here</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleOpenShell('wsl')}>WSL here</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        className="text-muted-foreground hover:text-foreground text-base px-0.5"
        onClick={handleCloseClick}
        title="Close tab"
      >
        &times;
      </button>
    </div>
  );
});

export default Tab;
