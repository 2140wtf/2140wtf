import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateSecretKey } from 'nostr-tools';
import { getEncodedToken, CashuWallet } from '@cashu/cashu-ts';
import { hashToCurve } from '@cashu/cashu-ts/crypto/common';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';

import { acquireMutex, useCashuWallet } from './useCashuWallet';
import { deriveEncryptionKey, deriveNip60WalletKey, validateReceivedProofs } from '@/lib/cashu/cashu';
import { saveProofsForMint, loadProofRecovery, loadMeltInputRecovery, getProofsForMint, writeSendRecovery, loadSendRecovery, addTransaction, loadTransactions, writeMeltInputRecovery, writeProofRecovery } from '@/lib/cashu/storage';
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
    createMeltQuoteBolt12: vi.fn().mockResolvedValue({ quote: 'bolt12-quote-id', amount: 21, fee_reserve: 1, state: 'UNPAID' }),
    checkMeltQuoteBolt12: vi.fn().mockResolvedValue({ quote: 'bolt12-quote-id', state: 'PAID' }),
    meltProofsBolt12: vi.fn().mockResolvedValue({
      quote: { quote: 'bolt12-quote-id', state: 'PAID' },
      change: [{ id: 'ks', amount: 78, secret: 'change-secret-b12', C: 'C-change-b12' }],
    }),
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

  it('sendLockedToken passes a 66-char compressed pubkey through as-is (kind-10019 form)', async () => {
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

    // kind-10019 parsers accept '03'-prefixed compressed keys — the lock must
    // use the key verbatim, not silently skip the lock (credits-flow review).
    const compressed = '03' + validPubkey;
    const sendResult = await act(async () => result.current.sendLockedToken(21, compressed, 'locked memo'));
    expect(sendResult).not.toBeNull();

    expect(sendSpy).toHaveBeenCalledWith(
      21,
      expect.any(Array),
      expect.objectContaining({ pubkey: compressed, includeDleq: true }),
    );
  });

  it('sendToken fails loudly on a garbage recipient pubkey (no silent bearer token)', async () => {
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

    // Direct sendToken with a pubkey-shaped-but-invalid value must NOT reach
    // the mint at all — the previous length===64 check would have silently
    // sent an UNLOCKED token while the UI claimed "P2PK-locked".
    const sendResult = await act(async () => result.current.sendToken(10, 'memo', '04' + validPubkey));
    expect(sendResult).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.error).toContain('Invalid recipient P2PK pubkey'));
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

// ── Deep-hunt regression tests (round 1 confirmed findings) ─────────────────

describe('useCashuWallet hunt regressions: journal-after-commit', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
  });

  it('receiveToken journals the fresh proofs IMMEDIATELY after the mint commits, before any later check can throw', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const encKey = await deriveEncryptionKey(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    // The mint commits: token inputs are spent, fresh outputs returned…
    vi.spyOn(wallet, 'receive').mockResolvedValue([
      { id: 'ks', amount: 10, secret: 'recv-secret-1', C: 'C-recv-1' },
    ] as never);
    // …but the post-commit spent-state check fails (empty states → length
    // mismatch throw). Previously this burned the 10 sats: the only copy of
    // the fresh proofs was in memory and the pending-receive retry re-sends
    // the ORIGINAL token, which the mint now rejects as spent.
    vi.spyOn(wallet, 'checkProofsStates').mockResolvedValue([] as never);

    const token = getEncodedToken({
      mint: mintUrl,
      proofs: [{ id: 'ks', amount: 10, secret: 'input-secret-1', C: 'C-in-1' }],
      unit: 'sat',
    });
    const received = await act(async () => result.current.receiveToken(token));
    expect(received).toBe(0);

    // The recovery journal must hold the fresh proofs for the reconciler.
    const journal = await loadProofRecovery(mintUrl, encKey);
    expect(journal).not.toBeNull();
    expect(journal!.proofs).toEqual([
      expect.objectContaining({ secret: 'recv-secret-1', amount: 10 }),
    ]);
  });
});

