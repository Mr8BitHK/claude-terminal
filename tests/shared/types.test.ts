import { TabStatus, Tab, IpcMessage, PermissionMode } from '@shared/types';

describe('shared types', () => {
  it('TabStatus has all expected values', () => {
    const statuses: TabStatus[] = ['new', 'working', 'idle', 'requires_response', 'shell'];
    expect(statuses).toHaveLength(5);
  });

  it('Tab has required fields', () => {
    const tab: Tab = {
      id: 'tab-1',
      type: 'claude',
      name: 'Tab 1',
      defaultName: 'Tab 1',
      status: 'new',
      worktree: null,
      cwd: '/some/path',
      pid: null,
      sessionId: null,
    };
    expect(tab.id).toBe('tab-1');
    expect(tab.worktree).toBeNull();
  });

  it('IpcMessage has required structure', () => {
    const msg: IpcMessage = {
      tabId: 'tab-1',
      event: 'tab:status:working',
      data: null,
    };
    expect(msg.event).toBe('tab:status:working');
  });

  it('PermissionMode has expected values', () => {
    const modes: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];
    expect(modes).toHaveLength(4);
  });
});
