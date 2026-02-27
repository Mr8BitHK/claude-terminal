# Installer & CLI Command Design

**Date:** 2026-02-28
**Goal:** Create a Windows installer for ClaudeTerminal with a `claudeterm` CLI command, and auto-start when a directory argument is provided.

## 1. Installer (Squirrel)

- Use the existing `MakerSquirrel` in `forge.config.ts`
- Configure with app metadata (name, description, exe name)
- Squirrel installs to `%LOCALAPPDATA%\ClaudeTerminal`
- Creates Start Menu shortcuts automatically
- `electron-squirrel-startup` already handles install/uninstall events in `src/main/index.ts`

## 2. `claudeterm` CLI Command

- Enhance the Squirrel startup handler to create a `claudeterm.cmd` shim during install
- Shim location: `%LOCALAPPDATA%\ClaudeTerminal\claudeterm.cmd`
- Shim content: `@"%~dp0ClaudeTerminal.exe" %*` (forwards all args to the exe)
- Add `%LOCALAPPDATA%\ClaudeTerminal` to the user's PATH via the Squirrel install event
- On uninstall: remove from PATH

## 3. Auto-start with Directory Argument

- When `cliStartDir` is set and valid, skip the StartupDialog entirely
- Use the last-saved permission mode from `SettingsStore`
- Auto-call `handleStartSession(dir, savedPermissionMode)` on mount
- This gives: `claudeterm D:\dev\my-project` → straight into the terminal

## Files to Modify

- `forge.config.ts` — MakerSquirrel config (exe name, setup exe name)
- `src/main/index.ts` — Squirrel event handling (create shim, manage PATH)
- `src/renderer/App.tsx` — Auto-start logic when CLI dir is provided
- `src/renderer/components/StartupDialog.tsx` — Pass auto-start signal
