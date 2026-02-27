import type { Tab, TabStatus } from './types';

const STATUS_LABELS: [TabStatus, string][] = [
  ['new', 'New'],
  ['working', 'Working'],
  ['idle', 'Idle'],
  ['requires_response', 'Input'],
];

export function buildWindowTitle(workspaceDir: string | null, tabs: Tab[]): string {
  const base = workspaceDir ? `ClaudeTerminal - ${workspaceDir}` : 'ClaudeTerminal';

  if (tabs.length === 0) return base;

  const parts: string[] = [];
  for (const [status, label] of STATUS_LABELS) {
    const count = tabs.filter((t) => t.status === status).length;
    if (count > 0) parts.push(`${count} ${label}`);
  }

  if (parts.length === 0) return base;
  return `${base} [${parts.join(', ')}]`;
}
