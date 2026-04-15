import { useState, useCallback } from 'react';
import { PROJECT_COLORS, type ProjectConfig } from '../../shared/types';
import { cn } from '@/lib/utils';

interface TabCounts {
  idle: number;
  working: number;
  requires_response: number;
  total: number;
}

interface Props {
  projects: ProjectConfig[];
  activeProjectId: string;
  tabCounts: Record<string, TabCounts>;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onRemoveProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}

export default function ProjectSidebar({
  projects, activeProjectId, tabCounts,
  onSelectProject, onAddProject, onRemoveProject, onRenameProject,
}: Props) {
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const closeContextMenu = useCallback(() => {
    setContextMenuId(null);
    setContextMenuPos(null);
    setConfirmingRemove(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenuId(projectId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setConfirmingRemove(false);
  }, []);

  return (
    <div
      className="flex flex-col w-7 bg-[#181818] border-r border-border shrink-0 overflow-hidden"
      onClick={() => { if (contextMenuId) closeContextMenu(); }}
    >
      {/* Project list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
        {projects.map((project) => {
          const dirName = project.displayName ?? project.dir.split(/[/\\]/).pop() ?? project.dir;
          const isActive = project.id === activeProjectId;
          const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;
          const counts = tabCounts[project.id];
          const waiting = counts?.requires_response ?? 0;
          const working = counts?.working ?? 0;

          return (
            <button
              key={project.id}
              data-active={isActive}
              className={cn(
                'flex flex-col items-center gap-1 border-none border-l-[3px] border-l-transparent',
                'text-muted-foreground cursor-pointer font-inherit',
                'whitespace-nowrap py-2 text-[11px]',
                isActive && 'text-foreground',
              )}
              style={{
                backgroundColor: isActive ? `hsl(${hue} 45% 30%)` : `hsl(${hue} 20% 15%)`,
                borderLeftColor: isActive ? `hsl(${hue} 60% 50%)` : 'transparent',
              }}
              onClick={() => onSelectProject(project.id)}
              onContextMenu={(e) => handleContextMenu(e, project.id)}
              title={`${dirName}${waiting ? ` — ${waiting} waiting` : ''}${working ? ` — ${working} working` : ''}`}
            >
              {/* Status dots */}
              {(waiting > 0 || working > 0) && (
                <span className="flex flex-col items-center gap-1">
                  {waiting > 0 && (
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: '#f59e0b' }} />
                  )}
                  {working > 0 && (
                    <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: '#3b82f6' }} />
                  )}
                </span>
              )}
              <span className="[writing-mode:vertical-lr] overflow-hidden text-ellipsis whitespace-nowrap">{dirName}</span>
            </button>
          );
        })}
      </div>

      {/* Add project button */}
      <button
        className="bg-transparent border-none border-t border-border text-muted-foreground text-lg p-1 cursor-pointer hover:text-foreground hover:bg-accent"
        onClick={onAddProject}
        title="Add project"
      >
        +
      </button>

      {/* Context menu */}
      {contextMenuId && contextMenuPos && (
        <div
          className="fixed z-50 bg-card border border-border rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent bg-transparent border-none cursor-pointer font-inherit"
            onClick={() => {
              const project = projects.find(p => p.id === contextMenuId);
              if (project) {
                const name = project.displayName ?? project.dir.split(/[/\\]/).pop() ?? project.dir;
                onRenameProject(contextMenuId, name);
              }
              closeContextMenu();
            }}
          >
            Rename
          </button>
          {projects.length > 1 && (
            confirmingRemove ? (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent bg-transparent border-none cursor-pointer font-inherit font-semibold"
                onClick={() => {
                  onRemoveProject(contextMenuId);
                  closeContextMenu();
                }}
              >
                Confirm Remove
              </button>
            ) : (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent bg-transparent border-none cursor-pointer font-inherit"
                onClick={(e) => { e.stopPropagation(); setConfirmingRemove(true); }}
              >
                Remove
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