describe('useCashuWallet hunt regressions: sendToken offline no-swap path', () => {
  const mintUrl = 'https://mint.example.com';
  const validPubkey = 'a'.repeat(64);

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
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
    return { encKey };
  }

  /** Mimic the cashu-ts offline path: exact selection, no swap, inputs returned unchanged. */
  function mockOfflineSend(wallet: CashuWallet) {
    vi.spyOn(wallet, 'send').mockImplementation((async (_amount: number, proofs: Array<{ id: string; amount: number; secret: string; C: string }>) => ({
      send: proofs.filter((p) => p.amount === 21),
      keep: proofs.filter((p) => p.amount !== 21),
    })) as never);
  }

  it('accepts input proofs returned unchanged for a bearer send (offline no-swap is legitimate)', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    mockOfflineSend(wallet);

    // Previously this threw "Mint returned unspent input proofs as outputs" —
    // a deterministic failure for every exact-match bearer send.
    const token = await act(async () => result.current.sendToken(21));
    expect(token).not.toBeNull();
    // The token carries the original input proof (ecash changes hands as-is).
    expect(token).toContain('cashu');
    expect(result.current.error).toBe('');
  });

  it('still rejects input proofs returned as outputs when a P2PK lock was requested', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    mockOfflineSend(wallet);

    // A locked send can NEVER legitimately return the (unlocked) inputs —
    // the offline exception must not apply when sendOpts.pubkey is set.
    const token = await act(async () => result.current.sendToken(21, 'memo', validPubkey));
    expect(token).toBeNull();
    await waitFor(() => expect(result.current.error).toContain('unspent input proofs'));
  });
});

describe('useCashuWallet hunt regressions: dedicated melt-input recovery slot', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.meltCallCount = 0;
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
  });

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 10, secret: 'secret-a', C: 'C-a' },
        { id: 'ks', amount: 20, secret: 'secret-b', C: 'C-b' },
        { id: 'ks', amount: 100, secret: 'secret-c', C: 'C-c' },
      ],
      encKey,
    );
    return { encKey };
  }

  it('keeps the melt-input journal while the quote is PENDING (and out of the clobber-able generic slot)', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    vi.spyOn(wallet, 'meltProofs').mockResolvedValue({
      quote: { quote: 'melt-quote-id', state: 'PENDING' },
      change: [{ id: 'ks', amount: 78, secret: 'change-secret-p', C: 'C-change-p' }],
    } as never);

    const payResult = await act(async () => result.current.payInvoice('lnbc210n1pw'));
    expect(payResult.success).toBe(true);
    expect(payResult.pending).toBe(true);

    // The selected 100-sat input proof sits in the DEDICATED melt-input slot…
    const meltJournal = await loadMeltInputRecovery(mintUrl, encKey);
    expect(meltJournal).not.toBeNull();
    expect(meltJournal!.proofs).toEqual([
      expect.objectContaining({ secret: 'secret-c', amount: 100 }),
    ]);
    // …and the generic proof-recovery slot was NOT used (a later wallet op
    // would overwrite it and reconcile could clear it as "stale").
    expect(await loadProofRecovery(mintUrl, encKey)).toBeNull();

    // The store holds only the unselected proofs plus change.
    const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
    expect(stored.map((p) => p.secret).sort()).toEqual(['change-secret-p', 'secret-a', 'secret-b']);
  });

  it('restores the input proofs from the melt-input slot when the quote resolves UNPAID', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    vi.spyOn(wallet, 'meltProofs').mockResolvedValue({
      quote: { quote: 'melt-quote-id', state: 'UNPAID' },
      change: [{ id: 'ks', amount: 79, secret: 'change-secret-u', C: 'C-change-u' }],
    } as never);
    // The restore path verifies spent-state: every proof comes back UNSPENT,
    // keyed by the proof's real Y (hash-to-curve of the secret).
    const encoder = new TextEncoder();
    vi.spyOn(wallet, 'checkProofsStates').mockImplementation(async (proofs: unknown[]) =>
      (proofs as Array<{ secret: string }>).map((p) => ({
        Y: hashToCurve(encoder.encode(String(p.secret))).toHex(true),
        state: 'UNSPENT',
      })) as never,
    );

    const payResult = await act(async () => result.current.payInvoice('lnbc210n1pw'));
    expect(payResult.success).toBe(false);

    // All three original proofs are restored to the store…
    const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
    expect(stored.map((p) => p.secret).sort()).toEqual(['secret-a', 'secret-b', 'secret-c']);
    // …and the melt-input journal is cleared.
    expect(await loadMeltInputRecovery(mintUrl, encKey)).toBeNull();
  });
});

