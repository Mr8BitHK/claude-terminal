# Update Notification Design

## Goal

Check GitHub Releases for a newer version on startup and show a non-intrusive icon in the tab bar. Clicking it opens the releases page.

## Architecture

### Main process (check)

On `app.ready`, fire-and-forget a fetch to `https://api.github.com/repos/Mr8BitHK/claude-terminal/releases/latest`. Compare `tag_name` (strip `v` prefix) against `__APP_VERSION__` using numeric semver comparison. If newer, send `{ version, url }` to the renderer via `app:updateAvailable` IPC channel. Silent on any failure (network error, rate limit, etc.).

### Preload (bridge)

Expose `onUpdateAvailable(callback)` listener, same pattern as existing `onRemoteAccessUpdate`.

### Renderer (display)

New `UpdateButton` component in the tab bar, positioned left of the cloud icon:

```
[Tabs...] [+]          [⬇ Update] [☁ Cloud] [≡ Menu]
```

- Renders nothing until `app:updateAvailable` fires
- Shows `<ArrowDownToLine size={16} />` from lucide-react
- Blue color `#569cd6`, gentle opacity pulse (2s cycle)
- Tooltip: "Update available: vX.Y.Z"
- On click: `window.claudeTerminal.openExternal(url)` to open GitHub releases page

### Positioning

Move `margin-left: auto` from `.remote-access-menu` to `.update-btn`, so the update button (when visible) pushes everything right. When hidden, `.remote-access-menu` keeps its own `margin-left: auto` as fallback.

## Files

1. `src/main/update-checker.ts` — new, ~25 lines: `checkForUpdate(window)` function
2. `src/main/index.ts` — call `checkForUpdate` in `did-finish-load`
3. `src/preload.ts` — add `onUpdateAvailable` listener
4. `src/renderer/components/UpdateButton.tsx` — new, ~25 lines
5. `src/renderer/components/TabBar.tsx` — add `<UpdateButton />` before `<RemoteAccessButton />`
6. `src/renderer/index.css` — add `.update-btn` styles + `gentle-pulse` keyframes

## No new dependencies

- fetch is available in Node 18+ (Electron 40 uses Node 20)
- Semver comparison is 5 lines of code, no library needed
- `ArrowDownToLine` already available in lucide-react
