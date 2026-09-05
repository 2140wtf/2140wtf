import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNsiteSignerRpc } from './useNsiteSignerRpc';

const mocks = vi.hoisted(() => ({
  user: null as {
    pubkey: string;
    signer: {
      signEvent: ReturnType<typeof vi.fn>;
      nip44: {
        encrypt: ReturnType<typeof vi.fn>;
        decrypt: ReturnType<typeof vi.fn>;
      };
    };
  } | null,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.user }),
}));

const pubkey = 'a'.repeat(64);

function event(kind: number) {
  return { kind, content: `event-${kind}`, tags: [], created_at: 1_000 };
}

describe('useNsiteSignerRpc', () => {
  beforeEach(() => {
    mocks.user = {
      pubkey,
      signer: {
        signEvent: vi.fn(async (template) => ({ ...template, id: 'b'.repeat(64), pubkey, sig: 'c'.repeat(128) })),
        nip44: {
          encrypt: vi.fn(async () => 'ciphertext'),
          decrypt: vi.fn(async () => 'plaintext'),
        },
      },
    };
    localStorage.clear();
  });

  it('serializes simultaneous permission prompts instead of overwriting the resolver', async () => {
    const { result } = renderHook(() => useNsiteSignerRpc({ siteId: 'site.example', siteName: 'Site' }));
    const post = vi.fn();

    const first = result.current.onRpc('nostr.signEvent', { event: event(1) }, post);
    await waitFor(() => expect(result.current.pendingPrompt?.kind).toBe(1));

    const second = result.current.onRpc('nostr.signEvent', { event: event(2) }, post);
    await Promise.resolve();
    expect(result.current.pendingPrompt?.kind).toBe(1);

    act(() => result.current.resolvePrompt({ allowed: true, remember: false }));
    await expect(first).resolves.toMatchObject({ kind: 1 });
    await waitFor(() => expect(result.current.pendingPrompt?.kind).toBe(2));

    act(() => result.current.resolvePrompt({ allowed: false, remember: false }));
    await expect(second).rejects.toThrow('User rejected');
    expect(mocks.user?.signer.signEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed event and encryption inputs before calling the signer', async () => {
    const { result } = renderHook(() => useNsiteSignerRpc({ siteId: 'site.example', siteName: 'Site' }));
    const post = vi.fn();

    await expect(result.current.onRpc('nostr.signEvent', { event: { kind: 1, tags: [['x'.repeat(4_097)]] } }, post)).rejects.toThrow('Invalid event');
    await expect(result.current.onRpc('nostr.nip44.encrypt', { pubkey: 'invalid', plaintext: 'hello' }, post)).rejects.toThrow('Invalid params');
    expect(mocks.user?.signer.signEvent).not.toHaveBeenCalled();
  });
});
