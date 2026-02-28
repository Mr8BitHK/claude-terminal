export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response' | 'shell';

export type TabType = 'claude' | 'powershell' | 'wsl';

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface Tab {
  id: string;
  type: TabType;
  name: string;
  defaultName: string;
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

export const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};

// Remote access
export type RemoteAccessStatus = 'inactive' | 'connecting' | 'active' | 'error';

export interface RemoteAccessInfo {
  status: RemoteAccessStatus;
  tunnelUrl: string | null;
  token: string | null;
  error: string | null;
}

// --- Repository hooks ---

export const HOOK_EVENTS = [
  'worktree:created',
  'worktree:removed',
  'tab:created',
  'tab:closed',
  'session:started',
  'app:started',
  'branch:changed',
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

export interface HookCommand {
  path: string;
  command: string;
}

export interface RepoHook {
  id: string;
  name: string;
  event: HookEvent;
  commands: HookCommand[];
  enabled: boolean;
}

export interface RepoHookConfig {
  hooks: RepoHook[];
}

// IPC status events for hook execution
export interface HookExecutionStatus {
  hookId: string;
  hookName: string;
  event: HookEvent;
  commandIndex: number;
  totalCommands: number;
  command?: string;
  path?: string;
  status: 'running' | 'done' | 'failed';
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}
