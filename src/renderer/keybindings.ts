/**
 * Central keybinding registry.
 *
 * Each entry declares the shortcut combo AND its handler in one place.
 * - Terminal.tsx uses matchKeybinding() to pass app keys through xterm.
 * - App.tsx provides a KeybindingContext and calls kb.action(ctx).
 *
 * To add a new keybinding: add one entry to the array below. Done.
 */

export interface KeybindingContext {
  activeTabId: () => string | null;
  tabs: () => { id: string }[];
  createNewWindow: () => void;
  newTab: () => void;
  newWorktreeTab: () => void;
  newShellTab: (type: 'powershell' | 'wsl', afterTabId?: string) => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  renameTab: (tabId: string) => void;
  openProjectSwitcher: () => void;
}

export interface Keybinding {
  mod?: 'ctrl' | 'alt' | 'ctrl+shift';
  key: string;
  /** App-level handler. Omit for terminal-only bindings (e.g. Ctrl+Enter)
   *  or OS pass-through bindings that just need xterm to yield (e.g. Alt+F4). */
  action?: (ctx: KeybindingContext) => void;
  /** Side-effect to run inside the xterm key handler before bubbling. */
  onTerminal?: (tabId: string) => void;
}

function cycleTab(ctx: KeybindingContext, direction: 1 | -1) {
  const tabs = ctx.tabs();
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === ctx.activeTabId());
  const next = (idx + direction + tabs.length) % tabs.length;
  ctx.selectTab(tabs[next].id);
}

export const keybindings: Keybinding[] = [
  { mod: 'ctrl',       key: 'n',     action: (ctx) => ctx.createNewWindow() },
  { mod: 'ctrl',       key: 't',     action: (ctx) => ctx.newTab() },
  { mod: 'ctrl',       key: 'w',     action: (ctx) => ctx.newWorktreeTab() },
  { mod: 'ctrl',       key: 'p',     action: (ctx) => ctx.openProjectSwitcher() },
  { mod: 'ctrl+shift', key: 'P',     action: (ctx) => ctx.newShellTab('powershell', ctx.activeTabId() ?? undefined) },
  { mod: 'ctrl',       key: 'l',     action: (ctx) => ctx.newShellTab('wsl', ctx.activeTabId() ?? undefined) },
  { mod: 'ctrl',       key: 'F4',    action: (ctx) => { const id = ctx.activeTabId(); if (id) ctx.closeTab(id); } },
  { mod: 'ctrl',       key: 'Tab',   action: (ctx) => cycleTab(ctx, 1) },
  { mod: 'ctrl+shift', key: 'Tab',   action: (ctx) => cycleTab(ctx, -1) },
  {                     key: 'F2',    action: (ctx) => { const id = ctx.activeTabId(); if (id) ctx.renameTab(id); } },
  { mod: 'alt',        key: 'F4' }, // pass through to OS (close window)
  { mod: 'ctrl',       key: 'Enter', onTerminal: (tabId) => window.claudeTerminal.writeToPty(tabId, '\x1b\r') },
];

/**
 * Match a KeyboardEvent against the registry.
 * Ctrl+1-9 tab jumps are handled separately (dynamic range) — see isTabJump().
 */
export function matchKeybinding(e: KeyboardEvent): Keybinding | undefined {
  for (const kb of keybindings) {
    switch (kb.mod) {
      case 'ctrl':
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === kb.key) return kb;
        break;
      case 'ctrl+shift':
        if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === kb.key) return kb;
        break;
      case 'alt':
        if (e.altKey && !e.ctrlKey && e.key === kb.key) return kb;
        break;
      default:
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && e.key === kb.key) return kb;
    }
  }
  return undefined;
}

/** Check if Ctrl+1-9 tab jump. */
export function isTabJump(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9';
}
