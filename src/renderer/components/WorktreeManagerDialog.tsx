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
