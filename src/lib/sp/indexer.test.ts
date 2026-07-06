/**
 * Tests for the BlindBit Oracle v2 indexer client.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { fetchBlockEntries, fetchIndexerBlock, fetchIndexerTipHeight } from './indexer';

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    json: async () => body,
  } as Response;
}

describe('fetchIndexerTipHeight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetchMock;
  });

  it('reads blockHeight from /info', async () => {
    mocks.fetchMock.mockResolvedValueOnce(mockResponse({ blockHeight: 850_000 }));
    const height = await fetchIndexerTipHeight('https://indexer.example.com/');
    expect(height).toBe(850_000);
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      'https://indexer.example.com/info',
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('falls back to block_height snake_case', async () => {
    mocks.fetchMock.mockResolvedValueOnce(mockResponse({ block_height: 850_001 }));
    const height = await fetchIndexerTipHeight('https://indexer.example.com');
    expect(height).toBe(850_001);
  });

  it('throws on invalid height', async () => {
    mocks.fetchMock.mockResolvedValueOnce(mockResponse({ blockHeight: '850000' }));
    await expect(fetchIndexerTipHeight('https://indexer.example.com')).rejects.toThrow(
      'invalid blockHeight',
    );
  });
});

describe('fetchIndexerBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetchMock;
  });

  it('fetches and validates tweaks + utxos', async () => {
    const tweakHex =
      '025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36';
    mocks.fetchMock
      .mockResolvedValueOnce(mockResponse([tweakHex]))
      .mockResolvedValueOnce(mockResponse([
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 1000,
          scriptpubkey:
            '5120' + 'b'.repeat(64),
        },
      ]));

    const block = await fetchIndexerBlock('https://indexer.example.com', 850_000);
    expect(block.height).toBe(850_000);
    expect(block.tweaks).toHaveLength(1);
    expect(block.outputs).toHaveLength(1);
  });

  it('filters spent outputs by default', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse([
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 1000,
          scriptpubkey: '5120' + 'b'.repeat(64),
          spent: true,
        },
      ]));

    const block = await fetchIndexerBlock('https://indexer.example.com', 850_000);
    expect(block.outputs).toHaveLength(0);
  });

  it('includes spent outputs when requested', async () => {
    mocks.fetchMock
      .mockResolvedValueOnce(mockResponse([]))
      .mockResolvedValueOnce(mockResponse([
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 1000,
          scriptpubkey: '5120' + 'b'.repeat(64),
          spent: true,
        },
      ]));

    const block = await fetchIndexerBlock('https://indexer.example.com', 850_000, undefined, true);
    expect(block.outputs).toHaveLength(1);
  });
});

describe('fetchBlockEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetchMock;
  });

  it('skips the utxos fetch when tweaks are empty', async () => {
    mocks.fetchMock.mockResolvedValueOnce(mockResponse([]));
    const entries = await fetchBlockEntries('https://indexer.example.com', 850_000);
    expect(entries).toHaveLength(0);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns tweak entries for non-empty blocks', async () => {
    const tweakHex =
      '025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36';
    mocks.fetchMock
      .mockResolvedValueOnce(mockResponse([tweakHex]))
      .mockResolvedValueOnce(mockResponse([
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value: 1000,
          scriptpubkey: '5120' + 'b'.repeat(64),
        },
      ]));

    const entries = await fetchBlockEntries('https://indexer.example.com', 850_000);
    expect(entries).toHaveLength(1);
    expect(entries[0].height).toBe(850_000);
    expect(entries[0].outputs).toHaveLength(1);
  });
});
