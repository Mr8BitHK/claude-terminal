import { Notification } from 'electron';
import type { IpcMessage } from '@shared/types';
import type { TabManager } from './tab-manager';
import { log } from './logger';

export interface HookRouterDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
  generateTabName: (tabId: string, prompt: string) => void;
  cleanupNamingFlag: (tabId: string) => void;
  getMainWindow: () => { show: () => void; focus: () => void } | null;
}

export function createHookRouter(deps: HookRouterDeps) {
  function notifyTabActivity(tabId: string, title: string, body: string) {
    if (!Notification.isSupported()) return;

    const notification = new Notification({ title, body });
    notification.on('click', () => {
      const win = deps.getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
      deps.tabManager.setActiveTab(tabId);
      const tab = deps.tabManager.getTab(tabId);
      if (tab) {
        deps.sendToRenderer('tab:updated', tab);
      }
    });
    notification.show();
  }

  function handleHookMessage(msg: IpcMessage) {
    const { tabId, event, data } = msg;
    log.debug('[hook]', event, tabId, data ? data.substring(0, 80) : null);
    const tab = deps.tabManager.getTab(tabId);
    if (!tab) return;

    const isActive = deps.tabManager.getActiveTabId() === tabId;

    switch (event) {
      case 'tab:ready': {
        let sessionId = '';
        let source = '';
        try {
          const parsed = JSON.parse(data ?? '');
          sessionId = parsed.sessionId || '';
          source = parsed.source || '';
        } catch {
          sessionId = data ?? '';
        }
        log.info('[tab:ready]', tabId, 'sessionId:', sessionId, 'source:', source);

        if (source === 'clear') {
          log.info('[tab:ready] /clear detected for', tabId, '— resetting name');
          deps.tabManager.resetName(tabId);
          deps.cleanupNamingFlag(tabId);
        }

        deps.tabManager.updateStatus(tabId, 'new');
        if (sessionId) {
          deps.tabManager.setSessionId(tabId, sessionId);
        }
        deps.persistSessions();
        break;
      }

      case 'tab:status:working':
        deps.tabManager.updateStatus(tabId, 'working');
        break;

      case 'tab:status:idle':
        deps.tabManager.updateStatus(tabId, 'idle');
        if (!isActive && tab) {
          notifyTabActivity(tabId, tab.name, 'Claude has finished working');
        }
        break;

      case 'tab:status:input':
        deps.tabManager.updateStatus(tabId, 'requires_response');
        if (!isActive && tab) {
          notifyTabActivity(tabId, tab.name, 'Claude needs your input');
        }
        break;

      case 'tab:closed':
        log.debug('[tab:closed] SessionEnd for', tabId, '(waiting for onExit or tab:ready)');
        return;

      case 'tab:name':
        if (data) {
          deps.tabManager.rename(tabId, data);
          deps.persistSessions();
        }
        break;

      case 'tab:generate-name':
        if (data) {
          deps.generateTabName(tabId, data);
        }
        return;

      default:
        return;
    }

    const updated = deps.tabManager.getTab(tabId);
    if (updated) {
      deps.sendToRenderer('tab:updated', updated);
    }
  }

  return { handleHookMessage };
}
