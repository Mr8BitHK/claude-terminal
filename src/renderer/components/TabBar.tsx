import type { Tab as TabType } from '../../shared/types';
import Tab from './Tab';

interface TabBarProps {
  tabs: TabType[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onNewTab: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewTab,
}: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onRename={(name) => onRenameTab(tab.id, name)}
        />
      ))}
      <button className="new-tab-btn" onClick={onNewTab} title="New tab (Ctrl+T)">
        +
      </button>
    </div>
  );
}
