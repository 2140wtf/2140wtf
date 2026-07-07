import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeImage } from './SafeImage';

describe('SafeImage', () => {
  it('renders an img for a valid HTTPS URL', () => {
    render(<SafeImage src="https://example.com/image.png" alt="test" data-foo="bar" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/image.png');
    expect(img).toHaveAttribute('alt', 'test');
  });

  it('renders nothing for a javascript: URI', () => {
    const { container } = render(<SafeImage src="javascript:alert(1)" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for an http: URI', () => {
    const { container } = render(<SafeImage src="http://example.com/image.png" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for missing/empty src', () => {
    const { container } = render(<SafeImage src={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a placeholder when provided for an unsafe URL', () => {
    render(<SafeImage src="javascript:alert(1)" placeholder={<span data-testid="placeholder">fallback</span>} />);
    expect(screen.getByTestId('placeholder')).toHaveTextContent('fallback');
  });
});
