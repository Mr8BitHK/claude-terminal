import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TabIndicator from '../../src/renderer/components/TabIndicator';

describe('TabIndicator', () => {
  it('renders a static icon for new status', () => {
    const { container } = render(<TabIndicator status="new" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('inline-flex');
  });

  it('renders a static icon for shell status', () => {
    const { container } = render(<TabIndicator status="shell" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('inline-flex');
  });

  it('renders a spinning icon for working status', () => {
    const { container } = render(<TabIndicator status="working" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('inline-flex', 'animate-spin');
  });

  it('renders a static icon for idle status', () => {
    const { container } = render(<TabIndicator status="idle" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('inline-flex');
    expect(container.firstElementChild).not.toHaveClass('animate-spin');
  });

  it('renders a pulsing icon for requires_response status', () => {
    const { container } = render(<TabIndicator status="requires_response" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('inline-flex', 'animate-pulse');
  });
});
