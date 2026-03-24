export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response' | 'shell';

export type TabType = 'claude' | 'shell';

export type PermissionMode = 'default' | 'auto' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface Tab {
  id: string;
  type: TabType;
  name: string;
  defaultName: string;
  status: TabStatus;
  worktree: string | null;
  /** The branch this worktree was created from (e.g. "main", "gcai"). */
  sourceBranch: string | null;
  cwd: string;
  shellType: string | null;
  pid: number | null;
  sessionId: string | null;
  projectId: string;
}

export interface SavedTab {
  name: string;
  cwd: string;
  worktree: string | null;
  sourceBranch: string | null;
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

// --- Multi-project workspaces ---

export const PROJECT_COLORS = [
  { name: 'blue',   hue: 210 },
  { name: 'green',  hue: 140 },
  { name: 'orange', hue: 30  },
  { name: 'purple', hue: 270 },
  { name: 'teal',   hue: 180 },
  { name: 'red',    hue: 0   },
  { name: 'pink',   hue: 330 },
  { name: 'yellow', hue: 55  },
] as const;

export interface ProjectConfig {
  id: string;
  dir: string;
  colorIndex: number;
  displayName?: string;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  projects: ProjectConfig[];
  activeProjectId: string;
  geometry: { x: number; y: number; width: number; height: number };
}

export const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  auto: ['--enable-auto-mode'],
  plan: ['--plan'],
  acceptEdits: ['--allowedTools', 'Edit,Write,NotebookEdit'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};

// Remote access
export type RemoteAccessStatus = 'inactive' | 'installing' | 'connecting' | 'active' | 'error';

export interface RemoteAccessInfo {
  status: RemoteAccessStatus;
  tunnelUrl: string | null;
  token: string | null;
  error: string | null;
  /** Download progress 0–100 (only meaningful when status === 'installing'). */
  progress?: number;
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
