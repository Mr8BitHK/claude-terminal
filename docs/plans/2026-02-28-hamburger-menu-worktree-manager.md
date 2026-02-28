# Hamburger Menu + Worktree Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a hamburger menu pinned to the far-right of the tab bar, with a "Manage worktrees" item that opens a modal dialog for viewing and deleting worktrees.

**Architecture:** Three layers — (1) backend `listDetails()` method on `WorktreeManager` + IPC channel, (2) two new renderer components (`HamburgerMenu` dropdown, `WorktreeManagerDialog` modal), (3) wiring in `App.tsx` and `TabBar.tsx`. Follows existing patterns: dialog overlay for modals, lucide-react for icons, single CSS file.

**Tech Stack:** React 19, TypeScript, lucide-react, Electron IPC, git CLI

---

### Task 1: Add `listDetails()` to WorktreeManager

**Files:**
- Modify: `src/main/worktree-manager.ts:4-7` (add new interface)
- Modify: `src/main/worktree-manager.ts:48-64` (add new method after `list()`)

**Step 1: Write the failing test**

Create test file `tests/main/worktree-manager-list-details.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeManager } from '../../src/main/worktree-manager';
import { execSync } from 'child_process';

vi.mock('child_process');
const mockExecSync = vi.mocked(execSync);

describe('WorktreeManager.listDetails', () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WorktreeManager('/fake/root');
  });

  it('returns empty array when only main worktree exists', () => {
    mockExecSync.mockReturnValueOnce(
      '/fake/root  abc1234 [master]\n'
    );
    const result = manager.listDetails();
    expect(result).toEqual([]);
  });

  it('returns details for non-main worktrees', () => {
    // First call: git worktree list
    mockExecSync.mockReturnValueOnce(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/feat-a  def5678 [feat-a]\n'
    );
    // Second call: git status --porcelain for feat-a
    mockExecSync.mockReturnValueOnce('');

    const result = manager.listDetails();
    expect(result).toEqual([
      { name: 'feat-a', path: '/fake/root/.claude/worktrees/feat-a', clean: true, changesCount: 0 },
    ]);
  });

  it('reports dirty worktree with change count', () => {
    mockExecSync.mockReturnValueOnce(
      '/fake/root  abc1234 [master]\n/fake/root/.claude/worktrees/bugfix  aaa1111 [bugfix]\n'
    );
    // git status --porcelain returns 3 changed files
    mockExecSync.mockReturnValueOnce(' M file1.ts\n M file2.ts\n?? file3.ts\n');

    const result = manager.listDetails();
    expect(result).toEqual([
      { name: 'bugfix', path: '/fake/root/.claude/worktrees/bugfix', clean: false, changesCount: 3 },
    ]);
  });

  it('handles multiple worktrees', () => {
    mockExecSync.mockReturnValueOnce(
      '/fake/root  abc [master]\n/fake/root/.claude/worktrees/a  def [a]\n/fake/root/.claude/worktrees/b  ghi [b]\n'
    );
    mockExecSync.mockReturnValueOnce('');       // a is clean
    mockExecSync.mockReturnValueOnce(' M x.ts\n'); // b has 1 change

    const result = manager.listDetails();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'a', clean: true, changesCount: 0 });
    expect(result[1]).toMatchObject({ name: 'b', clean: false, changesCount: 1 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/worktree-manager-list-details.test.ts`
Expected: FAIL — `listDetails is not a function`

**Step 3: Write minimal implementation**

Add to `src/main/worktree-manager.ts`:

After the `WorktreeInfo` interface (line 4-7), add:

```ts
export interface WorktreeDetails {
  name: string;
  path: string;
  clean: boolean;
  changesCount: number;
}
```

After the `list()` method (after line 64), add:

