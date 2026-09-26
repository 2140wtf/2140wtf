import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  ESCROW_LEDGER_KIND,
  entryHash,
  foldLedgerEntry,
  genesisPrevHash,
  initialLedgerFold,
  type LedgerEntryContent,
} from '../lib/baoLedger39805';
import { fetchRelayLedger, isGenesisEntry, registrarPinFromConfig, registrarPinFromEnv, summarizeLedger } from './ledgerFeed';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);
const CAMPAIGN = `39801:${'a'.repeat(64)}:solar-coop`;
const HASH = '1'.repeat(64);
const HASH_B = '2'.repeat(64);
const TS = 1_700_000_000;

const mocks = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn() }));

vi.mock('@/baofund/community/websocket.js', () => ({
  WebRelayConn: class {
    query(...args: unknown[]) {
      return mocks.query(...args);
    }
    close() {
      mocks.close();
    }
  },
}));

const contentOf = (ev: NostrEvent): LedgerEntryContent => JSON.parse(ev.content) as LedgerEntryContent;

function signChain(sk: Uint8Array, specs: Array<Partial<LedgerEntryContent> & { type: LedgerEntryContent['type'] }>): NostrEvent[] {
  let prevHash = genesisPrevHash(CAMPAIGN);
  return specs.map((spec, i) => {
    const content: LedgerEntryContent = {
      v: 1,
      seq: i + 1,
      prevHash,
      campaign: CAMPAIGN,
      milestone: null,
      amountSats: null,
      proofSetHash: HASH,
      nullifierRoot: HASH_B,
      externalContributors: null,
      window: null,
      verdict: null,
      registrarEpoch: 1,
      ...spec,
    };
    const ev = finalizeEvent(
      { kind: ESCROW_LEDGER_KIND, created_at: TS + i, tags: [], content: JSON.stringify(content) },
      sk,
    ) as unknown as NostrEvent;
    prevHash = entryHash(ev, content);
    return ev;
  });
}

