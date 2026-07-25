import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateSecretKey } from 'nostr-tools';
import { getEncodedToken, CashuWallet } from '@cashu/cashu-ts';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';

import { acquireMutex, useCashuWallet } from './useCashuWallet';
import { deriveEncryptionKey, deriveNip60WalletKey, validateReceivedProofs } from '@/lib/cashu/cashu';
import { saveProofsForMint } from '@/lib/cashu/storage';
import { createNip60Signer, buildTokenEvent } from '@/lib/cashu/cashuNip60';
import type { Nip60SyncApi } from '@/lib/cashu/cashuNip60';
import type { NostrEvent } from '@nostrify/nostrify';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  publish: vi.fn(),
  sendTracker: { active: 0, max: 0 },
  sendCallCount: 0,
  meltCallCount: 0,
  mintProofsCallCount: 0,
  createMockWallet: (opts: { sendDelay?: number } = {}) => ({
    loadMint: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockResolvedValue({ name: 'Test Mint', nuts: {} }),
    send: vi.fn().mockImplementation(async (amount: number, proofs: unknown[]) => {
      const callId = ++mocks.sendCallCount;
      if (opts.sendDelay) {
        mocks.sendTracker.active++;
        mocks.sendTracker.max = Math.max(mocks.sendTracker.max, mocks.sendTracker.active);
        await new Promise((resolve) => setTimeout(resolve, opts.sendDelay));
        mocks.sendTracker.active--;
      }
      // Return a fresh sent proof plus change so conservation/fee checks pass.
      const inputSum = (proofs as Array<{ amount: number }>).reduce((sum, p) => sum + (p?.amount ?? 0), 0);
      return {
        send: [{ id: 'ks', amount, secret: `send-secret-${callId}`, C: `C-send-${callId}` }],
        keep: inputSum > amount ? [{ id: 'ks', amount: inputSum - amount, secret: `keep-secret-${callId}`, C: `C-keep-${callId}` }] : [],
      };
    }),
    selectProofsToSend: vi.fn().mockImplementation((_proofs: unknown[], amountToSend: number) => ({
      send: (Array.isArray(_proofs) ? _proofs : []).filter((p) => (p as { amount: number }).amount >= amountToSend),
      keep: (Array.isArray(_proofs) ? _proofs : []).filter((p) => (p as { amount: number }).amount < amountToSend),
    })),
    receive: vi.fn().mockResolvedValue([]),
    getFeesForProofs: vi.fn().mockImplementation((proofs: unknown[]) => (Array.isArray(proofs) ? proofs.length : 0)),
    checkProofsStates: vi.fn().mockResolvedValue([]),
    createMintQuote: vi.fn().mockResolvedValue({ quote: 'mint-quote-id', request: 'lnbc...', state: 'UNPAID' }),
    checkMintQuote: vi.fn().mockResolvedValue({ quote: 'mint-quote-id', state: 'PAID' }),
    mintProofs: vi.fn().mockImplementation(async (amount: number) => {
      const callId = ++mocks.mintProofsCallCount;
      return [{ id: 'ks', amount, secret: `mint-secret-${callId}`, C: `C-mint-${callId}` }];
    }),
    createMeltQuote: vi.fn().mockResolvedValue({ quote: 'melt-quote-id', amount: 21, fee_reserve: 1, state: 'UNPAID' }),
    checkMeltQuote: vi.fn().mockResolvedValue({ quote: 'melt-quote-id', state: 'PAID' }),
    meltProofs: vi.fn().mockImplementation(async (_quote: unknown, proofs: unknown[]) => {
      const callId = ++mocks.meltCallCount;
      const inputSum = (proofs as Array<{ amount: number }>).reduce((sum, p) => sum + (p?.amount ?? 0), 0);
      return {
        quote: { quote: 'melt-quote-id', state: 'PAID', payment_preimage: `preimage-${callId}` },
        change: inputSum > 22 ? [{ id: 'ks', amount: inputSum - 22, secret: `change-secret-${callId}`, C: `C-change-${callId}` }] : [],
      };
    }),
    keysets: [{ active: true, id: 'ks' }],
    keys: new Map(),
  }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: { appName: 'Test', clientName: 'Test' } }),
}));

vi.mock('@/lib/cashu/cashu', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cashu/cashu')>('@/lib/cashu/cashu');
  return {
    ...actual,
    validateReceivedProofs: vi.fn().mockReturnValue({ valid: true }),
  };
});

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
      return mocks.createMockWallet();
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

describe('useCashuWallet sendToken concurrency', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.sendTracker.active = 0;
    mocks.sendTracker.max = 0;
    mocks.sendCallCount = 0;
    // Reset CashuWallet mock to default (no delay) between tests.
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
  });

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
  }

  it('serializes overlapping sendToken calls so only one wallet.send is active at a time', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);

    // Install a slow send implementation so concurrent calls would overlap
    // if the mutex failed to serialize them.
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet({ sendDelay: 50 });
    });

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    // Fire two sends inside a single act() so React updates are batched and
    // we can start the second call before the first one finishes.
    const [sendResult1, sendResult2] = await act(async () => {
      const promise1 = result.current.sendToken(21);
      const promise2 = result.current.sendToken(21);
      return Promise.all([promise1, promise2]);
    });

    expect(sendResult1).not.toBeNull();
    expect(sendResult2).not.toBeNull();
    expect(mocks.sendTracker.max).toBe(1);
    expect(mocks.sendTracker.active).toBe(0);
  });
});

