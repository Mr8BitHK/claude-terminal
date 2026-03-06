import { TabStatus, Tab, IpcMessage, PermissionMode, HOOK_EVENTS, PROJECT_COLORS } from '@shared/types';
import type { RepoHookConfig, RepoHook, HookCommand, HookEvent, ProjectConfig, WorkspaceConfig } from '@shared/types';

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
      shellType: null,
      pid: null,
      sessionId: null,
      projectId: 'proj-1',
    };
    expect(tab.id).toBe('tab-1');
    expect(tab.worktree).toBeNull();
    expect(tab.projectId).toBe('proj-1');
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

describe('Project types', () => {
  it('PROJECT_COLORS has at least 8 colors', () => {
    expect(PROJECT_COLORS.length).toBeGreaterThanOrEqual(8);
  });

  it('ProjectConfig has required fields', () => {
    const config: ProjectConfig = { id: 'p1', dir: '/test/repo', colorIndex: 0 };
    expect(config.id).toBe('p1');
    expect(config.dir).toBe('/test/repo');
    expect(config.colorIndex).toBe(0);
  });

  it('WorkspaceConfig has required fields', () => {
    const ws: WorkspaceConfig = {
      id: 'ws-1',
      name: 'My Workspace',
      projects: [{ id: 'p1', dir: '/test/repo', colorIndex: 0 }],
      activeProjectId: 'p1',
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
    };
    expect(ws.projects).toHaveLength(1);
    expect(ws.activeProjectId).toBe('p1');
  });
});
