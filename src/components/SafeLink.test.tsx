import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeLink } from './SafeLink';

describe('SafeLink', () => {
  it('renders an anchor for a valid HTTPS URL', () => {
    render(<SafeLink href="https://example.com">Click me</SafeLink>);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(link).toHaveTextContent('Click me');
  });

  it('renders children in a span for a javascript: URI', () => {
    render(<SafeLink href="javascript:alert(1)">No click</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('No click').tagName).toBe('SPAN');
  });

  it('renders children in a span for an http: URI', () => {
    render(<SafeLink href="http://example.com">No click</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders children in a span for missing href', () => {
    render(<SafeLink href={undefined}>No click</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a placeholder when provided for an unsafe href', () => {
    render(<SafeLink href="javascript:alert(1)" placeholder={<span data-testid="placeholder">blocked</span>}>No click</SafeLink>);
    expect(screen.getByTestId('placeholder')).toHaveTextContent('blocked');
  });
});
