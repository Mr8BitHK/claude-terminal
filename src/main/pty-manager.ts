import { exec } from 'node:child_process';
import * as pty from 'node-pty';

interface ManagedPty {
  process: pty.IPty;
  tabId: string;
}

export class PtyManager {
  private ptys = new Map<string, ManagedPty>();

  spawn(
    tabId: string,
    cwd: string,
    args: string[],
    extraEnv: Record<string, string>,
  ): pty.IPty {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...extraEnv }).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;

    // On Windows, `claude` is a .cmd wrapper. node-pty can't resolve .cmd
    // files directly, so we spawn through the system shell.
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'claude';
    const spawnArgs = isWindows ? ['/c', 'claude', ...args] : args;

    const proc = pty.spawn(shell, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env,
    });

    this.ptys.set(tabId, { process: proc, tabId });
    return proc;
  }

  spawnShell(
    tabId: string,
    cwd: string,
    shellType: 'powershell' | 'wsl',
  ): pty.IPty {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;

    const shell = shellType === 'powershell' ? 'powershell.exe' : 'wsl.exe';

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env,
    });

    this.ptys.set(tabId, { process: proc, tabId });
    return proc;
  }

  write(tabId: string, data: string): void {
    this.ptys.get(tabId)?.process.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.ptys.get(tabId)?.process.resize(cols, rows);
  }

  kill(tabId: string): void {
    const managed = this.ptys.get(tabId);
    if (!managed) return;
    this.ptys.delete(tabId);

    // IMPORTANT: Do NOT call managed.process.kill() on Windows.
    // node-pty's ConPTY kill() uses child_process.fork() which spawns
    // process.execPath (= ClaudeTerminal.exe in production) to run its
    // conpty_console_list_agent helper, launching a second app instance.
    // Instead, use taskkill to kill the entire process tree directly.
    const pid = managed.process.pid;
    if (process.platform === 'win32') {
      // Fire-and-forget: don't block the main process while taskkill runs
      exec(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' } as any);
    } else {
      try { managed.process.kill(); } catch { /* already dead */ }
    }
  }

  killAll(): void {
    for (const tabId of this.ptys.keys()) {
      this.kill(tabId);
    }
  }
}
