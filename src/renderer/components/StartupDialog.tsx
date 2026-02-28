import { useEffect, useState } from 'react';
import type { PermissionMode } from '../../shared/types';

interface StartupDialogProps {
  onStart: (dir: string, mode: PermissionMode) => void;
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'default', label: 'Default' },
];

export default function StartupDialog({ onStart }: StartupDialogProps) {
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypassPermissions');

  useEffect(() => {
    // Load recent directories
    window.claudeTerminal.getRecentDirs().then(setRecentDirs).catch(() => {});

    // Load saved permission mode
    window.claudeTerminal.getPermissionMode().then(setPermissionMode).catch(() => {});

    // Check for CLI-provided directory
    window.claudeTerminal.getCliStartDir().then((dir) => {
      if (dir) {
        setSelectedDir(dir);
      }
    }).catch(() => {});
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
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog startup-dialog">
        <div className="startup-header">
          <h1>Claude Terminal</h1>
        </div>

        <div className="dir-section">
          <label className="section-label">Directory</label>
          {recentDirs.length > 0 && (
            <ul className="recent-dirs" role="listbox" aria-label="Recent directories">
              {recentDirs.map((dir) => (
                <li
                  key={dir}
                  role="option"
                  tabIndex={0}
                  aria-selected={selectedDir === dir}
                  className={selectedDir === dir ? 'selected' : ''}
                  onClick={() => setSelectedDir(dir)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedDir(dir);
                    }
                  }}
                >
                  <span className="dir-path">{dir}</span>
                  <button
                    className="remove-dir-btn"
                    onClick={(e) => handleRemoveDir(dir, e)}
                    title="Remove from history"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="browse-btn" onClick={handleBrowse}>
            Browse…
          </button>
        </div>

        <div className="permission-section">
          <label className="section-label">Permissions</label>
          {PERMISSION_OPTIONS.map((opt) => (
            <label key={opt.value} className="radio-option">
              <input
                type="radio"
                name="permissionMode"
                value={opt.value}
                checked={permissionMode === opt.value}
                onChange={() => setPermissionMode(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>

        <button
          className="start-btn-primary"
          disabled={!selectedDir}
          onClick={handleStart}
        >
          Start
        </button>
      </div>
    </div>
  );
}
