import type { ClaudeTerminalApi } from '../preload';

declare global {
  interface Window {
    claudeTerminal: ClaudeTerminalApi;
  }
}
