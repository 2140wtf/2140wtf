import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';

function BrokenChunk(): never {
  throw new Error('Failed to fetch dynamically imported module');
}

afterEach(() => {
  sessionStorage.removeItem('chunk-error-recovery');
  vi.restoreAllMocks();
});

describe('ChunkErrorBoundary', () => {
  it('clears a stale chunk error when navigation changes the reset key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sessionStorage.setItem('chunk-error-recovery', '1');

    const { rerender } = render(
      <ChunkErrorBoundary resetKey="/broken">
        <BrokenChunk />
      </ChunkErrorBoundary>,
    );
    expect(screen.getByText('App updated')).toBeInTheDocument();

    rerender(
      <ChunkErrorBoundary resetKey="/healthy">
        <p>Healthy route</p>
      </ChunkErrorBoundary>,
    );
    expect(screen.getByText('Healthy route')).toBeInTheDocument();
  });
});
