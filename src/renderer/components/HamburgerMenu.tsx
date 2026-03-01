import { useCallback, useRef, useState } from 'react';
import { Menu, GitBranch, Zap } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';

interface HamburgerMenuProps {
  onManageWorktrees: () => void;
  onManageHooks: () => void;
}

export default function HamburgerMenu({ onManageWorktrees, onManageHooks }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(menuRef, open, closeMenu);

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
            onClick={() => { setOpen(false); onManageWorktrees(); }}
          >
            <GitBranch size={14} />
            <span>Manage worktrees</span>
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
