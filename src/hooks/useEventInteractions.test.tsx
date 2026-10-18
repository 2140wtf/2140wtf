import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEventInteractions } from './useEventInteractions';

const query = vi.fn<(filters: NostrFilter[]) => Promise<NostrEvent[]>>();

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({ nostr: { query } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const NOTE_ID = 'a'.repeat(64);
const RECIPIENT = 'b'.repeat(64);

/** A real, signed NIP-61 Nutzap carrying 21 + 1,014-sat proofs. */
function nutzap(): NostrEvent {
  const sk = generateSecretKey();
  return finalizeEvent(
    {
      kind: 9321,
      created_at: 1_700_000_000,
      content: '',
      tags: [
        ['p', RECIPIENT],
        ['u', 'https://mint.example/Bitcoin'],
        ['unit', 'sat'],
        ['e', NOTE_ID, ''],
        ['k', '1'],
        ['proof', JSON.stringify({ id: '1'.repeat(32), amount: 21, secret: 's1', C: 'c1' })],
        ['proof', JSON.stringify({ id: '2'.repeat(32), amount: 1014, secret: 's2', C: 'c2' })],
      ],
    },
    sk,
  ) as NostrEvent;
}

const note: NostrEvent = {
  id: NOTE_ID,
  pubkey: 'c'.repeat(64),
  kind: 1,
  created_at: 1_700_000_000,
  content: 'hi',
  tags: [],
  sig: 'd'.repeat(128),
};

const track: NostrEvent = {
  id: 'e'.repeat(64),
  pubkey: 'f'.repeat(64),
  kind: 36787,
  created_at: 1_700_000_000,
  content: '',
  tags: [['d', 'track-1']],
  sig: '0'.repeat(128),
};

describe('useEventInteractions — zap rails', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([]);
  });

  it('lists a kind 9321 Nutzap as a zap with the amount from its proofs', async () => {
    const zap = nutzap();
    query.mockResolvedValue([zap]);

    const { result } = renderHook(() => useEventInteractions(NOTE_ID, note), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.zaps).toHaveLength(1);
    expect(result.current.data?.zaps[0]).toMatchObject({
      eventId: zap.id,
      senderPubkey: zap.pubkey,
      amountSats: 1035,
    });
    // A Cashu zap is a zap rail, so it must be requested alongside 9735.
    expect(query.mock.calls[0][0][0].kinds).toContain(9321);
  });

  it('also asks for `a`-tagged receipts on addressable targets', async () => {
    renderHook(() => useEventInteractions(track.id, track), { wrapper });

    await waitFor(() => expect(query).toHaveBeenCalled());
    const filters = query.mock.calls[0][0];
    expect(filters).toContainEqual(
      expect.objectContaining({ kinds: [9735, 9321], '#a': [`36787:${track.pubkey}:track-1`] }),
    );
  });

  it('counts a receipt once when it matches both the `#e` and `#a` filters', async () => {
    const zap = nutzap();
    query.mockResolvedValue([zap, zap]);

    const { result } = renderHook(() => useEventInteractions(NOTE_ID, note), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.zaps).toHaveLength(1);
  });

  it('ignores a Nutzap whose signature does not verify', async () => {
    // JSON round-trip drops nostr-tools' "already verified" marker, which a
    // spread would carry over and short-circuit the signature check.
    const zap: NostrEvent = { ...JSON.parse(JSON.stringify(nutzap())), sig: '1'.repeat(128) };
    query.mockResolvedValue([zap]);

    const { result } = renderHook(() => useEventInteractions(NOTE_ID, note), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.zaps).toHaveLength(0);
  });
});
