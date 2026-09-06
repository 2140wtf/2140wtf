import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { signer: {} } }),
}));

const appContext = vi.hoisted(() => ({
  useAppContext: () => ({
    config: {
      blossomServerMetadata: undefined,
      useAppBlossomServers: true,
    },
  }),
}));
vi.mock('@/hooks/useAppContext', () => appContext);
vi.mock('@/lib/appBlossom', () => ({
  getEffectiveBlossomServers: () => ['https://blossom.example'],
}));
vi.mock('@/lib/stripMetadata', () => ({
  stripFileMetadata: vi.fn(async (file: File) => file),
}));

import { useUploadFile } from '@/hooks/useUploadFile';
import { errorCodeOf } from '@/lib/errorCodes';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useUploadFile client-side validation', () => {
  it('rejects an empty file with UPLOAD_006 before touching servers or metadata stripping', async () => {
    const stripFileMetadata = await import('@/lib/stripMetadata');
    const { result } = renderHook(() => useUploadFile(), { wrapper: createWrapper() });

    const emptyFile = new File([], 'empty.png', { type: 'image/png' });
    Object.defineProperty(emptyFile, 'size', { value: 0 });

    let thrown: unknown;
    await result.current.mutateAsync(emptyFile).catch((e) => {
      thrown = e;
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(errorCodeOf(thrown)).toBe('UPLOAD_006');
    expect(vi.mocked(stripFileMetadata.stripFileMetadata)).not.toHaveBeenCalled();
  });

  it('rejects an oversized file with UPLOAD_005 before touching servers or metadata stripping', async () => {
    const stripFileMetadata = await import('@/lib/stripMetadata');
    const { result } = renderHook(() => useUploadFile(), { wrapper: createWrapper() });

    const bigFile = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 101 * 1024 * 1024 });

    let thrown: unknown;
    await result.current.mutateAsync(bigFile).catch((e) => {
      thrown = e;
    });

    expect(errorCodeOf(thrown)).toBe('UPLOAD_005');
    expect(vi.mocked(stripFileMetadata.stripFileMetadata)).not.toHaveBeenCalled();
  });
});
