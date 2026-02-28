import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { log } from './logger';

// Types re-declared here to avoid import issues with cloudflared's .d.ts
interface CloudflaredConnection {
  id: string;
  ip: string;
  location: string;
}

export interface TunnelManagerEvents {
  url: (url: string) => void;
  connected: (connection: CloudflaredConnection) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
}

/**
 * Manages a Cloudflare Quick Tunnel lifecycle.
 *
 * Wraps the `cloudflared` npm package to create an ephemeral tunnel
 * that proxies external HTTPS traffic to a local port.
 */
export class TunnelManager extends EventEmitter {
  private _url: string | null = null;
  private _active = false;
  private tunnel: ReturnType<typeof import('cloudflared')['Tunnel']['quick']> | null = null;

  /** Current tunnel URL, or null if not connected. */
  get url(): string | null {
    return this._url;
  }

  /** Whether the tunnel is currently connected. */
  get isActive(): boolean {
    return this._active;
  }

  /**
   * Start a quick tunnel pointing to the given local port.
   * Installs the cloudflared binary automatically if it is missing.
   */
  async start(localPort: number): Promise<void> {
    if (this.tunnel) {
      log.warn('[tunnel] already running — stop first');
      return;
    }

    // The cloudflared package is CJS; import it normally.
    const { bin, install, Tunnel } = await import('cloudflared');

    // Auto-install the binary if it doesn't exist yet.
    if (!fs.existsSync(bin)) {
      log.info('[tunnel] cloudflared binary not found, installing…');
      try {
        await install(bin);
        log.info('[tunnel] cloudflared binary installed');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error('[tunnel] failed to install cloudflared:', error.message);
        this.emit('error', error);
        return;
      }
    }

    log.info(`[tunnel] starting quick tunnel → localhost:${localPort}`);

    const t = Tunnel.quick(`http://localhost:${localPort}`);
    this.tunnel = t;

    t.on('url', (url: string) => {
      this._url = url;
      this._active = true;
      log.info(`[tunnel] url: ${url}`);
      this.emit('url', url);
    });

    t.on('connected', (conn: CloudflaredConnection) => {
      log.info(`[tunnel] connected via ${conn.location} (${conn.ip})`);
      this.emit('connected', conn);
    });

    t.on('error', (err: Error) => {
      log.error('[tunnel] error:', err.message);
      this.emit('error', err);
    });

    t.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      log.info(`[tunnel] exited code=${code} signal=${signal}`);
      this._url = null;
      this._active = false;
      this.tunnel = null;
      this.emit('exit', code, signal);
    });
  }

  /** Stop the tunnel and reset state. */
  stop(): void {
    if (this.tunnel) {
      log.info('[tunnel] stopping');
      // cloudflared's .stop() sends SIGINT which is a no-op on Windows.
      // Kill the child process directly instead.
      const child = this.tunnel.process;
      if (child && !child.killed) {
        child.kill();
      }
      // State is cleaned up in the 'exit' handler above.
    }
  }

  // Typed event helpers
  on<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.on(event, listener);
  }
  once<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.once(event, listener);
  }
  off<E extends keyof TunnelManagerEvents>(event: E, listener: TunnelManagerEvents[E]): this {
    return super.off(event, listener);
  }
  emit<E extends keyof TunnelManagerEvents>(event: E, ...args: Parameters<TunnelManagerEvents[E]>): boolean {
    return super.emit(event, ...args);
  }
}