```ts
  listDetails(): WorktreeDetails[] {
    const worktrees = this.list();
    // Skip first entry (main worktree)
    return worktrees.slice(1).map((wt) => {
      const name = path.basename(wt.path);
      let statusOutput = '';
      try {
        statusOutput = String(
          execSync('git status --porcelain', { cwd: wt.path, encoding: 'utf-8' })
        );
      } catch {
        // worktree may be in a broken state
      }
      const lines = statusOutput.trim().split('\n').filter(Boolean);
      return {
        name,
        path: wt.path,
        clean: lines.length === 0,
        changesCount: lines.length,
      };
    });
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/worktree-manager-list-details.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/worktree-manager.ts tests/main/worktree-manager-list-details.test.ts
git commit -m "feat: add WorktreeManager.listDetails() for worktree status"
```

---

### Task 2: Add IPC channel + preload API

**Files:**
- Modify: `src/main/index.ts:440` (add handler after `worktree:currentBranch`)
- Modify: `src/preload.ts:28-29` (add new API method after `getCurrentBranch`)
- Modify: `src/main/worktree-manager.ts:1` (import `WorktreeDetails` in index.ts)

**Step 1: Add IPC handler**

In `src/main/index.ts`, after line 440 (`worktree:currentBranch` handler), add:

```ts
  ipcMain.handle('worktree:listDetails', async () => {
    if (!worktreeManager) throw new Error('Session not started');
    return worktreeManager.listDetails();
  });

  ipcMain.handle('worktree:remove', async (_event, worktreePath: string) => {
    if (!worktreeManager) throw new Error('Session not started');
    worktreeManager.remove(worktreePath);
  });
```

**Step 2: Add preload API methods**

In `src/preload.ts`, after `getCurrentBranch` (line 29), add:

```ts
  listWorktreeDetails: (): Promise<{ name: string; path: string; clean: boolean; changesCount: number }[]> =>
    ipcRenderer.invoke('worktree:listDetails'),
  removeWorktree: (worktreePath: string): Promise<void> =>
    ipcRenderer.invoke('worktree:remove', worktreePath),
```

**Step 3: Commit**

```bash
git add src/main/index.ts src/preload.ts
git commit -m "feat: add worktree:listDetails and worktree:remove IPC channels"
```

---

### Task 3: Create HamburgerMenu component

**Files:**
- Create: `src/renderer/components/HamburgerMenu.tsx`
- Modify: `src/renderer/index.css` (add styles at end)

**Step 1: Create the component**

Create `src/renderer/components/HamburgerMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Menu, GitBranch } from 'lucide-react';

interface HamburgerMenuProps {
  worktreeCount: number;
  onManageWorktrees: () => void;
}

export default function HamburgerMenu({ worktreeCount, onManageWorktrees }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="hamburger-menu" ref={menuRef}>
      <button
        className="hamburger-btn"
        onClick={() => setOpen(!open)}
        title="Menu"
      >
        <Menu size={16} />
      </button>
      {open && (
        <div className="hamburger-dropdown">
          <button
            className="hamburger-item"
            disabled={worktreeCount === 0}
            onClick={() => { setOpen(false); onManageWorktrees(); }}
          >
            <GitBranch size={14} />
            <span>Manage worktrees</span>
            {worktreeCount === 0 && <span className="hamburger-item-hint">No worktrees</span>}
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add CSS**

Append to `src/renderer/index.css`:

```css
/* Hamburger menu */
.hamburger-menu { position: relative; margin-left: auto; -webkit-app-region: no-drag; }

