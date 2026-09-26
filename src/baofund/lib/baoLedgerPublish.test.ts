import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  LedgerEntryError,
  entryHash,
  foldLedgerEntry,
  genesisPrevHash,
  initialLedgerFold,
  type LedgerEntryContent,
} from './baoLedger39805';
import { LedgerPublishError, buildLedgerContent, signLedgerChain } from './baoLedgerPublish';

const SK = generateSecretKey();
const PUB = getPublicKey(SK);
const CAMPAIGN = `39801:${'a'.repeat(64)}:solar-coop`;
const HASH = '1'.repeat(64);
const HASH_B = '2'.repeat(64);
const SIGNER = { signEvent: async (e: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(e, SK) as unknown as NostrEvent };
const TS = 1_700_000_000;

const contentOf = (ev: NostrEvent): LedgerEntryContent => JSON.parse(ev.content) as LedgerEntryContent;

const fold = (events: NostrEvent[]) =>
  events.reduce(
    (state, ev) => foldLedgerEntry(state, ev, { campaign: CAMPAIGN, registrarEpochs: new Map([[1, PUB]]) }),
    initialLedgerFold(CAMPAIGN),
  );

describe('signLedgerChain', () => {
  const specs = [
    {
      type: 'STAKE_LOCK' as const,
      registrarEpoch: 1,
      amountSats: 5000,
      proofSetHash: HASH,
      nullifierRoot: HASH_B,
    },
    {
      type: 'CONTRIB_LOCK' as const,
      registrarEpoch: 1,
      milestone: 'm1',
      amountSats: 1000,
      proofSetHash: HASH,
      nullifierRoot: HASH_B,
      externalContributors: 0,
      window: { disputeEndsUnix: TS, paused: false },
    },
    {
      type: 'RELEASE' as const,
      registrarEpoch: 1,
      milestone: 'm1',
      amountSats: 1000,
      proofSetHash: HASH,
      nullifierRoot: HASH_B,
      externalContributors: 2,
      window: { disputeEndsUnix: TS, paused: false },
    },
  ];

  it('builds a gap-free chain that folds under the signer pin', async () => {
    const events = await signLedgerChain(SIGNER, CAMPAIGN, specs, { timestamp: TS });
    expect(events).toHaveLength(3);
    const state = fold(events);
    expect(state.frozen).toBe(false);
    expect(state.seq).toBe(3);
    expect(state.entriesCount).toBe(3);
    expect(state.runningSats).toBe(5000);
    expect(state.closed).toBe(false);
  });

  it('anchors genesis and links each prevHash to the previous envelope hash', async () => {
    const events = await signLedgerChain(SIGNER, CAMPAIGN, specs, { timestamp: TS });
    const [first, second] = events;
    expect(contentOf(first).prevHash).toBe(genesisPrevHash(CAMPAIGN));
    expect(second.created_at).toBe(TS + 1);
    expect(contentOf(second).prevHash).toBe(entryHash(first, contentOf(first)));
  });

  it('omits the d tag and defaults unset matrix fields to null/zero', async () => {
    const events = await signLedgerChain(SIGNER, CAMPAIGN, specs, { timestamp: TS });
    expect(events.every((ev) => !ev.tags.some((t) => t[0] === 'd'))).toBe(true);
    const stake = contentOf(events[0]);
    expect(stake.milestone).toBeNull();
    expect(stake.externalContributors).toBeNull();
    expect(stake.window).toBeNull();
    expect(stake.verdict).toBeNull();
  });

  it('renders the DISPUTE amount as exactly 0', () => {
    const content = buildLedgerContent(
      { type: 'DISPUTE_OPEN', registrarEpoch: 1, milestone: 'm1', nullifierRoot: HASH_B, window: { disputeEndsUnix: 0, paused: false } },
      { campaign: CAMPAIGN, seq: 4, prevHash: HASH },
    );
    expect(content.amountSats).toBe(0);
    expect(content.proofSetHash).toBeNull();
  });

  it('rejects missing required fields and values where null is mandated', async () => {
    await expect(
      signLedgerChain(SIGNER, CAMPAIGN, [{ type: 'CONTRIB_LOCK', registrarEpoch: 1, milestone: 'm1', amountSats: 1 }], { timestamp: TS }),
    ).rejects.toBeInstanceOf(LedgerPublishError);
    await expect(
      signLedgerChain(SIGNER, CAMPAIGN, [{ type: 'STAKE_LOCK', registrarEpoch: 1, milestone: 'm1', amountSats: 1, proofSetHash: HASH, nullifierRoot: HASH_B }], { timestamp: TS }),
    ).rejects.toMatchObject({ code: 'ledger_matrix_null' });
  });

  it('a chain signed by another key is unauthorized under the pin', async () => {
    const events = await signLedgerChain(SIGNER, CAMPAIGN, specs, { timestamp: TS });
    const otherPub = getPublicKey(generateSecretKey());
    expect(() =>
      events.reduce(
        (state, ev) => foldLedgerEntry(state, ev, { campaign: CAMPAIGN, registrarEpochs: new Map([[1, otherPub]]) }),
        initialLedgerFold(CAMPAIGN),
      ),
    ).toThrow(LedgerEntryError);
  });
});
