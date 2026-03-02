import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface WorktreeCloseDialogProps {
  worktreeName: string;
  clean: boolean;
  changesCount: number;
  onConfirm: (removeWorktree: boolean) => void;
  onCancel: () => void;
}

export default function WorktreeCloseDialog({
  worktreeName,
  clean,
  changesCount,
  onConfirm,
  onCancel,
}: WorktreeCloseDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        {clean ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove worktree?</DialogTitle>
            </DialogHeader>
            <DialogDescription>
              Worktree <strong>{worktreeName}</strong> has no uncommitted changes.
            </DialogDescription>
            <DialogFooter>
              <Button onClick={() => onConfirm(true)} autoFocus>Remove</Button>
              <Button variant="secondary" onClick={() => onConfirm(false)}>Keep</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Uncommitted changes</DialogTitle>
            </DialogHeader>
            <DialogDescription>
              Worktree <strong>{worktreeName}</strong> has{' '}
              {changesCount} uncommitted change{changesCount !== 1 ? 's' : ''}.
            </DialogDescription>
            <DialogFooter>
              <Button variant="secondary" onClick={onCancel} autoFocus>Cancel</Button>
              <Button variant="secondary" onClick={() => onConfirm(false)}>Keep worktree</Button>
              <Button variant="destructive" onClick={() => onConfirm(true)}>Remove</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
