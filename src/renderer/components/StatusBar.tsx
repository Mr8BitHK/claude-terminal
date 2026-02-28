import type { Tab } from '../../shared/types';
import TabIndicator from './TabIndicator';

interface StatusBarProps {
  tab: Tab | null;
  tabCount: number;
}

export default function StatusBar({ tab, tabCount }: StatusBarProps) {
  return (
    <div className="status-bar">
      {tab ? (
        <>
          <span>
            <TabIndicator status={tab.status} /> {tab.status}
          </span>
          {tab.worktree && (
            <span>worktree: {tab.worktree}</span>
          )}
          <span>tabs: {tabCount}</span>
        </>
      ) : (
        <span>No active tab</span>
      )}
      <span className="status-help">
        Ctrl+T new | Ctrl+F4 close | Ctrl+Tab switch | F2 rename
      </span>
    </div>
  );
}
