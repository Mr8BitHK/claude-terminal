import { useEffect, useState } from 'react';
import { Trash2, MessageSquare, SquareTerminal } from 'lucide-react';
import type { Tab } from '../../shared/types';
import { useShellOptions } from '../shell-context';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface WorktreeDetail {
  name: string;
  path: string;
  clean: boolean;
  changesCount: number;
  sourceBranch: string | null;
}

interface WorktreeManagerDialogProps {
  tabs: Tab[];
  onClose: () => void;
  onOpenClaude: (worktreeName: string) => void;
  onOpenShell: (shellType: string, cwd: string) => void;
}

export default function WorktreeManagerDialog({ tabs, onClose, onOpenClaude, onOpenShell }: WorktreeManagerDialogProps) {
  const shellOptions = useShellOptions();
  const [worktrees, setWorktrees] = useState<WorktreeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const loadWorktrees = async () => {
    setLoading(true);
    try {
      const details = await window.claudeTerminal.listWorktreeDetails();
      setWorktrees(details);
    } catch (err) {
      console.error('Failed to load worktrees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWorktrees(); }, []);

  const handleDelete = async (wt: WorktreeDetail) => {
    if (!wt.clean && confirmingDelete !== wt.path) {
      setConfirmingDelete(wt.path);
      return;
    }
    try {
      await window.claudeTerminal.removeWorktree(wt.path);
      setConfirmingDelete(null);
      await loadWorktrees();
    } catch (err) {
      console.error('Failed to delete worktree:', err);
      setConfirmingDelete(null);
    }
  };

  const isWorktreeOpen = (worktreeName: string) =>
    tabs.some((t) => t.worktree === worktreeName);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="min-w-[700px] max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Manage Worktrees</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-sm py-4">Loading...</p>
        ) : worktrees.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No worktrees found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Changes</TableHead>
                <TableHead>Open</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worktrees.map((wt) => {
                const open = isWorktreeOpen(wt.name);
                return (
                  <TableRow key={wt.path}>
                    <TableCell className="font-medium">{wt.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{wt.sourceBranch ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={wt.clean
                        ? 'bg-[#1e3a1e] text-success border-0'
                        : 'bg-[#3a3a1e] text-warning border-0'
                      }>
                        {wt.clean ? 'clean' : 'dirty'}
                      </Badge>
                    </TableCell>
                    <TableCell>{wt.changesCount}</TableCell>
                    <TableCell>
                      {open && <span className="inline-block size-2 rounded-full bg-success" title="Has open tab" />}
                    </TableCell>
                    <TableCell>
                      {confirmingDelete === wt.path ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Uncommitted changes. Delete?</span>
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(wt)}>Delete</Button>
                          <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:text-primary"
                            onClick={() => { onOpenClaude(wt.name); onClose(); }}
                            title="Open Claude tab"
                          >
                            <MessageSquare size={14} />
                          </Button>
                          {shellOptions.map((shell) => (
                            <Button
                              key={shell.id}
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:text-[#569cd6]"
                              onClick={() => { onOpenShell(shell.id, wt.path); onClose(); }}
                              title={`Open ${shell.label}`}
                            >
                              <SquareTerminal size={14} />
                            </Button>
                          ))}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:text-destructive"
                            onClick={() => handleDelete(wt)}
                            title="Delete worktree"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
