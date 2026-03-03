import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { getClaudeCommand } from '@shared/claude-cli';
import { log } from './logger';
import type { TabManager } from './tab-manager';

export interface TabNamerDeps {
  tabManager: TabManager;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  persistSessions: () => void;
}

export function createTabNamer(deps: TabNamerDeps) {
  function cleanupNamingFlag(tabId: string) {
    const flagFile = path.join(os.tmpdir(), `claude-terminal-named-${tabId}`);
    try { fs.unlinkSync(flagFile); } catch { /* best-effort */ }
  }

  // Queue to serialize Haiku calls — concurrent claude -p invocations get rate-limited
  let namingQueue = Promise.resolve();

  /** Send a prompt to Haiku and apply the result as the tab name. Calls are serialized. */
  function callHaikuForName(tabId: string, prompt: string) {
    namingQueue = namingQueue.then(() => new Promise<void>((resolve) => {
      const { command: cmd, args: baseArgs } = getClaudeCommand([
        '-p', '--no-session-persistence', '--model', 'claude-haiku-4-5-20251001',
      ]);

      log.debug('[callHaikuForName] spawning:', cmd, baseArgs.join(' '));
      const isWindows = process.platform === 'win32';
      const child = execFile(cmd, baseArgs, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          log.error('[callHaikuForName] FAILED:', err.message);
          log.error('[callHaikuForName] stderr:', stderr);
          log.error('[callHaikuForName] stdout:', stdout);
          if (child.pid) {
            if (isWindows) {
              try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* best effort */ }
            } else {
              child.kill('SIGKILL');
            }
          }
          resolve();
          return;
        }
        log.debug('[callHaikuForName] stdout:', JSON.stringify(stdout));

        const name = stdout.trim().replace(/^["']|["']$/g, '').substring(0, 50);
        if (name) {
          const tab = deps.tabManager.getTab(tabId);
          if (tab) {
            deps.tabManager.rename(tabId, name);
            const updated = deps.tabManager.getTab(tabId);
            if (updated) {
              deps.sendToRenderer('tab:updated', updated);
              deps.persistSessions();
            }
          }
        }
        resolve();
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    }));
  }

  function generateTabName(tabId: string, prompt: string) {
    log.debug('[generateTabName] starting for tab', tabId, 'prompt:', prompt.substring(0, 80));
    const namePrompt = `Generate a short tab title (3-5 words) for a coding conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation:\n\n${prompt}`;
    callHaikuForName(tabId, namePrompt);
  }

  /**
   * Encode a cwd path to Claude's project directory name format.
   * e.g. "D:\dev\claude-terminal" → "D--dev-claude-terminal"
   */
  function encodeProjectDir(cwd: string): string {
    // Two passes: the single-regex /[:\\/\.]/ has a known V8 parsing quirk
    // where \\ inside [...] is treated as \/ (escaped slash) rather than
    // \\ (escaped backslash), so backslashes were silently not replaced.
    return cwd.replace(/\\/g, '-').replace(/[:/\.]/g, '-');
  }

  /**
   * Read user prompts from a Claude session JSONL file.
   * Returns the first prompt + last 2 prompts (deduplicated).
   */
  async function readSessionPrompts(sessionFile: string): Promise<string[]> {
    const prompts: string[] = [];
    const stream = fs.createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.message?.content) {
          const rawContent = entry.message.content;
          let text: string;
          if (typeof rawContent === 'string') {
            text = rawContent;
          } else if (Array.isArray(rawContent)) {
            // Extract only text blocks; skip entries that are purely tool results
            const textParts = (rawContent as Array<{ type: string; text?: string }>)
              .filter(item => item.type === 'text')
              .map(item => item.text ?? '');
            if (textParts.length === 0) continue;
            text = textParts.join('\n');
          } else {
            continue;
          }
          // Skip meta/command messages
          if (!entry.isMeta && !text.startsWith('<command-name>')) {
            prompts.push(text);
          }
        }
      } catch { /* skip malformed lines */ }
    }

    if (prompts.length === 0) return [];

    // First prompt + last 2 (deduplicated)
    const first = prompts[0];
    const lastTwo = prompts.slice(-2);
    const result = [first];
    for (const p of lastTwo) {
      if (p !== first) result.push(p);
    }
    return result;
  }

  /**
   * Generate a tab name for a resumed session by reading the session JSONL
   * and summarizing the conversation via Haiku.
   */
  async function generateResumeTabName(tabId: string, cwd: string, sessionId: string) {
    log.info('[generateResumeTabName] starting for tab', tabId, 'session:', sessionId);

    const projectDir = encodeProjectDir(cwd);
    const sessionFile = path.join(os.homedir(), '.claude', 'projects', projectDir, `${sessionId}.jsonl`);

    if (!fs.existsSync(sessionFile)) {
      log.warn('[generateResumeTabName] session file not found:', sessionFile);
      return;
    }

    try {
      const prompts = await readSessionPrompts(sessionFile);
      if (prompts.length === 0) {
        log.warn('[generateResumeTabName] no user prompts found in session');
        return;
      }

      const combined = prompts.map((p, i) => `[Message ${i + 1}]: ${p.substring(0, 500)}`).join('\n\n');
      const namePrompt = `Generate a short tab title (3-5 words) summarizing this coding conversation. Reply with ONLY the title, no quotes, no punctuation:\n\n${combined}`;

      callHaikuForName(tabId, namePrompt);
    } catch (err) {
      log.error('[generateResumeTabName] failed to read session:', (err as Error).message);
    }
  }

  return { generateTabName, generateResumeTabName, cleanupNamingFlag };
}