describe('useCashuWallet hunt regressions: melt lifecycle (rounds 2-3)', () => {
  const mintUrl = 'https://mint.example.com';

  beforeEach(() => {
    localStorage.clear();
    mocks.meltCallCount = 0;
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
  });

  async function setupWallet(seedPhrase: string) {
    const encKey = await deriveEncryptionKey(seedPhrase);
    await saveProofsForMint(
      mintUrl,
      [
        { id: 'ks', amount: 10, secret: 'secret-a', C: 'C-a' },
        { id: 'ks', amount: 20, secret: 'secret-b', C: 'C-b' },
        { id: 'ks', amount: 100, secret: 'secret-c', C: 'C-c' },
      ],
      encKey,
    );
    return { encKey };
  }

  it('payBolt12 records the melt tx WITH the encryption key, preserving encrypted history', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);
    // Pre-existing encrypted history — the round-2 bug wiped it by reading
    // without the key (decryption failure → []) and saving the new tx over it.
    await addTransaction(
      { type: 'mint', amount: 5, memo: 'earlier tx', mintUrl, status: 'completed' },
      encKey,
    );

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    vi.spyOn(wallet, 'createMeltQuoteBolt12').mockResolvedValue({
      quote: 'bolt12-quote-id',
      amount: 21,
      fee_reserve: 1,
      state: 'UNPAID',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    } as never);
    vi.spyOn(wallet, 'meltProofsBolt12').mockResolvedValue({
      quote: { quote: 'bolt12-quote-id', state: 'PAID' },
      change: [{ id: 'ks', amount: 78, secret: 'change-secret-b12', C: 'C-change-b12' }],
    } as never);

    const payResult = await act(async () => result.current.payBolt12('lno1qqqqqqqqqqqqqqqqqqqq', 21));
    expect(payResult.success).toBe(true);

    const txs = await loadTransactions(encKey);
    // The earlier entry survived…
    expect(txs.some((t) => t.memo === 'earlier tx')).toBe(true);
    // …and the BOLT12 melt was recorded with everything the poll needs.
    const meltTx = txs.find((t) => t.type === 'melt');
    expect(meltTx).toBeDefined();
    expect(meltTx!.status).toBe('completed');
    expect(meltTx!.quoteId).toBe('bolt12-quote-id');
    expect(meltTx!.bolt12).toBe(true);
    expect(meltTx!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('records a pending melt tx and keeps the melt-input journal when meltProofs fails after quote creation', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);
    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    const wallet = result.current.wallet;
    if (!wallet) throw new Error('Wallet not initialized');
    // Melt outcome UNKNOWN: the request timed out after the mint may have paid.
    vi.spyOn(wallet, 'meltProofs').mockRejectedValue(new Error('Melt proofs timeout'));
    // Keep a stray poll (10s interval) from resolving the quote mid-test.
    vi.spyOn(wallet, 'checkMeltQuote').mockResolvedValue({ quote: 'melt-quote-id', state: 'PENDING' } as never);

    const payResult = await act(async () => result.current.payInvoice('lnbc210n1pw'));
    expect(payResult.success).toBe(false);

    // A pending melt tx ties the journal to an unresolved quote — without it
    // the startup reconcile merged the journaled (possibly spent) inputs back
    // into the store, inflating the balance and poisoning future sends.
    const txs = await loadTransactions(encKey);
    const pendingMelt = txs.find((t) => t.type === 'melt' && t.status === 'pending');
    expect(pendingMelt).toBeDefined();
    expect(pendingMelt!.quoteId).toBe('melt-quote-id');
    expect(pendingMelt!.memo).toContain('outcome unknown');

    // The journal still holds the selected 100-sat input…
    const journal = await loadMeltInputRecovery(mintUrl, encKey);
    expect(journal).not.toBeNull();
    expect(journal!.proofs).toEqual([expect.objectContaining({ secret: 'secret-c', amount: 100 })]);
    // …and the proof store is untouched (all three original proofs present).
    const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
    expect(stored.map((p) => p.secret).sort()).toEqual(['secret-a', 'secret-b', 'secret-c']);
  });

  it('refuses to remove a custom mint that still holds a balance', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Fallback', url: 'https://fallback.example.com' }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    act(() => { result.current.addCustomMint('Test', mintUrl); });
    await waitFor(() => expect(result.current.allMints.some((m) => m.url === mintUrl)).toBe(true));

    act(() => { result.current.removeCustomMint(mintUrl); });
    await waitFor(() => expect(result.current.error).toContain('Mint still holds 130 sats'));

    // The mint and its ecash survive.
    expect(result.current.allMints.some((m) => m.url === mintUrl)).toBe(true);
    const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
    expect(stored.map((p) => p.secret).sort()).toEqual(['secret-a', 'secret-b', 'secret-c']);
  });

  it('removes a custom mint with a zero balance and cleans up its storage', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    await setupWallet(seedPhrase);
    const emptyMint = 'https://empty.example.com';

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    act(() => { result.current.addCustomMint('Empty', emptyMint); });
    await waitFor(() => expect(result.current.allMints.some((m) => m.url === emptyMint)).toBe(true));

    act(() => { result.current.removeCustomMint(emptyMint); });
    await waitFor(() => expect(result.current.allMints.some((m) => m.url === emptyMint)).toBe(false));
    expect(result.current.error).toBe('');
  });

  it('poll resolves a pending BOLT12 melt via the bolt12 endpoint and removes journaled inputs', async () => {
    // Seed storage BEFORE faking timers — the cross-tab lock's polling loop
    // misbehaves when acquisition starts under fake time.
    const seedPhrase = generateMnemonic(wordlist);
    const { encKey } = await setupWallet(seedPhrase);
    // Pending BOLT12 melt tx (as recorded after a melt timeout) + the
    // melt-input journal holding the selected 100-sat proof, which is still
    // in the store because the melt response was lost.
    await addTransaction(
      {
        type: 'melt',
        amount: 21,
        memo: 'BOLT12 offer lno1qqq… (outcome unknown — resolving)',
        mintUrl,
        status: 'pending',
        quoteId: 'bolt12-quote-id',
        expiresAt: Date.now() + 3600_000,
        bolt12: true,
      },
      encKey,
    );
    await writeMeltInputRecovery(mintUrl, [{ id: 'ks', amount: 100, secret: 'secret-c', C: 'C-c' }], encKey);

    // shouldAdvanceTime keeps waitFor/webcrypto working while still letting us
    // jump the clock straight onto the 10s poll interval. setImmediate must
    // stay REAL — fake-indexeddb (the cross-tab lock backing store) dispatches
    // through it and would never resolve under a faked immediate.
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    try {
      const { result } = renderHook(
        () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.wallet).not.toBeNull());
      const wallet = result.current.wallet;
      if (!wallet) throw new Error('Wallet not initialized');

      // The bolt11 endpoint must NOT be consulted for a bolt12 quote — make it
      // return a contradictory state so a regression fails loudly.
      const bolt11Check = vi.spyOn(wallet, 'checkMeltQuote').mockResolvedValue({ quote: 'bolt12-quote-id', state: 'UNPAID' } as never);
      const bolt12Check = vi.spyOn(wallet, 'checkMeltQuoteBolt12').mockResolvedValue({ quote: 'bolt12-quote-id', state: 'PAID' } as never);

      // An unrelated live crash journal in the shared proof-recovery slot —
      // the poll must NOT clear it when resolving the melt. Written after
      // startup reconcile has run so it isn't merged back as crash recovery.
      const sentinel = { id: 'ks', amount: 7, secret: 'sentinel-secret', C: 'C-sentinel' };
      await writeProofRecovery(mintUrl, [sentinel], encKey);

      // Jump the clock onto the 10s poll interval.
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

      await waitFor(() => expect(bolt12Check).toHaveBeenCalledWith('bolt12-quote-id'));
      expect(bolt11Check).not.toHaveBeenCalled();

      await waitFor(async () => {
        const txs = await loadTransactions(encKey);
        expect(txs.find((t) => t.quoteId === 'bolt12-quote-id')?.status).toBe('completed');
      });

      // Spent journaled inputs removed from the store; the rest untouched.
      const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
      expect(stored.map((p) => p.secret).sort()).toEqual(['secret-a', 'secret-b']);

      // Melt-input journal cleared; the shared slot (and its sentinel) survives.
      expect(await loadMeltInputRecovery(mintUrl, encKey)).toBeNull();
      const shared = await loadProofRecovery(mintUrl, encKey);
      expect(shared?.proofs).toEqual([expect.objectContaining({ secret: 'sentinel-secret' })]);
    } finally {
      vi.useRealTimers();
    }
  }, 15000);
});

