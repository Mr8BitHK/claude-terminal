import { buildWindowTitle } from '@shared/window-title';
import type { Tab } from '@shared/types';

const makeTab = (status: Tab['status']): Tab => ({
  id: `tab-${Math.random()}`,
  name: 'Tab',
  defaultName: 'Tab',
  status,
  worktree: null,
  cwd: '/test',
  pid: null,
  sessionId: null,
});

describe('buildWindowTitle', () => {
  it('shows base title with no tabs', () => {
    expect(buildWindowTitle('D:\\dev', [])).toBe('ClaudeTerminal - D:\\dev');
  });

  it('shows single working tab', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 Working]');
  });

  it('shows multiple states, hides zero counts', () => {
    const tabs = [makeTab('working'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [2 Working, 1 Idle, 1 Input]');
  });

  it('hides states with zero count', () => {
    const tabs = [makeTab('idle'), makeTab('idle')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [2 Idle]');
  });

  it('shows New state', () => {
    const tabs = [makeTab('new')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 New]');
  });

  it('shows all four states when all present', () => {
    const tabs = [makeTab('new'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [1 New, 1 Working, 1 Idle, 1 Input]');
  });

  it('uses fallback title when no workspace dir', () => {
    expect(buildWindowTitle(null, [])).toBe('ClaudeTerminal');
  });

  it('uses fallback title with tabs but no workspace dir', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle(null, tabs)).toBe('ClaudeTerminal [1 Working]');
  });
});
