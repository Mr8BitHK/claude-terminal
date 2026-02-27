import { useEffect, useState } from 'react';

interface NewTabDialogProps {
  onCreateWithWorktree: (name: string) => void;
  onCreateWithoutWorktree: () => void;
  onCancel: () => void;
}

export default function NewTabDialog({
  onCreateWithWorktree,
  onCreateWithoutWorktree,
  onCancel,
}: NewTabDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [worktreeName, setWorktreeName] = useState('');
  const [currentBranch, setCurrentBranch] = useState('');

  useEffect(() => {
    if (step === 2) {
      window.claudeTerminal.getCurrentBranch().then(setCurrentBranch).catch(() => {
        setCurrentBranch('unknown');
      });
    }
  }, [step]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (step === 1) {
    return (
      <div className="dialog-overlay" onKeyDown={handleKeyDown}>
        <div className="dialog">
          <h2>New Tab</h2>
          <p>Create a worktree for this tab?</p>
          <div className="dialog-actions">
            <button onClick={() => setStep(2)}>Yes</button>
            <button onClick={onCreateWithoutWorktree}>No, use main</button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog">
        <h2>Create Worktree</h2>
        <label>
          Worktree name:
          <input
            type="text"
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            placeholder="feature-name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && worktreeName.trim()) {
                onCreateWithWorktree(worktreeName.trim());
              }
            }}
          />
        </label>
        {currentBranch && (
          <div className="branch-info">
            Base branch: {currentBranch}
          </div>
        )}
        <div className="dialog-actions">
          <button
            disabled={!worktreeName.trim()}
            onClick={() => onCreateWithWorktree(worktreeName.trim())}
          >
            Create
          </button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
