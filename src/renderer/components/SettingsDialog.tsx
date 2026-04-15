import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useShellOptions } from '../shell-context';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  defaultShell: string | null;
  onDefaultShellChange: (shellId: string) => void;
}

export default function SettingsDialog({ open, onClose, defaultShell, onDefaultShellChange }: SettingsDialogProps) {
  const shellOptions = useShellOptions();

  // Resolve the effective value: saved preference, or first available shell
  const effectiveShell = defaultShell && shellOptions.some(s => s.id === defaultShell)
    ? defaultShell
    : shellOptions[0]?.id ?? '';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Default terminal</div>
              <div className="text-xs text-muted-foreground">Opened with Ctrl+`</div>
            </div>
            <Select value={effectiveShell} onValueChange={onDefaultShellChange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shellOptions.map((shell) => (
                  <SelectItem key={shell.id} value={shell.id}>
                    {shell.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
