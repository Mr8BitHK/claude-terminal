import type { Tab } from './types';

export function buildWindowTitle(workspaceDir: string | null, tabs: Tab[]): string {
  const base = workspaceDir ? `ClaudeTerminal - ${workspaceDir}` : 'ClaudeTerminal';

  if (tabs.length === 0) return base;

  const hasInput = tabs.some((t) => t.status === 'requires_response');
  const hasWorking = tabs.some((t) => t.status === 'working');

  const label = hasInput ? 'Needs Attention' : hasWorking ? 'Busy' : 'Idle';
  return `${base} [${label}]`;
}