describe('useCashuWallet hunt regressions: foreign-locked proof filter in send-recovery reconcile', () => {
  const mintUrl = 'https://mint.example.com';
  // A P2PK lock to a key this wallet does NOT hold.
  const foreignPubkey = 'f'.repeat(64);
  const foreignLockedProof = {
    id: 'ks',
    amount: 50,
    secret: JSON.stringify(['P2PK', foreignPubkey]),
    C: 'C-foreign',
  };
  const bearerProof = { id: 'ks', amount: 30, secret: 'bearer-secret-1', C: 'C-bearer' };

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(validateReceivedProofs).mockReturnValue({ valid: true });
    vi.mocked(CashuWallet).mockImplementation(function () {
      return mocks.createMockWallet();
    });
  });

  it('does NOT merge foreign-locked proofs into the store and keeps the journal untouched', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const encKey = await deriveEncryptionKey(seedPhrase);
    await writeSendRecovery(mintUrl, [foreignLockedProof], encKey);

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    // Give the reconcile effect a chance to run, then assert nothing moved.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
    expect(stored).toEqual([]);
    // Journal left in place as a recovery artifact (someone else's money).
    const journal = await loadSendRecovery(mintUrl, encKey);
    expect(journal).not.toBeNull();
    expect(journal!.proofs).toHaveLength(1);
  });

  it('merges only the spendable (bearer) proofs from a mixed journal', async () => {
    const seedPhrase = generateMnemonic(wordlist);
    const encKey = await deriveEncryptionKey(seedPhrase);
    await writeSendRecovery(mintUrl, [bearerProof, foreignLockedProof], encKey);

    // Reconcile asks the mint for spent-state — report everything UNSPENT,
    // keyed by each proof's real Y.
    const encoder = new TextEncoder();
    vi.mocked(CashuWallet).mockImplementation(function () {
      const w = mocks.createMockWallet();
      w.checkProofsStates = vi.fn().mockImplementation(async (proofs: Array<{ secret: string }>) =>
        proofs.map((p) => ({
          Y: hashToCurve(encoder.encode(String(p.secret))).toHex(true),
          state: 'UNSPENT',
        })),
      );
      return w;
    });

    const { result } = renderHook(
      () => useCashuWallet(seedPhrase, { defaultMints: [{ name: 'Test', url: mintUrl }] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.wallet).not.toBeNull());

    await waitFor(async () => {
      const stored = (await getProofsForMint(mintUrl, encKey)) as Array<{ secret: string }>;
      expect(stored.map((p) => p.secret)).toEqual(['bearer-secret-1']);
    });
    // Journal cleared after the spendable subset was restored.
    expect(await loadSendRecovery(mintUrl, encKey)).toBeNull();
  });
});
