import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useUploadSVGAsset } from './useUploadSVGAsset';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/sanitizeSvg', () => ({
  sanitizeSvg: (svg: string) => svg,
}));

vi.mock('@/hooks/useUploadFile', () => ({
  useUploadFile: () => ({ mutateAsync: mocks.uploadFile, isPending: false }),
}));

vi.mock('@/hooks/useToast', () => ({
  toast: mocks.toast,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function createSVGFile(content: string): Promise<File> {
  const blob = Buffer.from(content);
  return {
    name: 'test.svg',
    size: blob.length,
    type: 'image/svg+xml',
    lastModified: Date.now(),
    webkitRelativePath: '',
    text: async () => content,
    arrayBuffer: async () => blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
    slice: () => new Blob([blob]),
    stream: () => new ReadableStream(),
  } as unknown as File;
}

async function localHash(file: File): Promise<string> {
  const text = await file.text();
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

describe('useUploadSVGAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts an upload when the server hash matches the local hash', async () => {
    const file = await createSVGFile('<svg><circle r="10"/></svg>');
    const hash = await localHash(file);
    mocks.uploadFile.mockResolvedValue([
      ['url', `https://blossom.example.com/${hash}.svg`],
      ['x', hash],
    ]);

    const { result } = renderHook(() => useUploadSVGAsset(), { wrapper });
    const asset = await result.current.upload({ file });

    expect(asset.url).toBe(`https://blossom.example.com/${hash}.svg`);
    expect(asset.sha256).toBe(hash);
  });

  it('rejects an upload when the server hash does not match the local hash', async () => {
    const file = await createSVGFile('<svg><circle r="10"/></svg>');
    const realHash = await localHash(file);
    const fakeHash = realHash.slice(0, -1) + (realHash.slice(-1) === '0' ? '1' : '0');
    mocks.uploadFile.mockResolvedValue([
      ['url', `https://blossom.example.com/${fakeHash}.svg`],
      ['x', fakeHash],
    ]);

    const { result } = renderHook(() => useUploadSVGAsset(), { wrapper });
    await expect(result.current.upload({ file })).rejects.toThrow(/hash mismatch/);
  });

  it('rejects an upload with an invalid server hash', async () => {
    const file = await createSVGFile('<svg><circle r="10"/></svg>');
    mocks.uploadFile.mockResolvedValue([
      ['url', 'https://blossom.example.com/blob'],
      ['x', 'not-a-hash'],
    ]);

    const { result } = renderHook(() => useUploadSVGAsset(), { wrapper });
    await expect(result.current.upload({ file })).rejects.toThrow(/invalid SHA-256/);
  });

  it('falls back to the local hash when the server omits the hash tag', async () => {
    const file = await createSVGFile('<svg><circle r="10"/></svg>');
    const hash = await localHash(file);
    mocks.uploadFile.mockResolvedValue([['url', `https://blossom.example.com/${hash}.svg`]]);

    const { result } = renderHook(() => useUploadSVGAsset(), { wrapper });
    const asset = await result.current.upload({ file });

    expect(asset.sha256).toBe(hash);
  });
});
