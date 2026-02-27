// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

import { HookInstaller } from '@main/hook-installer';

describe('HookInstaller', () => {
  let installer: HookInstaller;

  beforeEach(() => {
    vi.clearAllMocks();
    installer = new HookInstaller('D:\\dev\\ClaudeTerminal\\src\\hooks');
  });

  it('writes settings.local.json to target directory', () => {
    installer.install('D:\\dev\\MyApp', 'tab-1');

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
    installer.install('D:\\dev\\MyApp', 'tab-1');

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

  it('includes tab ID in hook commands', () => {
    installer.install('D:\\dev\\MyApp', 'tab-42');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const content = writeCall[1] as string;
    expect(content).toContain('tab-42');
  });
});
