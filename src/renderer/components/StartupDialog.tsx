import { useEffect, useState } from 'react';
import type { PermissionMode } from '../../shared/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

interface StartupDialogProps {
  onStart: (dir: string, mode: PermissionMode) => void;
  onCancel?: () => void;
  title?: string;
  hidePermissions?: boolean;
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'auto', label: 'Auto' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'default', label: 'Default' },
];

export default function StartupDialog({ onStart, onCancel, title = 'Claude Terminal', hidePermissions }: StartupDialogProps) {
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');

  useEffect(() => {
    window.claudeTerminal.getRecentDirs().then(setRecentDirs).catch(() => {});
    window.claudeTerminal.getPermissionMode().then(setPermissionMode).catch(() => {});
  }, []);

  const handleRemoveDir = async (dir: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.claudeTerminal.removeRecentDir(dir);
    setRecentDirs(prev => prev.filter(d => d !== dir));
    if (selectedDir === dir) setSelectedDir(null);
  };

  const handleBrowse = async () => {
    const dir = await window.claudeTerminal.selectDirectory();
    if (dir) {
      setSelectedDir(dir);
      setRecentDirs(prev => prev.includes(dir) ? prev : [dir, ...prev]);
    }
  };

  const handleStart = () => {
    if (selectedDir) {
      onStart(selectedDir, permissionMode);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && selectedDir) {
      handleStart();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && onCancel) onCancel(); }}>
      <DialogContent className="max-w-[480px]" onKeyDown={handleKeyDown}>
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription className="sr-only">Select a directory and permission mode to start a session</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Directory
          </Label>
          {recentDirs.length > 0 && (
            <ul className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto" role="listbox" aria-label="Recent directories">
              {recentDirs.map((dir) => (
                <li
                  key={dir}
                  role="option"
                  tabIndex={0}
                  aria-selected={selectedDir === dir}
                  className={cn(
                    'group flex items-center justify-between px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-muted',
                    selectedDir === dir && 'bg-secondary'
                  )}
                  onClick={() => setSelectedDir(dir)}
                  onDoubleClick={() => {
                    setSelectedDir(dir);
                    onStart(dir, permissionMode);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedDir(dir);
                    }
                  }}
                >
                  <span className="truncate text-foreground">{dir}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 h-5 w-5 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => handleRemoveDir(dir, e)}
                    title="Remove from history"
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" onClick={handleBrowse}>
            Browse…
          </Button>
        </div>

        {!hidePermissions && (
          <div className="flex flex-col gap-2">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Permissions
            </Label>
            <RadioGroup
              value={permissionMode}
              onValueChange={(value) => setPermissionMode(value as PermissionMode)}
              className="flex gap-4"
            >
              {PERMISSION_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-1.5">
                  <RadioGroupItem value={opt.value} id={`perm-${opt.value}`} />
                  <Label htmlFor={`perm-${opt.value}`} className="text-sm cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        <Button className="w-full" disabled={!selectedDir} onClick={handleStart}>
          Start
        </Button>
      </DialogContent>
    </Dialog>
  );
}
