import { TabStatus, Tab, IpcMessage, PermissionMode, HOOK_EVENTS } from '@shared/types';
import type { RepoHookConfig, RepoHook, HookCommand, HookEvent } from '@shared/types';

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

describe('RepoHook types', () => {
  it('HOOK_EVENTS contains all supported events', () => {
    expect(HOOK_EVENTS).toContain('worktree:created');
    expect(HOOK_EVENTS).toContain('worktree:removed');
    expect(HOOK_EVENTS).toContain('tab:created');
    expect(HOOK_EVENTS).toContain('tab:closed');
    expect(HOOK_EVENTS).toContain('session:started');
    expect(HOOK_EVENTS).toContain('app:started');
    expect(HOOK_EVENTS).toContain('branch:changed');
    expect(HOOK_EVENTS.length).toBe(7);
  });

  it('RepoHookConfig shape is valid', () => {
    const config: RepoHookConfig = {
      hooks: [
        {
          id: 'test',
          name: 'Test hook',
          event: 'worktree:created',
          commands: [{ path: '.', command: 'echo hello' }],
          enabled: true,
        },
      ],
    };
    expect(config.hooks).toHaveLength(1);
    expect(config.hooks[0].commands[0].path).toBe('.');
  });
});
