import path from 'path';
import spawn from 'cross-spawn';
import treeKill from 'tree-kill';
import type { HookConfigStore } from './hook-config-store';
import type { HookEvent, HookExecutionStatus } from '@shared/types';
import { log } from './logger';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface HookContext {
  contextRoot: string;
  [key: string]: string;
}

type StatusCallback = (status: HookExecutionStatus) => void;

export class HookEngine {
  private store: HookConfigStore;
  private onStatus: StatusCallback;

  constructor(store: HookConfigStore, onStatus: StatusCallback) {
    this.store = store;
    this.onStatus = onStatus;
  }

  async emit(event: HookEvent, context: HookContext): Promise<void> {
    const hooks = this.store.getHooksForEvent(event);
    if (hooks.length === 0) return;

    log.info('[hook-engine] firing', event, '— matched', hooks.length, 'hook(s)');

    for (const hook of hooks) {
      for (let i = 0; i < hook.commands.length; i++) {
        const cmd = hook.commands[i];
        const cwd = path.resolve(context.contextRoot, cmd.path);

        this.onStatus({
          hookId: hook.id,
          hookName: hook.name,
          event,
          commandIndex: i,
          totalCommands: hook.commands.length,
          command: cmd.command,
          path: cmd.path,
          status: 'running',
        });

        const result = await this.runCommand(cmd.command, cwd, context);

        if (result.exitCode !== 0) {
          this.onStatus({
            hookId: hook.id,
            hookName: hook.name,
            event,
            commandIndex: i,
            totalCommands: hook.commands.length,
            command: cmd.command,
            path: cmd.path,
            status: 'failed',
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          });
          log.warn('[hook-engine]', hook.name, 'command', i, 'failed with exit code', result.exitCode);
          break; // skip remaining commands in this hook
        }

        this.onStatus({
          hookId: hook.id,
          hookName: hook.name,
          event,
          commandIndex: i,
          totalCommands: hook.commands.length,
          command: cmd.command,
          path: cmd.path,
          status: 'done',
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
    }
  }

  private runCommand(
    command: string,
    cwd: string,
    context: HookContext,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; error?: string }> {
    return new Promise((resolve) => {
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
      };
      // Add all context keys as HOOK_ prefixed env vars
      for (const [key, value] of Object.entries(context)) {
        if (key !== 'contextRoot') {
          env[`HOOK_${key.toUpperCase()}`] = value;
        }
      }

      let child;
      try {
        child = spawn(command, [], { shell: true, cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ exitCode: 1, stdout: '', stderr: '', error: String(err) });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const MAX_OUTPUT_BYTES = 256 * 1024;

      child.stdout?.on('data', (chunk: Buffer) => {
        if (!settled && stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString();
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (!settled && stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString();
        }
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (child.pid) {
          treeKill(child.pid, 'SIGTERM', () => {});
        }
        resolve({ exitCode: null, stdout, stderr, error: 'Command timed out' });
      }, DEFAULT_TIMEOUT_MS);

      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: 1, stdout, stderr, error: err.message });
      });

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  }
}
