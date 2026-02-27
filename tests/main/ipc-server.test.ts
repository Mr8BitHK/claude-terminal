import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { HookIpcServer } from '@main/ipc-server';
import { IpcMessage } from '@shared/types';

describe('HookIpcServer', () => {
  let server: HookIpcServer;
  const TEST_PIPE = '\\\\.\\pipe\\claude-terminal-test-' + process.pid;

  beforeEach(() => {
    server = new HookIpcServer(TEST_PIPE);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts and accepts connections', async () => {
    await server.start();
    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));
    client.destroy();
  });

  it('parses incoming IPC messages', async () => {
    await server.start();
    const received: IpcMessage[] = [];
    server.onMessage((msg) => received.push(msg));

    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));

    const msg: IpcMessage = { tabId: 'tab-1', event: 'tab:status:working', data: null };
    client.write(JSON.stringify(msg) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    expect(received[0].tabId).toBe('tab-1');
    expect(received[0].event).toBe('tab:status:working');
    client.destroy();
  });

  it('handles multiple messages on same connection', async () => {
    await server.start();
    const received: IpcMessage[] = [];
    server.onMessage((msg) => received.push(msg));

    const client = net.createConnection(TEST_PIPE);
    await new Promise<void>((resolve) => client.on('connect', resolve));

    client.write(JSON.stringify({ tabId: 't1', event: 'e1', data: null }) + '\n');
    client.write(JSON.stringify({ tabId: 't2', event: 'e2', data: 'hello' }) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(2);
    client.destroy();
  });
});
