// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { execFile } from 'child_process';
import path from 'path';
import { IpcMessage } from '@shared/types';

function execNodeScript(scriptPath: string, args: string[], env: Record<string, string>, timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('node', [scriptPath, ...args], {
      timeout,
      env: { ...process.env, ...env },
    }, (err, stdout) => {
      if (err && err.killed) {
        reject(new Error(`Command timed out: node ${scriptPath}`));
      } else if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

describe('hook scripts integration', () => {
  const TEST_PIPE = '//./pipe/claude-terminal-hook-test-' + process.pid;
  let server: net.Server;
  let received: IpcMessage[];

  beforeEach(async () => {
    received = [];
    server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { received.push(JSON.parse(line)); } catch {}
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(TEST_PIPE, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('pipe-send.js sends valid IPC message via env vars', async () => {
    const scriptPath = path.resolve('src/hooks/pipe-send.js');
    await execNodeScript(scriptPath, ['tab:status:working'], {
      CLAUDE_TERMINAL_TAB_ID: 'tab-1',
      CLAUDE_TERMINAL_PIPE: TEST_PIPE,
    });

    // Give the message time to arrive
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].tabId).toBe('tab-1');
    expect(received[0].event).toBe('tab:status:working');
  });
});
