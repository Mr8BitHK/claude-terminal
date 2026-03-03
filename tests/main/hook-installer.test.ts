// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

import { HookInstaller } from '@main/hook-installer';

describe('HookInstaller', () => {
  let installer: HookInstaller;

  beforeEach(() => {
    vi.clearAllMocks();
    installer = new HookInstaller('D:\\dev\\ClaudeTerminal\\src\\hooks');
  });

  it('writes settings.local.json to target directory', () => {
    installer.install('D:\\dev\\MyApp');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude'),
      expect.anything(),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('settings.local.json'),
      expect.any(String),
      'utf-8',
    );
  });

  it('generates valid JSON with all required hooks', () => {
    installer.install('D:\\dev\\MyApp');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const content = JSON.parse(writeCall[1] as string);

    expect(content.hooks).toBeDefined();
    expect(content.hooks.SessionStart).toBeDefined();
    expect(content.hooks.UserPromptSubmit).toBeDefined();
    expect(content.hooks.PreToolUse).toBeDefined();
    expect(content.hooks.Stop).toBeDefined();
    expect(content.hooks.Notification).toBeDefined();
    expect(content.hooks.SessionEnd).toBeDefined();
  });

  it('uses node commands for hook scripts', () => {
    installer.install('D:\\dev\\MyApp');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('node');
    expect(content).toContain('.js');
  });

  describe('install with existing settings.local.json', () => {
    const hooksDir = 'D:\\dev\\ClaudeTerminal\\src\\hooks';

    it('preserves non-ClaudeTerminal hooks in existing settings.local.json', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            { matcher: '', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 5 }] },
          ],
        },
        someOtherSetting: true,
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

      installer.install('/target');

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written.hooks.SessionStart).toHaveLength(2);
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
      expect(written.someOtherSetting).toBe(true);
    });

    it('replaces existing ClaudeTerminal hooks on re-install', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
          ],
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

      installer.install('/target');

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written.hooks.SessionStart).toHaveLength(1);
    });
  });

  describe('uninstall', () => {
    const hooksDir = 'D:\\dev\\ClaudeTerminal\\src\\hooks';

    it('removes only ClaudeTerminal hooks and preserves user hooks', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            { matcher: '', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 5 }] },
            { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
          ],
        },
        someOtherSetting: true,
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

      installer.uninstall('/target');

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
      expect(written.someOtherSetting).toBe(true);
    });

    it('deletes settings.local.json if only ClaudeTerminal hooks remain', () => {
      const existingSettings = {
        hooks: {
          SessionStart: [
            { matcher: '', hooks: [{ type: 'command', command: `node "${hooksDir}/on-session-start.js"`, timeout: 10 }] },
          ],
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));

      installer.uninstall('/target');

      expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalled();
    });

    it('does nothing if settings.local.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      installer.uninstall('/target');

      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.unlinkSync)).not.toHaveBeenCalled();
    });
  });
});
