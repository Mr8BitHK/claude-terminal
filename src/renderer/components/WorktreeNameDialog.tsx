import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validateWorktreeName } from '../utils/validate-worktree-name';

interface WorktreeNameDialogProps {
  onCreateWithWorktree: (name: string) => void;
  onCancel: () => void;
}

export default function WorktreeNameDialog({
  onCreateWithWorktree,
  onCancel,
}: WorktreeNameDialogProps) {
  const [worktreeName, setWorktreeName] = useState('');
  const [currentBranch, setCurrentBranch] = useState('');

  useEffect(() => {
    window.claudeTerminal.getCurrentBranch().then(setCurrentBranch).catch(() => {
      // Not a git repo — leave blank (dialog shouldn't open in this case)
    });
  }, []);

  const validationError = validateWorktreeName(worktreeName.trim());
  const canSubmit = worktreeName.trim() && !validationError;

  const handleSubmit = () => {
    if (canSubmit) onCreateWithWorktree(worktreeName.trim());
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Worktree Tab</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="worktree-name">Worktree name:</Label>
          <Input
            id="worktree-name"
            type="text"
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            placeholder="feature-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
          {validationError && (
            <p className="text-xs text-destructive mt-1">{validationError}</p>
          )}
          {currentBranch && (
            <p className="text-xs text-muted-foreground mt-2">
              Base branch: {currentBranch}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            Create
          </Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
