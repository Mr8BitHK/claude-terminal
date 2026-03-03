import { useState, useEffect, useRef, useCallback } from 'react';
import { PROJECT_COLORS } from '../../shared/types';
import { cn } from '@/lib/utils';

interface ProjectItem {
  id: string;
  dir: string;
  colorIndex: number;
  tabCount: number;
}

interface Props {
  projects: ProjectItem[];
  onSelect: (projectId: string) => void;
  onAddProject: () => void;
  onCancel: () => void;
}

export default function ProjectSwitcherDialog({
  projects, onSelect, onAddProject, onCancel,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, projects.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (projects[selectedIndex]) {
          onSelect(projects[selectedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onCancel();
        break;
    }
  }, [projects, selectedIndex, onSelect, onCancel]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-[400px] bg-card border border-border rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border text-sm font-medium text-foreground">
          Switch Project
        </div>

        {/* Project list */}
        <div className="max-h-[300px] overflow-y-auto">
          {projects.map((project, index) => {
            const dirName = project.dir.split(/[/\\]/).pop() ?? project.dir;
            const hue = PROJECT_COLORS[project.colorIndex % PROJECT_COLORS.length].hue;
            const isSelected = index === selectedIndex;

            return (
              <button
                key={project.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 bg-transparent border-none',
                  'text-left cursor-pointer font-inherit',
                  isSelected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
                onClick={() => onSelect(project.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {/* Color swatch */}
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${hue} 60% 50%)` }}
                />
                {/* Dir name */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{dirName}</div>
                  <div className="text-xs text-muted-foreground truncate">{project.dir}</div>
                </div>
                {/* Tab count */}
                <span className="text-xs text-muted-foreground shrink-0">
                  {project.tabCount} {project.tabCount === 1 ? 'tab' : 'tabs'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 flex justify-between">
          <button
            className="text-xs text-primary hover:text-primary/80 bg-transparent border-none cursor-pointer font-inherit"
            onClick={onAddProject}
          >
            + Add Project
          </button>
          <span className="text-xs text-muted-foreground">
            Arrow keys to navigate, Enter to select
          </span>
        </div>
      </div>
    </div>
  );
}
