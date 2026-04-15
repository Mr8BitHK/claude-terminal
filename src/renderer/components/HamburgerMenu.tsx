import { GitBranch, Zap, Menu, Settings } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface HamburgerMenuProps {
  onManageWorktrees: () => void;
  onManageHooks: () => void;
  onOpenSettings: () => void;
}

export default function HamburgerMenu({ onManageWorktrees, onManageHooks, onOpenSettings }: HamburgerMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-7 w-7" title="Menu">
          <Menu size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuItem onClick={onManageWorktrees}>
          <GitBranch size={14} />
          <span>Manage worktrees</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManageHooks}>
          <Zap size={14} />
          <span>Manage hooks</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings size={14} />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
