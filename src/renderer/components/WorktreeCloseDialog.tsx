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
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog">
        {clean ? (
          <>
            <h2>Remove worktree?</h2>
            <p className="dialog-text">
              Worktree <strong>{worktreeName}</strong> has no uncommitted changes.
            </p>
            <div className="dialog-actions">
              <button onClick={() => onConfirm(true)} autoFocus>Remove</button>
              <button onClick={() => onConfirm(false)}>Keep</button>
            </div>
          </>
        ) : (
          <>
            <h2>Uncommitted changes</h2>
            <p className="dialog-text">
              Worktree <strong>{worktreeName}</strong> has{' '}
              {changesCount} uncommitted change{changesCount !== 1 ? 's' : ''}.
            </p>
            <div className="dialog-actions">
              <button onClick={onCancel} autoFocus>Cancel</button>
              <button onClick={() => onConfirm(false)}>Keep worktree</button>
              <button className="dialog-btn-danger" onClick={() => onConfirm(true)}>Remove</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
