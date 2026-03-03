import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProjectSwitcherDialog from '@/components/ProjectSwitcherDialog';

describe('ProjectSwitcherDialog', () => {
  const projects = [
    { id: 'p1', dir: 'D:/dev/repo-a', colorIndex: 0, tabCount: 2 },
    { id: 'p2', dir: 'D:/dev/repo-b', colorIndex: 1, tabCount: 1 },
  ];

  it('renders project list', () => {
    render(
      <ProjectSwitcherDialog
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('repo-a')).toBeTruthy();
    expect(screen.getByText('repo-b')).toBeTruthy();
  });

  it('navigates with arrow keys and selects with Enter', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ProjectSwitcherDialog
        projects={projects}
        onSelect={onSelect}
        onAddProject={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const dialog = container.firstChild as HTMLElement;
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('closes on Escape', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ProjectSwitcherDialog
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onCancel={onCancel}
      />
    );
    const dialog = container.firstChild as HTMLElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('selects project on click', () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcherDialog
        projects={projects}
        onSelect={onSelect}
        onAddProject={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('repo-b'));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('shows tab counts', () => {
    render(
      <ProjectSwitcherDialog
        projects={projects}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('2 tabs')).toBeTruthy();
    expect(screen.getByText('1 tab')).toBeTruthy();
  });
});
