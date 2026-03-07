export interface ShellOption {
  id: string;
  label: string;
  command: string;
  args: string[];
  defaultName: string;
  icon: 'terminal' | 'penguin';
}

/** All possible shell options for a platform (may not all be installed). */
export function getAllShellOptions(platform: string): ShellOption[] {
  switch (platform) {
    case 'win32':
      return [
        { id: 'powershell', label: 'PowerShell', command: 'powershell.exe', args: [], defaultName: 'PowerShell', icon: 'terminal' },
        { id: 'wsl', label: 'WSL', command: 'wsl.exe', args: [], defaultName: 'WSL', icon: 'penguin' },
        { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', args: [], defaultName: 'CMD', icon: 'terminal' },
      ];
    case 'darwin':
      return [
        { id: 'zsh', label: 'Zsh', command: '/bin/zsh', args: [], defaultName: 'Zsh', icon: 'terminal' },
        { id: 'bash', label: 'Bash', command: '/bin/bash', args: [], defaultName: 'Bash', icon: 'terminal' },
      ];
    default: // linux, freebsd, etc.
      return [
        { id: 'bash', label: 'Bash', command: '/bin/bash', args: [], defaultName: 'Bash', icon: 'terminal' },
        { id: 'zsh', label: 'Zsh', command: '/usr/bin/zsh', args: [], defaultName: 'Zsh', icon: 'terminal' },
        { id: 'fish', label: 'Fish', command: '/usr/bin/fish', args: [], defaultName: 'Fish', icon: 'terminal' },
      ];
  }
}

export function getShellOption(platform: string, shellId: string): ShellOption | undefined {
  return getAllShellOptions(platform).find(s => s.id === shellId);
}
