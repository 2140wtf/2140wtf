import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateSecretKey } from 'nostr-tools';

import { acquireMutex, useCashuWallet } from './useCashuWallet';
import { deriveEncryptionKey, deriveNip60WalletKey } from '@/lib/cashu/cashu';
import { saveProofsForMint } from '@/lib/cashu/storage';
import { createNip60Signer, buildTokenEvent } from '@/lib/cashu/cashuNip60';
import type { Nip60SyncApi } from '@/lib/cashu/cashuNip60';
import type { NostrEvent } from '@nostrify/nostrify';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { appName: 'Test', clientName: 'Test' } }),
}));

vi.mock('@cashu/cashu-ts', async () => {
  const actual = await vi.importActual<typeof import('@cashu/cashu-ts')>('@cashu/cashu-ts');
  return {
    ...actual,
    CashuMint: vi.fn(function () {
      return {
        getInfo: vi.fn().mockResolvedValue({ name: 'Test Mint', nuts: {} }),
      };
    }),
    CashuWallet: vi.fn(function () {
      return {
        loadMint: vi.fn().mockResolvedValue(undefined),
        getInfo: vi.fn().mockResolvedValue({ name: 'Test Mint', nuts: {} }),
        send: vi.fn().mockImplementation((amount: number, proofs: unknown[]) => {
          // Return a fresh sent proof plus change so conservation/fee checks pass.
          const inputSum = (proofs as Array<{ amount: number }>).reduce((sum, p) => sum + (p?.amount ?? 0), 0);
          return Promise.resolve({
            send: [{ id: 'ks', amount, secret: 'send-secret', C: 'C-send' }],
            keep: inputSum > amount ? [{ id: 'ks', amount: inputSum - amount, secret: 'keep-secret', C: 'C-keep' }] : [],
          });
        }),
        receive: vi.fn().mockResolvedValue([]),
        getFeesForProofs: vi.fn().mockReturnValue(0),
        checkProofsStates: vi.fn().mockResolvedValue([]),
        keysets: [{ active: true, id: 'ks' }],
        keys: new Map(),
      };
    }),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('acquireMutex FIFO serialization', () => {
  it('queues concurrent callers so only one runs at a time', async () => {
    const mutexRef = { current: null as Promise<void> | null };
    const order: number[] = [];

    const first = (async () => {
      const release = await acquireMutex(mutexRef);
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
    })();

    const second = (async () => {
      const release = await acquireMutex(mutexRef);
      order.push(2);
      release();
    })();

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('allows sequential callers to acquire and release independently', async () => {
    const mutexRef = { current: null as Promise<void> | null };
    const release1 = await acquireMutex(mutexRef);
    expect(mutexRef.current).not.toBeNull();
    release1();
    expect(mutexRef.current).toBeNull();

    const release2 = await acquireMutex(mutexRef);
    expect(mutexRef.current).not.toBeNull();
    release2();
    expect(mutexRef.current).toBeNull();
  });
});

describe('useCashuWallet NIP-60 sync', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.query.mockReset();
    mocks.publish.mockReset();
  });

  function makeSync(): Nip60SyncApi {
    const identityPrivkey = generateSecretKey();
    const identitySigner = createNip60Signer(identityPrivkey);
    return {
      signer: identitySigner,
      query: mocks.query,
      publish: mocks.publish,
      relays: [],
    };
  }

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    // Seed local storage with a spendable proof so sendToken can succeed.
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 21, secret: 'secret-a', C: 'C-a' },
        { id: 'ks', amount: 79, secret: 'secret-b', C: 'C-b' },
      ],
      encKey,
    );
    return { encKey };
  }

  it('deletes all remote token events for a mint during sync, not just the last local one', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const walletKey = deriveNip60WalletKey(seedPhrase);
    const walletSigner = createNip60Signer(walletKey.privkey);

    const remoteToken = await buildTokenEvent(mintUrl, [{ amount: 1, id: 'ks', secret: 's', C: 'c' }], walletSigner);
    expect(remoteToken).not.toBeNull();

    mocks.query.mockImplementation(async (filter: { kinds: number[]; authors: string[] }) => {
      if (filter.kinds.includes(7375)) return [remoteToken!];
      return [];
    });
    mocks.publish.mockResolvedValue('published-id');

    const sync = makeSync();
    const { result } = renderHook(
      () =>
        useCashuWallet(seedPhrase, {
          nip60Sync: sync,
          defaultMints: [{ name: 'Test', url: mintUrl }],
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const sendResult = await act(async () => result.current.sendToken(21));
    expect(sendResult).not.toBeNull();

    const publishedEvents = mocks.publish.mock.calls.map(([ev]) => ev as NostrEvent);
    const tokenEvents = publishedEvents.filter((ev) => ev.kind === 7375);
    const deletionEvents = publishedEvents.filter((ev) => ev.kind === 5);

    expect(tokenEvents.length).toBeGreaterThan(0);
    expect(deletionEvents.length).toBeGreaterThan(0);

    const deletion = deletionEvents[0]!;
    expect(deletion.tags.some((t) => t[0] === 'e' && t[1] === remoteToken!.id)).toBe(true);
  });

});
