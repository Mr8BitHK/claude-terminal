import net from 'node:net';
import { IpcMessage } from '@shared/types';
import { log } from './logger';

type MessageHandler = (msg: IpcMessage) => void;

export class HookIpcServer {
  private server: net.Server | null = null;
  private sockets: Set<net.Socket> = new Set();
  private handlers: MessageHandler[] = [];
  private pipePath: string;

  constructor(pipePath: string) {
    this.pipePath = pipePath;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        let buffer = '';
        socket.on('error', (err) => {
          log.warn('[ipc-socket-error]', err.message);
        });
        socket.on('data', (chunk) => {
          buffer += chunk.toString();
          log.debug('[ipc-raw]', chunk.toString().substring(0, 200));
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as IpcMessage;
              this.handlers.forEach((h) => h(msg));
            } catch {
              log.warn('[ipc-parse-error]', line.substring(0, 200));
            }
          }
        });
      });
      this.server.on('error', reject);
      this.server.listen(this.pipePath, () => resolve());
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
