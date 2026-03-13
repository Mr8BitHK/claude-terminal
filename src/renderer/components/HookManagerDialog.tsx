import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Zap } from 'lucide-react';
import type { RepoHook, RepoHookConfig, HookCommand, HookEvent } from '../../shared/types';
import { HOOK_EVENTS } from '../../shared/types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

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
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [confirmingDeleteHook, setConfirmingDeleteHook] = useState(false);

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

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowConfirmClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  if (loading) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent>
          <p className="text-muted-foreground">Loading...</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Hooks</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left panel: hook list */}
          <div className="flex flex-col gap-2 w-[220px] shrink-0">
            <div className="flex flex-col gap-0.5 overflow-y-auto flex-1">
              {config.hooks.map(hook => (
                <button
                  key={hook.id}
                  className={cn(
                    'flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-muted text-left',
                    hook.id === selectedId && 'bg-secondary'
                  )}
                  onClick={() => { setSelectedId(hook.id); setConfirmingDeleteHook(false); }}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="truncate">{hook.name}</span>
                    <Badge variant="secondary" className="text-[10px] px-1 w-fit">
                      {hook.event}
                    </Badge>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <Switch
                      checked={hook.enabled}
                      onCheckedChange={(checked) => updateHook(hook.id, { enabled: checked })}
                    />
                  </div>
                </button>
              ))}
            </div>
            <Button size="sm" onClick={addHook}>
              <Plus size={14} /> Add Hook
            </Button>
          </div>

          {/* Right panel: hook editor */}
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-w-0">
            {selected ? (
              <>
                <div className="flex flex-col gap-1">
                  <Label>Name</Label>
                  <Input
                    type="text"
                    value={selected.name}
                    onChange={e => updateHook(selected.id, { name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Event</Label>
                  <Select
                    value={selected.event}
                    onValueChange={(value) => updateHook(selected.id, { event: value as HookEvent })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOOK_EVENTS.map(ev => (
                        <SelectItem key={ev} value={ev}>{ev}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Commands</Label>
                  <div className="flex flex-col gap-1.5">
                    {selected.commands.map((cmd, idx) => (
                      <div key={idx} className="flex items-start gap-2 rounded border border-border/50 p-2">
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground w-12 shrink-0">Path</Label>
                            <Input
                              className="flex-1"
                              placeholder="working directory"
                              value={cmd.path}
                              onChange={e => updateCommand(selected.id, idx, { path: e.target.value })}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground w-12 shrink-0">Cmd</Label>
                            <Input
                              className="flex-1"
                              placeholder="command to run"
                              value={cmd.command}
                              onChange={e => updateCommand(selected.id, idx, { command: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col items-center shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => moveCommand(selected.id, idx, -1)}
                            disabled={idx === 0}
                            title="Move up"
                          >
                            <ChevronUp size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => moveCommand(selected.id, idx, 1)}
                            disabled={idx === selected.commands.length - 1}
                            title="Move down"
                          >
                            <ChevronDown size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:text-destructive"
                            onClick={() => removeCommand(selected.id, idx)}
                            disabled={selected.commands.length <= 1}
                            title="Remove"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => addCommand(selected.id)} className="w-fit">
                      <Plus size={12} /> Add Command
                    </Button>
                  </div>
                </div>
                {confirmingDeleteHook ? (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Delete this hook?</span>
                    <Button variant="destructive" size="sm" onClick={() => { deleteHook(selected.id); setConfirmingDeleteHook(false); }}>
                      Delete
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirmingDeleteHook(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="text-destructive border-destructive hover:bg-destructive/10 w-fit mt-2"
                    onClick={() => setConfirmingDeleteHook(true)}
                  >
                    <Trash2 size={14} /> Delete Hook
                  </Button>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
                <Zap size={32} />
                <p>No hooks configured.</p>
                <p>Click &quot;Add Hook&quot; to get started.</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {dirty && (
            <Button className="bg-success hover:bg-success/90" onClick={handleSave}>Save</Button>
          )}
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {showConfirmClose && (
      <Dialog open onOpenChange={(open) => { if (!open) setShowConfirmClose(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <DialogDescription>You have unsaved changes. Close anyway?</DialogDescription>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowConfirmClose(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setShowConfirmClose(false); onClose(); }}>
              Discard & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
