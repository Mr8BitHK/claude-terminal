import { BrowserWindow } from 'electron';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let _window: BrowserWindow | null = null;
const pending: Array<{ level: LogLevel; msg: string }> = [];

function format(args: unknown[]): string {
  return args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function emit(level: LogLevel, msg: string) {
  if (_window && !_window.isDestroyed()) {
    _window.webContents.executeJavaScript(
      `console.${level}('[main]', ${JSON.stringify(msg)})`,
    );
  } else {
    pending.push({ level, msg });
  }
}

export const log = {
  debug(...args: unknown[]) { emit('debug', format(args)); },
  info(...args: unknown[])  { emit('info',  format(args)); },
  warn(...args: unknown[])  { emit('warn',  format(args)); },
  error(...args: unknown[]) { emit('error', format(args)); },

  /** Bind logger to the main BrowserWindow so it can forward to DevTools. */
  attach(win: BrowserWindow) {
    _window = win;
    while (pending.length > 0) {
      const entry = pending.shift()!;
      emit(entry.level, entry.msg);
    }
  },
};
