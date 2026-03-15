import React from 'react';
import { cn } from '@/lib/utils';
import type { Tab, TabStatus } from '../../shared/types';
import { useShellOptions } from '../shell-context';
import TabIndicator from './TabIndicator';

const STATUS_ORDER: { status: TabStatus; label: string }[] = [
  { status: 'working', label: 'Working' },
  { status: 'idle', label: 'Idle' },
  { status: 'requires_response', label: 'Input' },
  { status: 'new', label: 'New' },
];

const statusColorMap: Record<string, string> = {
  working: 'text-warning',
  requires_response: 'text-attention',
  idle: 'text-success',
};

const hookColorMap: Record<string, string> = {
  running: 'text-warning',
  done: 'text-[#4ec9b0]',
  failed: 'text-destructive',
};

interface StatusBarProps {
  tabs: Tab[];
  hookStatus?: { hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null;
}

const StatusBar = React.memo(function StatusBar({ tabs, hookStatus }: StatusBarProps) {
  const shellOptions = useShellOptions();
  const isWindows = window.claudeTerminal?.platform === 'win32';
  const shellHint = shellOptions.length >= 2 && isWindows
    ? `Ctrl+Shift+P ${shellOptions[0].label} | Ctrl+L ${shellOptions[1].label}`
    : shellOptions.length >= 1
    ? `Ctrl+Shift+P ${shellOptions[0].label}`
    : '';
  const counts = new Map<TabStatus, number>();
  for (const tab of tabs) {
    counts.set(tab.status, (counts.get(tab.status) ?? 0) + 1);
  }

  return (
    <div className="flex gap-4 px-3 py-0.5 bg-[hsl(var(--project-hue)_30%_18%)] text-muted-foreground text-xs min-h-[22px] items-center border-t border-border">
      <div className="flex gap-3 items-center">
        {STATUS_ORDER.map(({ status, label }) => {
          const count = counts.get(status);
          if (!count) return null;
          return (
            <span key={status} className={cn('inline-flex items-center gap-1', statusColorMap[status])} title={label}>
              <TabIndicator status={status} /> {count}
            </span>
          );
        })}
      </div>
      {hookStatus && (
        <span className={cn('text-xs', hookColorMap[hookStatus.status])} title={hookStatus.error || undefined}>
          {hookStatus.status === 'running' ? '⟳' : hookStatus.status === 'done' ? '✓' : '✗'}
          {' '}{hookStatus.hookName}{hookStatus.status === 'running' ? '...' : ''}
        </span>
      )}
      <span className="ml-auto">
        Ctrl+T Claude | Ctrl+W Worktree | Ctrl+P Projects{shellHint ? ` | ${shellHint}` : ''} | Ctrl+F4 close | Ctrl+Tab switch | F2 rename
      </span>
    </div>
  );
});

export default StatusBar;
