import type { Tab } from './types';

declare const __APP_VERSION__: string;

export function buildWindowTitle(workspaceDir: string | null, tabs: Tab[], branch?: string | null): string {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
  const name = version ? `ClaudeTerminal v${version}` : 'ClaudeTerminal';
  let base = workspaceDir ? `${name} - ${workspaceDir}` : name;
  if (branch) base += ` (${branch})`;

  if (tabs.length === 0) return base;

  const hasInput = tabs.some((t) => t.status === 'requires_response');
  const hasWorking = tabs.some((t) => t.status === 'working');

  const label = hasInput ? 'Needs Attention' : hasWorking ? 'Busy' : 'Idle';
  return `${base} [${label}]`;
}
