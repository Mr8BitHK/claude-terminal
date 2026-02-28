# Hamburger Menu + Worktree Manager

**Date:** 2026-02-28

## Overview

Add a hamburger menu pinned to the far-right of the tab bar. First menu item: "Manage worktrees" which opens a modal dialog listing all worktrees with status info and delete actions.

## Hamburger Button

- `Menu` icon from lucide-react, pinned to far-right of tab bar via `margin-left: auto`
- Styled consistently with `.new-tab-btn` (same padding, hover, `no-drag`)
- On click: toggles a small dropdown menu

Layout: `[Tab1][Tab2][+]                              [≡]`

## Dropdown Menu

- Small floating panel anchored below the hamburger icon, aligned to the right edge
- Single item for now: **"Manage worktrees"** with `GitBranch` icon
- **Disabled** (grayed out, non-clickable) when worktree count is 0
- Click-outside-to-close behavior
- Styled with existing dark theme (`#252526` bg, `#3c3c3c` border)
- Extensible — just add more items to the list later

## Worktree Manager Dialog

- Centered modal dialog (same pattern as `NewTabDialog`, `WorktreeNameDialog`)
- **Title:** "Manage Worktrees"
- **Table columns:**
  - **Name** — worktree directory name
  - **Status** — "clean" or "dirty" badge (green/yellow)
  - **Changes** — count of uncommitted changes
  - **Action** — X (Trash2) button to delete
- **Delete flow:** Click X → if clean, delete immediately. If dirty, show inline confirmation ("This worktree has uncommitted changes. Delete anyway?" with Cancel/Delete buttons)
- **Close** button at the bottom

## Backend (IPC)

- New IPC channel `worktree:list-details` — returns `{ name, path, clean, changesCount }[]` for each worktree (excluding the main working tree)
- Reuses existing `worktree:remove` for deletion
- `WorktreeManager.listDetails()` — calls `git status --porcelain` in each worktree to get dirty/clean and change count

## New Files

- `src/renderer/components/HamburgerMenu.tsx` — button + dropdown
- `src/renderer/components/WorktreeManagerDialog.tsx` — modal dialog

## Preload API Additions

- `listWorktreeDetails()` — invokes `worktree:list-details`
