import fs from 'fs';
import path from 'path';

export class HookInstaller {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

  install(targetDir: string): void {
    const claudeDir = path.join(targetDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // Hook scripts read CLAUDE_TERMINAL_TAB_ID and CLAUDE_TERMINAL_PIPE
    // from environment variables (set on the PTY process) to avoid
    // Windows cmd.exe backslash mangling in CLI arguments.
    const hookCommand = (scriptName: string) =>
      `node "${path.join(this.hooksDir, scriptName)}"`;

    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-session-start.js'), timeout: 10 }],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-prompt-submit.js'), timeout: 10 }],
          },
        ],
        PreToolUse: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-tool-use.js'), timeout: 10 }],
          },
        ],
        Stop: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-stop.js'), timeout: 10 }],
          },
        ],
        Notification: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-notification.js'), timeout: 10 }],
          },
        ],
        SessionEnd: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: hookCommand('on-session-end.js'), timeout: 10 }],
          },
        ],
      },
    };

    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  }
}
