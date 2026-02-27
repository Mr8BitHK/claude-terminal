import net from 'net';
import { IpcMessage } from '@shared/types';
import { log } from './logger';

type MessageHandler = (msg: IpcMessage) => void;

export class HookIpcServer {
  private server: net.Server | null = null;
  private handlers: MessageHandler[] = [];
  private pipePath: string;

  constructor(pipePath: string) {
    this.pipePath = pipePath;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';
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
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
