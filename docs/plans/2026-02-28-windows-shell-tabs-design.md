# Windows Shell Tabs Design

**Date:** 2026-02-28
**Status:** Approved

## Summary

Add the ability to open plain PowerShell and WSL terminal tabs alongside existing Claude tabs. Shell tabs are ephemeral (no session persistence), have no Claude integration, and are visually distinct.

## Tab Type System

Add a `type` field to the `Tab` interface:

```typescript
type TabType = 'claude' | 'powershell' | 'wsl'
```

- `'claude'` — existing behavior (spawns Claude CLI, hooks installed, session tracking)
- `'powershell'` — spawns `powershell.exe`, no hooks, no session persistence
- `'wsl'` — spawns `wsl.exe`, no hooks, no session persistence

Claude-specific fields (`sessionId`, `status`) remain on the interface but are `null`/ignored for shell tabs. A new `'shell'` value is added to `TabStatus` for shell tabs.

## Spawning

`PtyManager.spawn()` branches on tab type:

- **claude**: `cmd.exe /c claude [args]` (unchanged)
- **powershell**: `powershell.exe` directly
- **wsl**: `wsl.exe` directly

No hook installation for shell types. No Claude-specific env vars.

## UI Entry Points

### [+] Dropdown Menu

Replaces the current direct-click behavior. Clicking [+] opens a dropdown:

- Claude Tab (Ctrl+T)
- Claude Worktree (Ctrl+W)
- ―――――――――――――――
- PowerShell (Ctrl+P)
- WSL (Ctrl+L)

### Chevron (▼) on Claude/Worktree Tabs

Each Claude tab (including worktree tabs) gets a small ▼ dropdown button:

- Open PowerShell Here
- Open WSL Here

Shell tabs opened from the chevron:
- Inherit the parent tab's `cwd`
- Insert immediately to the right of the parent tab

## Tab Visuals

Shell tabs have a distinct visual treatment:

- **PowerShell tabs**: PS icon + slightly different background tint
- **WSL tabs**: Linux/penguin icon + slightly different background tint
- No status indicator animation (no working/idle/requires_response states)
- Default name: "PowerShell" or "WSL" (renameable via F2)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+T | New Claude tab |
| Ctrl+W | New Claude worktree tab |
| Ctrl+P | New PowerShell tab (main dir) |
| Ctrl+L | New WSL tab (main dir) |

## What's NOT Included

- No session persistence for shell tabs (ephemeral)
- No Claude integration from shell tabs
- No CMD support
- No tab grouping beyond insertion order

## Architecture Impact

### Files Modified

- `src/shared/types.ts` — Add `TabType`, extend `Tab` and `TabStatus`
- `src/main/pty-manager.ts` — Branch spawn logic on tab type
- `src/main/index.ts` — New IPC handler logic for shell tab creation (skip hooks)
- `src/main/tab-manager.ts` — Accept type on creation, skip session persistence for shell tabs
- `src/preload.ts` — Expose shell tab creation methods
- `src/renderer/App.tsx` — Keyboard shortcuts for Ctrl+P, Ctrl+L
- `src/renderer/components/TabBar.tsx` — [+] dropdown menu
- `src/renderer/components/Tab.tsx` — Chevron dropdown, shell tab styling, type-specific icons
- `src/renderer/styles/` — Shell tab visual styles