describe('useCashuWallet locked-token wrappers', () => {
  const mintUrl = 'https://mint.example.com';
  const validPubkey = 'a'.repeat(64);
  const validPrivkey = 'b'.repeat(64);

  beforeEach(() => {
    localStorage.clear();
  });

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 21, secret: 'secret-a', C: 'C-a' },
        { id: 'ks', amount: 79, secret: 'secret-b', C: 'C-b' },
      ],
      encKey,
    );
  }

  it('sendLockedToken rejects a non-64-hex recipient pubkey and sets an error', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const sendResult = await act(async () => result.current.sendLockedToken(10, 'not-a-valid-pubkey'));
    expect(sendResult).toBeNull();
    await waitFor(() => expect(result.current.error).toBe('Invalid recipient P2PK pubkey'));
  });

  it('sendLockedToken passes a valid recipient pubkey through to wallet.send', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    const sendSpy = vi.spyOn(wallet, 'send');

    const sendResult = await act(async () => result.current.sendLockedToken(21, validPubkey, 'locked memo'));
    expect(sendResult).not.toBeNull();

    expect(sendSpy).toHaveBeenCalledWith(
      21,
      expect.any(Array),
      // NUT-11 locks use the 33-byte compressed pubkey; the wallet prefixes
      // '02' to the x-only recipient key (strict mints reject x-only data).
      expect.objectContaining({ pubkey: '02' + validPubkey, includeDleq: true }),
    );
  });

  it('receiveLockedToken rejects an invalid privkey and sets an error', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const token = getEncodedToken({
      mint: mintUrl,
      proofs: [{ id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', validPubkey]), C: 'C-recv' }],
      unit: 'sat',
    });

    await act(async () => result.current.receiveLockedToken(token, 'bad-privkey'));
    await waitFor(() => expect(result.current.error).toBe('Invalid P2PK private key'));

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    expect(wallet.receive).not.toHaveBeenCalled();
  });

  it('receiveLockedToken passes a valid privkey through to wallet.receive', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    const receiveSpy = vi.spyOn(wallet, 'receive');

    const token = getEncodedToken({
      mint: mintUrl,
      proofs: [{ id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', validPubkey]), C: 'C-recv' }],
      unit: 'sat',
    });

    await act(async () => result.current.receiveLockedToken(token, validPrivkey));

    expect(receiveSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ privkey: validPrivkey }));
  });
});

describe('useCashuWallet mint URL policy', () => {
  const httpsMint = 'https://mint.example.com';
  const httpMint = 'http://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
  });

  it('addCustomMint rejects HTTP mint URLs', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: httpsMint }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    await act(async () => result.current.addCustomMint('Bad HTTP', httpMint));

    await waitFor(() => expect(result.current.error).toBe('Mint URL must use HTTPS'));
    expect(result.current.allMints.some((m) => m.url === httpMint)).toBe(false);
  });
});

describe('useCashuWallet mintFromQuote proof validation', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.mintProofsCallCount = 0;
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
  });

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 100, secret: 'secret-a', C: 'C-a' },
      ],
      encKey,
    );
  }

  it('calls validateReceivedProofs on minted proofs before storing them', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    await act(async () => result.current.mintFromQuote('mint-quote-id', 21));

    expect(validateReceivedProofs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ amount: 21 })]),
      expect.objectContaining({ requireDleq: true }),
    );
  });

  it('rejects minted proofs that fail validation', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: false, reason: 'invalid proof' });

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    await act(async () => result.current.mintFromQuote('mint-quote-id', 21));

    await waitFor(() => expect(result.current.error).toBe('Mint failed: invalid proof'));
  });
});

describe('useCashuWallet payInvoice coin selection', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.meltCallCount = 0;
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
  });

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    // Seed local storage with several proofs so coin selection matters.
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 10, secret: 'secret-a', C: 'C-a' },
        { id: 'ks', amount: 20, secret: 'secret-b', C: 'C-b' },
        { id: 'ks', amount: 100, secret: 'secret-c', C: 'C-c' },
      ],
      encKey,
    );
  }

  it('selects only the proofs needed for amount plus fee reserve', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    const selectSpy = vi.spyOn(wallet, 'selectProofsToSend');
    const meltSpy = vi.spyOn(wallet, 'meltProofs');

    await act(async () => result.current.payInvoice('lnbc210n1pw'));

    expect(selectSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10 }),
        expect.objectContaining({ amount: 20 }),
        expect.objectContaining({ amount: 100 }),
      ]),
      22,
      true,
    );
    const sentProofs = meltSpy.mock.calls[0]![1] as Array<{ amount: number }>;
    expect(sentProofs.length).toBeLessThan(3);
    expect(sentProofs.reduce((sum, p) => sum + p.amount, 0)).toBeGreaterThanOrEqual(22);
  });

  it('validates change proofs before storing them', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    await act(async () => result.current.payInvoice('lnbc210n1pw'));

    expect(validateReceivedProofs).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ requireDleq: true }),
    );
    expect(result.current.error).toBe('');
  });

  it('rejects payment when the melt fee reserve exceeds the selected proof fee', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    vi.spyOn(wallet, 'getFeesForProofs').mockReturnValue(0);
    vi.spyOn(wallet, 'createMeltQuote').mockResolvedValue({
      quote: 'melt-quote-id',
      amount: 21,
      fee_reserve: 5,
      state: 'UNPAID',
    } as MeltQuoteResponse);

    const payResult = await act(async () => result.current.payInvoice('lnbc210n1pw'));

    expect(payResult.success).toBe(false);
    await waitFor(() =>
      expect(result.current.error).toBe('Payment failed: Melt fee reserve (5) exceeds fee for selected proofs (0)'),
    );
  });
});