const PIN = { epoch: 1, pubkey: PUB };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('summarizeLedger', () => {
  it('sums only CONTRIB_LOCK amounts and keeps chain bookkeeping', () => {
    const events = signChain(SK, [
      { type: 'STAKE_LOCK', amountSats: 5000 },
      { type: 'CONTRIB_LOCK', milestone: 'm1', amountSats: 1000, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
      { type: 'CONTRIB_LOCK', milestone: 'm2', amountSats: 2000, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
      { type: 'RELEASE', milestone: 'm2', amountSats: 2000, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
    ]);
    const summary = summarizeLedger(events, PIN).get(CAMPAIGN);
    expect(summary).toBeDefined();
    expect(summary?.raisedSats).toBe(3000);
    expect(summary?.entriesCount).toBe(4);
    expect(summary?.closed).toBe(false);
    expect(summary?.headHash).toBe(entryHash(events[3], contentOf(events[3])));
  });

  it('marks the campaign closed on CLOSE', () => {
    const events = signChain(SK, [
      { type: 'STAKE_LOCK', amountSats: 1 },
      { type: 'CLOSE', amountSats: 0, proofSetHash: null, nullifierRoot: HASH_B, externalContributors: 0 },
    ]);
    expect(summarizeLedger(events, PIN).get(CAMPAIGN)?.closed).toBe(true);
  });

  it('omits campaigns signed by a non-pinned registrar', () => {
    const other = generateSecretKey();
    const events = signChain(other, [{ type: 'STAKE_LOCK', amountSats: 5000 }]);
    expect(summarizeLedger(events, PIN).size).toBe(0);
  });

  it('ignores other kinds and malformed content', () => {
    const good = signChain(SK, [{ type: 'STAKE_LOCK', amountSats: 100 }]);
    const junk = { ...good[0], kind: 1, content: 'not json' } as NostrEvent;
    const summary = summarizeLedger([junk, ...good], PIN).get(CAMPAIGN);
    expect(summary?.entriesCount).toBe(1);
    expect(summary?.raisedSats).toBe(0);
  });

  it('genesis detection accepts entry 1 and rejects a later entry', () => {
    const events = signChain(SK, [
      { type: 'STAKE_LOCK', amountSats: 1 },
      { type: 'STAKE_LOCK', amountSats: 1 },
    ]);
    expect(isGenesisEntry(events[0])).toBe(true);
    expect(isGenesisEntry(events[1])).toBe(false);
  });

  it('genesis detection is false (not a throw) for malformed content', () => {
    const bad = {
      kind: 49305,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      tags: [],
      content: JSON.stringify({ v: 1, campaign: 'not-a-coordinate', seq: 1, prevHash: 'a'.repeat(64) }),
      id: 'f'.repeat(64),
      sig: '0'.repeat(128),
    } as unknown as NostrEvent;
    expect(isGenesisEntry(bad)).toBe(false);
  });

  it('does not count lock amounts from entries the chain fold REJECTED (gap)', () => {
    const events = signChain(SK, [
      { type: 'STAKE_LOCK', amountSats: 5000 },
      { type: 'CONTRIB_LOCK', milestone: 'm1', amountSats: 1000, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
      { type: 'CONTRIB_LOCK', milestone: 'm1', amountSats: 500, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
    ]);
    // The relay withholds seq 2: the seq-3 entry freezes the fold and must
    // not contribute its amount to the "registrar-verified raised" total.
    const summary = summarizeLedger([events[0], events[2]], PIN).get(CAMPAIGN);
    expect(summary?.entriesCount).toBe(1);
    expect(summary?.raisedSats).toBe(0);
  });

  it('counts a replayed entry once (no double-counted totals)', () => {
    const events = signChain(SK, [
      { type: 'STAKE_LOCK', amountSats: 5000 },
      { type: 'CONTRIB_LOCK', milestone: 'm1', amountSats: 1000, externalContributors: 0, window: { disputeEndsUnix: TS, paused: false } },
    ]);
    const replayed = [...events, events[1], events[0]];
    const summary = summarizeLedger(replayed, PIN).get(CAMPAIGN);
    expect(summary?.entriesCount).toBe(2);
    expect(summary?.raisedSats).toBe(1000);
  });
});

describe('fetchRelayLedger', () => {
  it('returns an empty map without querying when no pin is configured', async () => {
    const result = await fetchRelayLedger('wss://relay.invalid', null);
    expect(result.size).toBe(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('queries kind 49305 for the pinned author and summarizes the response', async () => {
    const events = signChain(SK, [{ type: 'STAKE_LOCK', amountSats: 777 }]);
    mocks.query.mockResolvedValue(events);
    const result = await fetchRelayLedger('wss://relay.invalid', PIN);
    expect(mocks.query).toHaveBeenCalledWith({ kinds: [ESCROW_LEDGER_KIND], authors: [PIN.pubkey] }, expect.any(Number));
    expect(result.get(CAMPAIGN)?.entriesCount).toBe(1);
    expect(mocks.close).toHaveBeenCalled();
  });

  it('never throws on relay failure and still closes the connection', async () => {
    mocks.query.mockRejectedValue(new Error('connection refused'));
    await expect(fetchRelayLedger('wss://relay.invalid', PIN)).resolves.toEqual(new Map());
    expect(mocks.close).toHaveBeenCalled();
  });
});

describe('registrarPinFromConfig', () => {
  it('reads a valid pin and accepts a default epoch', () => {
    expect(registrarPinFromConfig(PUB, '1')).toEqual({ epoch: 1, pubkey: PUB.toLowerCase() });
    expect(registrarPinFromConfig(PUB, undefined)).toEqual({ epoch: 1, pubkey: PUB.toLowerCase() });
  });

  it('rejects missing keys, bad hex and bad epochs', () => {
    expect(registrarPinFromConfig(undefined, undefined)).toBeNull();
    expect(registrarPinFromConfig('not-hex', '1')).toBeNull();
    expect(registrarPinFromConfig(PUB, '0')).toBeNull();
    expect(registrarPinFromConfig(PUB, 'nope')).toBeNull();
  });

  it('reads nothing from an unconfigured environment', () => {
    expect(registrarPinFromEnv()).toBeNull();
  });
});

describe('foldLedgerEntry sanity (shared with the reader)', () => {
  it('folds the same chain the reader summarizes', () => {
    const events = signChain(SK, [{ type: 'STAKE_LOCK', amountSats: 10 }]);
    const state = foldLedgerEntry(initialLedgerFold(CAMPAIGN), events[0], {
      campaign: CAMPAIGN,
      registrarEpochs: new Map([[1, PUB]]),
    });
    expect(state.seq).toBe(1);
    expect(state.frozen).toBe(false);
  });
});
