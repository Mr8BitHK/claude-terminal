import { buildWindowTitle } from '@shared/window-title';
import type { Tab } from '@shared/types';

const makeTab = (status: Tab['status']): Tab => ({
  id: `tab-${Math.random()}`,
  type: 'claude',
  name: 'Tab',
  defaultName: 'Tab',
  status,
  worktree: null,
  cwd: '/test',
  shellType: null,
  pid: null,
  sessionId: null,
  projectId: '',
});

describe('buildWindowTitle', () => {
  it('shows base title with no tabs', () => {
    expect(buildWindowTitle('D:\\dev', [])).toBe('ClaudeTerminal - D:\\dev');
  });

  it('shows Busy for working tabs', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [Busy]');
  });

  it('shows Needs Attention when any tab requires response', () => {
    const tabs = [makeTab('working'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [Needs Attention]');
  });

  it('shows Idle when all tabs are idle', () => {
    const tabs = [makeTab('idle'), makeTab('idle')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [Idle]');
  });

  it('shows Idle for new tabs', () => {
    const tabs = [makeTab('new')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [Idle]');
  });

  it('shows Needs Attention when requires_response is present among all states', () => {
    const tabs = [makeTab('new'), makeTab('working'), makeTab('idle'), makeTab('requires_response')];
    expect(buildWindowTitle('D:\\dev', tabs)).toBe('ClaudeTerminal - D:\\dev [Needs Attention]');
  });

  it('uses fallback title when no workspace dir', () => {
    expect(buildWindowTitle(null, [])).toBe('ClaudeTerminal');
  });

  it('uses fallback title with tabs but no workspace dir', () => {
    const tabs = [makeTab('working')];
    expect(buildWindowTitle(null, tabs)).toBe('ClaudeTerminal [Busy]');
  });
});
