import { useEffect, useRef, useState } from 'react';
import { Menu, GitBranch, Zap } from 'lucide-react';

interface HamburgerMenuProps {
  worktreeCount: number;
  onManageWorktrees: () => void;
  onManageHooks: () => void;
}

export default function HamburgerMenu({ worktreeCount, onManageWorktrees, onManageHooks }: HamburgerMenuProps) {
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
          <button
            className="hamburger-item"
            onClick={() => { setOpen(false); onManageHooks(); }}
          >
            <Zap size={14} />
            <span>Manage hooks</span>
          </button>
        </div>
      )}
    </div>
  );
}
