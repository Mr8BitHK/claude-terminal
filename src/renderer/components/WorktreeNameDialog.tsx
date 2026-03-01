import { useEffect, useState } from 'react';
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog">
        <h2>Create Worktree Tab</h2>
        <label>
          Worktree name:
          <input
            type="text"
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            placeholder="feature-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </label>
        {validationError && (
          <div className="validation-error">{validationError}</div>
        )}
        {currentBranch && (
          <div className="branch-info">
            Base branch: {currentBranch}
          </div>
        )}
        <div className="dialog-actions">
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Create
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
