import React from 'react';
import type { Tab, TabStatus } from '../../shared/types';
import TabIndicator from './TabIndicator';

const STATUS_ORDER: { status: TabStatus; label: string }[] = [
  { status: 'working', label: 'Working' },
  { status: 'idle', label: 'Idle' },
  { status: 'requires_response', label: 'Input' },
  { status: 'new', label: 'New' },
];

interface StatusBarProps {
  tabs: Tab[];
  hookStatus?: { hookName: string; status: 'running' | 'done' | 'failed'; error?: string } | null;
}

const StatusBar = React.memo(function StatusBar({ tabs, hookStatus }: StatusBarProps) {
  const counts = new Map<TabStatus, number>();
  for (const tab of tabs) {
    counts.set(tab.status, (counts.get(tab.status) ?? 0) + 1);
  }

  return (
    <div className="status-bar">
      <div className="status-counts">
        {STATUS_ORDER.map(({ status, label }) => {
          const count = counts.get(status);
          if (!count) return null;
          return (
            <span key={status} className={`status-count tab-status-${status}`} title={label}>
              <TabIndicator status={status} /> {count}
            </span>
          );
        })}
      </div>
      {hookStatus && (
        <span className={`hook-status hook-${hookStatus.status}`} title={hookStatus.error || undefined}>
          {hookStatus.status === 'running' ? '⟳' : hookStatus.status === 'done' ? '✓' : '✗'}
          {' '}{hookStatus.hookName}{hookStatus.status === 'running' ? '...' : ''}
        </span>
      )}
      <span className="status-help">
        Ctrl+T Claude | Ctrl+W Worktree | Ctrl+P PS | Ctrl+L WSL | Ctrl+F4 close | Ctrl+Tab switch | F2 rename
      </span>
    </div>
  );
});

export default StatusBar;
