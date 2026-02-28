import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Zap } from 'lucide-react';
import type { RepoHook, RepoHookConfig, HookCommand, HookEvent } from '../../shared/types';
import { HOOK_EVENTS } from '../../shared/types';

interface HookManagerDialogProps {
  onClose: () => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function createEmptyHook(): RepoHook {
  return {
    id: generateId(),
    name: 'New Hook',
    event: 'worktree:created',
    commands: [{ path: '.', command: '' }],
    enabled: true,
  };
}

export default function HookManagerDialog({ onClose }: HookManagerDialogProps) {
  const [config, setConfig] = useState<RepoHookConfig>({ hooks: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const loaded = await window.claudeTerminal.getHookConfig();
      setConfig(loaded);
      if (loaded.hooks.length > 0) {
        setSelectedId(loaded.hooks[0].id);
      }
      setLoading(false);
    })();
  }, []);

  const selected = config.hooks.find(h => h.id === selectedId) ?? null;

  const updateHook = useCallback((hookId: string, updates: Partial<RepoHook>) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h => h.id === hookId ? { ...h, ...updates } : h),
    }));
    setDirty(true);
  }, []);

  const addHook = useCallback(() => {
    const hook = createEmptyHook();
    setConfig(prev => ({ hooks: [...prev.hooks, hook] }));
    setSelectedId(hook.id);
    setDirty(true);
  }, []);

  const deleteHook = useCallback((hookId: string) => {
    setConfig(prev => {
      const hooks = prev.hooks.filter(h => h.id !== hookId);
      if (selectedId === hookId) {
        setSelectedId(hooks.length > 0 ? hooks[0].id : null);
      }
      return { hooks };
    });
    setDirty(true);
  }, [selectedId]);

  const addCommand = useCallback((hookId: string) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: [...h.commands, { path: '.', command: '' }] }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const updateCommand = useCallback((hookId: string, idx: number, updates: Partial<HookCommand>) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: h.commands.map((c, i) => i === idx ? { ...c, ...updates } : c) }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const removeCommand = useCallback((hookId: string, idx: number) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h =>
        h.id === hookId
          ? { ...h, commands: h.commands.filter((_, i) => i !== idx) }
          : h
      ),
    }));
    setDirty(true);
  }, []);

  const moveCommand = useCallback((hookId: string, idx: number, direction: -1 | 1) => {
    setConfig(prev => ({
      hooks: prev.hooks.map(h => {
        if (h.id !== hookId) return h;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= h.commands.length) return h;
        const cmds = [...h.commands];
        [cmds[idx], cmds[newIdx]] = [cmds[newIdx], cmds[idx]];
        return { ...h, commands: cmds };
      }),
    }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    await window.claudeTerminal.saveHookConfig(config);
    setDirty(false);
  };

  if (loading) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog hook-dialog" onClick={e => e.stopPropagation()}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog hook-dialog" onClick={e => e.stopPropagation()}>
        <h2>Manage Hooks</h2>
        <div className="hook-layout">
          {/* Left panel: hook list */}
          <div className="hook-list-panel">
            <div className="hook-list">
              {config.hooks.map(hook => (
                <div
                  key={hook.id}
                  className={`hook-list-item ${hook.id === selectedId ? 'hook-list-item-active' : ''}`}
                  onClick={() => setSelectedId(hook.id)}
                >
                  <div className="hook-list-item-info">
                    <span className="hook-list-item-name">{hook.name}</span>
                    <span className={`hook-badge hook-badge-${hook.event.split(':')[0]}`}>
                      {hook.event}
                    </span>
                  </div>
                  <label className="hook-toggle" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={hook.enabled}
                      onChange={e => updateHook(hook.id, { enabled: e.target.checked })}
                    />
                    <span className="hook-toggle-slider" />
                  </label>
                </div>
              ))}
            </div>
            <button className="hook-add-btn" onClick={addHook}>
              <Plus size={14} /> Add Hook
            </button>
          </div>

          {/* Right panel: hook editor */}
          <div className="hook-editor-panel">
            {selected ? (
              <>
                <div className="hook-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={selected.name}
                    onChange={e => updateHook(selected.id, { name: e.target.value })}
                  />
                </div>
                <div className="hook-field">
                  <label>Event</label>
                  <select
                    value={selected.event}
                    onChange={e => updateHook(selected.id, { event: e.target.value as HookEvent })}
                  >
                    {HOOK_EVENTS.map(ev => (
                      <option key={ev} value={ev}>{ev}</option>
                    ))}
                  </select>
                </div>
                <div className="hook-field">
                  <label>Commands</label>
                  <div className="hook-commands">
                    {selected.commands.map((cmd, idx) => (
                      <div key={idx} className="hook-command-row">
                        <input
                          type="text"
                          className="hook-cmd-path"
                          placeholder="path"
                          value={cmd.path}
                          onChange={e => updateCommand(selected.id, idx, { path: e.target.value })}
                        />
                        <input
                          type="text"
                          className="hook-cmd-command"
                          placeholder="command"
                          value={cmd.command}
                          onChange={e => updateCommand(selected.id, idx, { command: e.target.value })}
                        />
                        <button
                          className="hook-cmd-btn"
                          onClick={() => moveCommand(selected.id, idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          className="hook-cmd-btn"
                          onClick={() => moveCommand(selected.id, idx, 1)}
                          disabled={idx === selected.commands.length - 1}
                          title="Move down"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          className="hook-cmd-btn hook-cmd-delete"
                          onClick={() => removeCommand(selected.id, idx)}
                          disabled={selected.commands.length <= 1}
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                    <button className="hook-add-cmd-btn" onClick={() => addCommand(selected.id)}>
                      <Plus size={12} /> Add Command
                    </button>
                  </div>
                </div>
                <button className="hook-delete-hook-btn" onClick={() => deleteHook(selected.id)}>
                  <Trash2 size={14} /> Delete Hook
                </button>
              </>
            ) : (
              <div className="hook-empty">
                <Zap size={32} />
                <p>No hooks configured.</p>
                <p>Click &quot;Add Hook&quot; to get started.</p>
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          {dirty && (
            <button className="hook-save-btn" onClick={handleSave}>Save</button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
