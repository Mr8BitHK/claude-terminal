import fs from 'fs';
import path from 'path';
import { PIPE_NAME } from '@shared/types';

export class HookInstaller {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

  install(targetDir: string, tabId: string): void {
    const claudeDir = path.join(targetDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    const hookCommand = (scriptName: string) =>
      `bash "${path.join(this.hooksDir, scriptName)}" "${tabId}" "${PIPE_NAME}"`;

    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: hookCommand('on-session-start.sh'), timeout: 10 }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-prompt-submit.sh'), timeout: 10 }],
          },
        ],
        PreToolUse: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-tool-use.sh'), timeout: 10 }],
          },
        ],
        Stop: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-stop.sh'), timeout: 10 }],
          },
        ],
        Notification: [
          {
            matcher: 'idle_prompt',
            hooks: [
              { type: 'command', command: hookCommand('on-notification.sh'), timeout: 10 },
            ],
          },
        ],
        SessionEnd: [
          {
            hooks: [{ type: 'command', command: hookCommand('on-session-end.sh'), timeout: 10 }],
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
