import net from 'net';
import { IpcMessage } from '@shared/types';

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
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line) as IpcMessage;
              this.handlers.forEach((h) => h(msg));
            } catch {
              // ignore malformed messages
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
