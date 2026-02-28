import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TabIndicator from '../../src/renderer/components/TabIndicator';

describe('TabIndicator', () => {
  it('renders nothing for new status', () => {
    const { container } = render(<TabIndicator status="new" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a spinning icon for working status', () => {
    const { container } = render(<TabIndicator status="working" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator', 'tab-indicator-spin');
  });

  it('renders a static icon for idle status', () => {
    const { container } = render(<TabIndicator status="idle" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator');
    expect(container.firstElementChild).not.toHaveClass('tab-indicator-spin');
  });

  it('renders a pulsing icon for requires_response status', () => {
    const { container } = render(<TabIndicator status="requires_response" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.firstElementChild).toHaveClass('tab-indicator', 'tab-indicator-pulse');
  });
});