.hamburger-btn {
  background: none; border: none; color: #808080;
  cursor: pointer; padding: 4px 12px; display: flex; align-items: center;
}
.hamburger-btn:hover { color: #fff; }

.hamburger-dropdown {
  position: absolute; top: 100%; right: 0;
  background: #252526; border: 1px solid #3c3c3c; border-radius: 6px;
  min-width: 200px; padding: 4px 0; z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.hamburger-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 12px; background: none; border: none;
  color: #d4d4d4; font-size: 13px; cursor: pointer; text-align: left;
}
.hamburger-item:hover:not(:disabled) { background: #2a2d2e; }
.hamburger-item:disabled { color: #555; cursor: default; }
.hamburger-item-hint { margin-left: auto; font-size: 11px; color: #555; }
```

**Step 3: Commit**

```bash
git add src/renderer/components/HamburgerMenu.tsx src/renderer/index.css
git commit -m "feat: add HamburgerMenu component with dropdown"
```

---

### Task 4: Create WorktreeManagerDialog component

**Files:**
- Create: `src/renderer/components/WorktreeManagerDialog.tsx`
- Modify: `src/renderer/index.css` (add styles)

**Step 1: Create the component**

Create `src/renderer/components/WorktreeManagerDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface WorktreeDetail {
  name: string;
  path: string;
  clean: boolean;
  changesCount: number;
}

interface WorktreeManagerDialogProps {
  onClose: () => void;
}

export default function WorktreeManagerDialog({ onClose }: WorktreeManagerDialogProps) {
  const [worktrees, setWorktrees] = useState<WorktreeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const loadWorktrees = async () => {
    setLoading(true);
    const details = await window.claudeTerminal.listWorktreeDetails();
    setWorktrees(details);
    setLoading(false);
  };

  useEffect(() => { loadWorktrees(); }, []);

  const handleDelete = async (wt: WorktreeDetail) => {
    if (!wt.clean && confirmingDelete !== wt.path) {
      setConfirmingDelete(wt.path);
      return;
    }
    await window.claudeTerminal.removeWorktree(wt.path);
    setConfirmingDelete(null);
    await loadWorktrees();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog wt-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Manage Worktrees</h2>
        {loading ? (
          <p className="wt-empty">Loading...</p>
        ) : worktrees.length === 0 ? (
          <p className="wt-empty">No worktrees found.</p>
        ) : (
          <table className="wt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Changes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {worktrees.map((wt) => (
                <tr key={wt.path}>
                  <td className="wt-name">{wt.name}</td>
                  <td>
                    <span className={`wt-badge ${wt.clean ? 'wt-badge-clean' : 'wt-badge-dirty'}`}>
                      {wt.clean ? 'clean' : 'dirty'}
                    </span>
                  </td>
                  <td className="wt-changes">{wt.changesCount}</td>
                  <td className="wt-action">
                    {confirmingDelete === wt.path ? (
                      <span className="wt-confirm">
                        <span className="wt-confirm-text">Uncommitted changes. Delete?</span>
                        <button className="wt-confirm-yes" onClick={() => handleDelete(wt)}>Delete</button>
                        <button className="wt-confirm-no" onClick={() => setConfirmingDelete(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="wt-delete-btn" onClick={() => handleDelete(wt)} title="Delete worktree">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add CSS**

Append to `src/renderer/index.css`:

```css
/* Worktree manager dialog */
.wt-dialog { min-width: 480px; max-width: 600px; }
.wt-empty { color: #808080; font-size: 13px; padding: 16px 0; }

.wt-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.wt-table th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: #808080; padding: 6px 8px;
  border-bottom: 1px solid #3c3c3c;
}
.wt-table td { padding: 8px; font-size: 13px; border-bottom: 1px solid #2a2d2e; }
.wt-name { font-family: 'Cascadia Code', monospace; }
.wt-changes { text-align: center; }

.wt-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500;
}
.wt-badge-clean { background: #1e3a1e; color: #6a9955; }
.wt-badge-dirty { background: #3a3a1e; color: #dcdcaa; }

.wt-action { text-align: right; white-space: nowrap; }
.wt-delete-btn {
  background: none; border: none; color: #808080; cursor: pointer; padding: 4px;
}
.wt-delete-btn:hover { color: #f44747; }

.wt-confirm { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.wt-confirm-text { color: #dcdcaa; }
.wt-confirm-yes {
  padding: 2px 8px; border: none; border-radius: 3px;
  background: #f44747; color: #fff; font-size: 11px; cursor: pointer;
}
.wt-confirm-yes:hover { background: #d73a3a; }
.wt-confirm-no {
  padding: 2px 8px; border: 1px solid #555; border-radius: 3px;
  background: none; color: #d4d4d4; font-size: 11px; cursor: pointer;
}
.wt-confirm-no:hover { background: #2a2d2e; }
```

**Step 3: Commit**

```bash
git add src/renderer/components/WorktreeManagerDialog.tsx src/renderer/index.css
git commit -m "feat: add WorktreeManagerDialog component"
```

---

### Task 5: Wire everything into TabBar and App

**Files:**
- Modify: `src/renderer/components/TabBar.tsx` (add hamburger menu)
- Modify: `src/renderer/App.tsx` (add worktree manager state and pass props)

**Step 1: Update TabBar**

Replace entire `src/renderer/components/TabBar.tsx`:

```tsx
import type { Tab as TabType } from '../../shared/types';
import Tab from './Tab';
import HamburgerMenu from './HamburgerMenu';

interface TabBarProps {
  tabs: TabType[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, name: string) => void;
  onNewTab: () => void;
  worktreeCount: number;
  onManageWorktrees: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onNewTab,
  worktreeCount,
  onManageWorktrees,
}: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onRename={(name) => onRenameTab(tab.id, name)}
        />
      ))}
      <button className="new-tab-btn" onClick={onNewTab} title="New tab (Ctrl+T)">
        +
      </button>
      <HamburgerMenu worktreeCount={worktreeCount} onManageWorktrees={onManageWorktrees} />
    </div>
  );
}
```

**Step 2: Update App.tsx**

In `src/renderer/App.tsx`:

Add import at top (after WorktreeNameDialog import):
```ts
import WorktreeManagerDialog from './components/WorktreeManagerDialog';
```

Add state (after line 19, `showWorktreeDialog`):
```ts
const [showWorktreeManager, setShowWorktreeManager] = useState(false);
const [worktreeCount, setWorktreeCount] = useState(0);
```

Add effect to poll worktree count (after line 100, the window title effect):
```ts
  // Track worktree count for hamburger menu
  useEffect(() => {
    if (appState !== 'running') return;
    const updateCount = async () => {
      try {
        const details = await window.claudeTerminal.listWorktreeDetails();
        setWorktreeCount(details.length);
      } catch { /* session may not be started */ }
    };
    updateCount();
    const interval = setInterval(updateCount, 5000);
    return () => clearInterval(interval);
  }, [appState]);
```

Add two new props to `<TabBar>` (around line 237-244):
```tsx
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onRenameTab={handleRenameTab}
        onNewTab={() => setShowNewTabDialog(true)}
        worktreeCount={worktreeCount}
        onManageWorktrees={() => setShowWorktreeManager(true)}
      />
```

Add dialog render (after WorktreeNameDialog, before closing `</div>`):
```tsx
      {showWorktreeManager && (
        <WorktreeManagerDialog onClose={() => setShowWorktreeManager(false)} />
      )}
```

**Step 3: Commit**

```bash
git add src/renderer/components/TabBar.tsx src/renderer/App.tsx
git commit -m "feat: wire hamburger menu and worktree manager into app"
```

---

### Task 6: Manual smoke test

**Step 1: Run the app**

Run: `npm start`

**Step 2: Verify hamburger menu**

- Hamburger icon (≡) visible on far-right of tab bar
- Click opens dropdown with "Manage worktrees" item
- Item is grayed out if no worktrees exist
- Click outside closes dropdown

**Step 3: Create a worktree and verify manager**

- Use Ctrl+W to create a worktree
- Click hamburger → "Manage worktrees" is now enabled
- Click it → modal dialog opens with the worktree in the table
- Status shows clean/dirty correctly
- X button deletes the worktree (with confirmation if dirty)
- Close button dismisses the dialog

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: polish hamburger menu and worktree manager"
```
