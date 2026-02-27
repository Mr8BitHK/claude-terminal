export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response';

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface Tab {
  id: string;
  name: string;
  status: TabStatus;
  worktree: string | null;
  cwd: string;
  pid: number | null;
  sessionId: string | null;
}

export interface SavedTab {
  name: string;
  cwd: string;
  worktree: string | null;
  sessionId: string;
}

export interface IpcMessage {
  tabId: string;
  event: string;
  data: string | null;
}

export interface AppSettings {
  recentDirs: string[];
  lastPermissionMode: PermissionMode;
}

export const PIPE_NAME = '\\\\.\\pipe\\claude-terminal';

export const STATUS_INDICATORS: Record<TabStatus, string> = {
  new: '●',
  working: '◉',
  requires_response: '◈',
  idle: '○',
};

export const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};
