import { useEffect, useState } from 'react';
import type { PermissionMode } from '../../shared/types';

interface StartupDialogProps {
  onStart: (dir: string, mode: PermissionMode) => void;
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass Permissions', description: 'Skip all permission prompts' },
  { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-approve file edits only' },
  { value: 'plan', label: 'Plan Mode', description: 'Read-only planning, no file changes' },
  { value: 'default', label: 'Default', description: 'Ask for permission on each action' },
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

  const handleBrowse = async () => {
    const dir = await window.claudeTerminal.selectDirectory();
    if (dir) {
      setSelectedDir(dir);
    }
  };

  const handleStart = () => {
    if (selectedDir) {
      onStart(selectedDir, permissionMode);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog startup-dialog">
        <h1>ClaudeTerminal</h1>

        <div className="dir-section">
          <h2>Working Directory</h2>
          {recentDirs.length > 0 && (
            <ul className="recent-dirs">
              {recentDirs.map((dir) => (
                <li
                  key={dir}
                  className={selectedDir === dir ? 'selected' : ''}
                  onClick={() => setSelectedDir(dir)}
                >
                  {dir}
                </li>
              ))}
            </ul>
          )}
          <button className="start-btn" onClick={handleBrowse} style={{ marginTop: 8 }}>
            Browse...
          </button>
          {selectedDir && (
            <div className="selected-dir">{selectedDir}</div>
          )}
        </div>

        <div className="permission-section">
          <h2>Permission Mode</h2>
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
              <span style={{ color: '#808080', marginLeft: 8, fontSize: 12 }}>
                {opt.description}
              </span>
            </label>
          ))}
        </div>

        <div className="dialog-actions">
          <button
            className="start-btn"
            disabled={!selectedDir}
            onClick={handleStart}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
