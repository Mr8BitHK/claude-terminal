import { execFile, spawn, ExecFileOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function execFileAsync(
  cmd: string,
  args: string[],
  opts: ExecFileOptions & { encoding: 'utf-8' },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface WorktreeDetails {
  name: string;
  path: string;
  clean: boolean;
  changesCount: number;
  /** The branch this worktree was created from. */
  sourceBranch: string | null;
}

export class WorktreeManager {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async getCurrentBranch(): Promise<string> {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    return stdout.trim();
  }

  async create(name: string): Promise<{ path: string; sourceBranch: string }> {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    const branch = await this.getCurrentBranch();
    await execFileAsync(
      'git',
      ['worktree', 'add', worktreePath, '-b', name, branch],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    // Store source branch metadata
    try { fs.writeFileSync(path.join(worktreePath, '.source-branch'), branch, 'utf-8'); } catch { /* ignore */ }
    return { path: worktreePath, sourceBranch: branch };
  }

  async createAsync(name: string, onOutput: (text: string) => void): Promise<{ path: string; sourceBranch: string }> {
    const worktreePath = path.join(this.rootDir, '.claude', 'worktrees', name);
    const branch = await this.getCurrentBranch();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        'git',
        ['worktree', 'add', worktreePath, '-b', name, branch],
        { cwd: this.rootDir },
      );

      proc.stdout.on('data', (data: Buffer) => onOutput(data.toString()));
      proc.stderr.on('data', (data: Buffer) => onOutput(data.toString()));

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn git: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Store source branch metadata
          try { fs.writeFileSync(path.join(worktreePath, '.source-branch'), branch, 'utf-8'); } catch { /* ignore */ }
          resolve({ path: worktreePath, sourceBranch: branch });
        } else {
          reject(new Error(`git worktree add failed with exit code ${code}`));
        }
      });
    });
  }

  async checkStatus(worktreePath: string): Promise<{ clean: boolean; changesCount: number }> {
    let statusOutput = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: worktreePath, encoding: 'utf-8' },
      );
      statusOutput = stdout;
    } catch {
      // worktree may be in a broken state
    }
    const lines = statusOutput.trim().split('\n').filter(Boolean);
    return { clean: lines.length === 0, changesCount: lines.length };
  }

  async remove(worktreePath: string): Promise<void> {
    const branchName = path.basename(worktreePath);
    await execFileAsync(
      'git',
      ['worktree', 'remove', worktreePath, '--force'],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    try {
      await execFileAsync('git', ['branch', '-D', branchName], { cwd: this.rootDir, encoding: 'utf-8' });
    } catch {
      // branch may not exist or may have been merged
    }
  }

  private async list(): Promise<WorktreeInfo[]> {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list'],
      { cwd: this.rootDir, encoding: 'utf-8' },
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const match = line.match(/^(.+?)\s+\w+\s+\[(.+?)\]/);
        return match
          ? { path: match[1].trim(), branch: match[2] }
          : { path: line.trim(), branch: 'unknown' };
      });
  }

  async listDetails(): Promise<WorktreeDetails[]> {
    const worktrees = await this.list();
    // Skip first entry (main worktree)
    const results = await Promise.all(
      worktrees.slice(1).map(async (wt) => {
        const name = path.basename(wt.path);
        let statusOutput = '';
        try {
          const { stdout } = await execFileAsync(
            'git',
            ['status', '--porcelain'],
            { cwd: wt.path, encoding: 'utf-8' },
          );
          statusOutput = stdout;
        } catch {
          // worktree may be in a broken state
        }
        const lines = statusOutput.trim().split('\n').filter(Boolean);
        let sourceBranch: string | null = null;
        try {
          sourceBranch = fs.readFileSync(path.join(wt.path, '.source-branch'), 'utf-8').trim() || null;
        } catch { /* file may not exist for older worktrees */ }
        return {
          name,
          path: wt.path,
          clean: lines.length === 0,
          changesCount: lines.length,
          sourceBranch,
        };
      }),
    );
    return results;
  }
}
