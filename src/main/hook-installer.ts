import fs from 'node:fs';
import path from 'node:path';

export class HookInstaller {
  private hooksDir: string;

  constructor(hooksDir: string) {
    this.hooksDir = hooksDir;
  }

  /** Check if a hook entry was installed by ClaudeTerminal (any version) */
  private isOurHook(entry: any): boolean {
    return entry?.hooks?.some((h: any) => {
      if (typeof h.command !== 'string') return false;
      // Match current hooksDir, or known ClaudeTerminal packaged paths.
      // Windows: ...\ClaudeTerminal\app-1.4.1\resources\hooks\on-stop.js
      // Linux (correct): .../claude-terminal/resources/hooks/on-stop.js
      // Linux (broken, pre-fix): /usr/lib/hooks/on-stop.js
      // All our hooks use: node "<path>/on-<event>.js"
      return (
        h.command.includes(this.hooksDir) ||
        /ClaudeTerminal[\\/]app-[\d.]+[\\/]resources[\\/]hooks[\\/]/.test(h.command) ||
        /claude-terminal[\\/]resources[\\/]hooks[\\/]/.test(h.command) ||
        /^node ".*[\\/]hooks[\\/]on-(?:session-start|prompt-submit|tool-use|stop|notification|session-end)\.js"$/.test(h.command)
      );
    }) ?? false;
  }

  /** Read existing settings.local.json or return empty object */
  private readExisting(targetDir: string): any {
    const filePath = path.join(targetDir, '.claude', 'settings.local.json');
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  install(targetDir: string): void {
    const claudeDir = path.join(targetDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // Hook scripts read CLAUDE_TERMINAL_TAB_ID and CLAUDE_TERMINAL_PIPE
    // from environment variables (set on the PTY process) to avoid
    // Windows cmd.exe backslash mangling in CLI arguments.
    const hookCommand = (scriptName: string) =>
      `node "${path.join(this.hooksDir, scriptName)}"`;

    const ourHooks: Record<string, any[]> = {
      SessionStart: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-session-start.js'), timeout: 10 }] },
      ],
      UserPromptSubmit: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-prompt-submit.js'), timeout: 10 }] },
      ],
      PreToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-tool-use.js'), timeout: 10 }] },
      ],
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-stop.js'), timeout: 10 }] },
      ],
      Notification: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-notification.js'), timeout: 10 }] },
      ],
      SessionEnd: [
        { matcher: '', hooks: [{ type: 'command', command: hookCommand('on-session-end.js'), timeout: 10 }] },
      ],
    };

    // Read existing, remove our old hooks, merge in new ones
    const existing = this.readExisting(targetDir);
    const mergedHooks: Record<string, any[]> = { ...(existing.hooks ?? {}) };

    for (const [event, entries] of Object.entries(ourHooks)) {
      const existingEntries = mergedHooks[event] ?? [];
      const userEntries = existingEntries.filter((e: any) => !this.isOurHook(e));
      mergedHooks[event] = [...userEntries, ...entries];
    }

    const settings = { ...existing, hooks: mergedHooks };

    fs.writeFileSync(
      path.join(claudeDir, 'settings.local.json'),
      JSON.stringify(settings, null, 2),
      'utf-8',
    );
  }

  uninstall(targetDir: string): void {
    const filePath = path.join(targetDir, '.claude', 'settings.local.json');
    if (!fs.existsSync(filePath)) return;

    const existing = this.readExisting(targetDir);
    const hooks: Record<string, any[]> = existing.hooks ?? {};

    // Remove our hooks from each event
    for (const event of Object.keys(hooks)) {
      hooks[event] = hooks[event].filter((e: any) => !this.isOurHook(e));
      if (hooks[event].length === 0) {
        delete hooks[event];
      }
    }

    // If nothing left besides empty hooks, delete the file
    const remaining = { ...existing, hooks };
    if (Object.keys(remaining.hooks).length === 0) {
      delete remaining.hooks;
    }
    if (Object.keys(remaining).length === 0) {
      fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(remaining, null, 2), 'utf-8');
    }
  }
}
