import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  hashRef, parseHashRef, parseNostrHex, validateHashRefField, HashRefError, HASHREF_FIELD_TABLE,
} from './hashRef';
import {
  issueCampaignRef, resolveCampaignRef, campaignRefGenesisHead, type CampaignRef,
} from './campaignRef';
import {
  ESCROW_LEDGER_KIND, genesisPrevHash, initialLedgerFold, foldLedgerEntry, validateLedgerEntry,
  entryHash, type LedgerEntryContent, type LedgerEvent,
} from './baoLedger39805';

// ── B4: the single-spelling hash-ref contract ──────────────────────────────

describe('hashRef (B4): bl3hex: is the single spelling', () => {
  it('writer emits the prefix; strict parse accepts it', () => {
    const hex = 'a'.repeat(64);
    expect(hashRef(hex)).toBe(`bl3hex:${hex}`);
    const parsed = parseHashRef(hashRef(hex), 'proofSetHash');
    expect(parsed).toEqual({ hex, legacyAccepted: false });
  });

  it('bare hex is a parse error in strict mode, accepted+flagged in the legacy window', () => {
    const hex = 'b'.repeat(64);
    expect(() => parseHashRef(hex, 'f')).toThrow(HashRefError);
    expect(parseHashRef(hex, 'f', { legacy: true })).toEqual({ hex, legacyAccepted: true });
  });

  it('0x form is ALWAYS a parse error (never an alternate spelling)', () => {
    expect(() => parseHashRef(`0x${'c'.repeat(64)}`, 'f')).toThrow(/0x is a parse error/);
    expect(() => parseHashRef(`0x${'c'.repeat(64)}`, 'f', { legacy: true })).toThrow(HashRefError);
  });

  it('malformed payloads fail typed', () => {
    expect(() => parseHashRef('bl3hex:zz', 'f')).toThrow(/64 lowercase hex/);
    expect(() => parseHashRef(123, 'f')).toThrow(/must be a bl3hex: string/);
    expect(() => parseHashRef(`bl3hex:${'A'.repeat(64)}`, 'f')).toThrow(/64 lowercase hex/); // uppercase rejected
  });

  it('Nostr ids/pubkeys FORBID the prefix (B4 correction)', () => {
    const id = 'e'.repeat(64);
    expect(parseNostrHex(id, 'event_id')).toBe(id);
    expect(() => parseNostrHex(`bl3hex:${id}`, 'event_id')).toThrow(/forbidden/);
    expect(() => validateHashRefField(1, 'verdict.id', `bl3hex:${id}`)).toThrow(/forbidden/);
    expect(() => validateHashRefField(1, 'campaign', `bl3hex:${id}`)).toThrow(/forbidden/);
  });

  it('field table pins schema v1 fields and fails closed on unknown versions', () => {
    expect(HASHREF_FIELD_TABLE[1].proofSetHash).toBe('hashref');
    expect(HASHREF_FIELD_TABLE[1]['verdict.id']).toBe('nostr-hex');
    expect(() => validateHashRefField(9, 'proofSetHash', hashRef('1'.repeat(64)))).toThrow(/fail closed/);
  });
});

describe('ledger × hashRef integration (B4 on the 49305 path)', () => {
  const SK = generateSecretKey();
  const PK = getPublicKey(SK);
  const CAMPAIGN = `39801:${PK}:bridge`;
  const mk = (content: Record<string, unknown>): LedgerEvent =>
    finalizeEvent({ kind: ESCROW_LEDGER_KIND, created_at: 1_700_000_000, tags: [], content: JSON.stringify(content) }, SK);
  const base = {
    v: 1, seq: 1, prevHash: genesisPrevHash(CAMPAIGN), campaign: CAMPAIGN, type: 'STAKE_LOCK',
    milestone: null, amountSats: 1000, nullifierRoot: 'c'.repeat(64), externalContributors: null,
    window: null, verdict: null, registrarEpoch: 0,
  };

  it('accepts the cutover bl3hex: spelling and normalizes to hex for hashing', () => {
    const ev = mk({ ...base, proofSetHash: hashRef('b'.repeat(64)) });
    const c = validateLedgerEntry(ev);
    expect(c.proofSetHash).toBe('b'.repeat(64)); // normalized - hashing unchanged
  });

  it('accepts legacy bare hex (transition window) identically', () => {
    // Same content hex value, two spellings → after normalization the
    // VALIDATED CONTENT matches byte-for-byte; the envelope hash differs
    // (raw content bytes differ → different event id), so compare fields.
    const a = validateLedgerEntry(mk({ ...base, proofSetHash: 'b'.repeat(64) }));
    const b = validateLedgerEntry(mk({ ...base, proofSetHash: hashRef('b'.repeat(64)) }));
    expect(b.proofSetHash).toBe(a.proofSetHash); // both normalize to the same hex
    expect(entryHash(mk({ ...base, proofSetHash: 'b'.repeat(64) }), a))
      .toBe(entryHash(mk({ ...base, proofSetHash: 'b'.repeat(64) }), validateLedgerEntry(mk({ ...base, proofSetHash: 'b'.repeat(64) }))));
  });

  it('rejects 0x and malformed bl3hex: on the 49305 path', () => {
    expect(() => validateLedgerEntry(mk({ ...base, proofSetHash: `0x${'b'.repeat(64)}` }))).toThrow(/0x/);
    expect(() => validateLedgerEntry(mk({ ...base, proofSetHash: 'bl3hex:nope' }))).toThrow(/64 lowercase hex/);
  });
});

// ── CampaignRef: six-way binding, disagreement ⇒ no mutation ───────────────

describe('CampaignRef (§11.1): binds coordinate/registrar/card/schema/origin/head', () => {
  const SK = generateSecretKey();
  const PK = getPublicKey(SK);
  const CAMPAIGN = `39801:${PK}:bridge`;
  const CARD_ID = 'f'.repeat(64);
  const ORIGIN = 'https://fund-api.example';
  const authority = { campaign: CAMPAIGN, registrarEpochs: new Map([[0, PK]]) };

  let counter = 0;
  const mkEntry = (over: Partial<LedgerEntryContent> & { seq: number; type: LedgerEntryContent['type'] }): LedgerEvent => {
    counter += 1;
    const full: LedgerEntryContent = {
      v: 1, seq: over.seq, prevHash: over.prevHash ?? genesisPrevHash(CAMPAIGN), campaign: CAMPAIGN,
      type: over.type, milestone: over.milestone ?? (over.type === 'STAKE_LOCK' ? null : 'm1'),
      amountSats: over.amountSats ?? 21_000, proofSetHash: over.proofSetHash ?? 'b'.repeat(64),
      nullifierRoot: 'c'.repeat(64), externalContributors: over.externalContributors ?? (over.type === 'ROTATION' ? 3 : over.type === 'STAKE_LOCK' ? null : 3),
      window: over.window ?? (over.type === 'STAKE_LOCK' ? null : { disputeEndsUnix: 1_900_000_000, paused: false }),
      verdict: over.verdict ?? null, registrarEpoch: 0,
    };
    return finalizeEvent({ kind: ESCROW_LEDGER_KIND, created_at: 1_700_000_000 + counter, tags: [], content: JSON.stringify(full) }, SK);
  };

  const REF: CampaignRef = issueCampaignRef({
    campaign: CAMPAIGN, registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN,
  });

  it('issuance validates every binding shape', () => {
    expect(() => issueCampaignRef({ campaign: 'bridge', registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN })).toThrow(/a-coordinate/);
    expect(() => issueCampaignRef({ campaign: CAMPAIGN, registrarKey: `bl3hex:${PK}`, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN })).toThrow(/bl3hex: forbidden|raw 64-hex/);
    expect(() => issueCampaignRef({ campaign: CAMPAIGN, registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: 'http://insecure' })).toThrow(/https/);
    expect(() => issueCampaignRef({ campaign: CAMPAIGN, registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN, expectedHead: 'zz' })).toThrow(/64-hex/);
  });

  it('resolves clean: two-entry ledger lands on the fold head', () => {
    const e1 = mkEntry({ seq: 1, type: 'STAKE_LOCK' });
    const c1 = validateLedgerEntry(e1);
    const e2 = mkEntry({ seq: 2, type: 'CONTRIB_LOCK', prevHash: entryHash(e1, c1) });
    const c2 = validateLedgerEntry(e2);
    const e3 = mkEntry({ seq: 3, type: 'RELEASE', prevHash: entryHash(e2, c2) });
    const head = entryHash(e3, validateLedgerEntry(e3));
    const r = resolveCampaignRef(REF, { cardEventId: CARD_ID, ledgerEvents: [e1, e2, e3] });
    expect(r.verdict).toBe('resolved');
    if (r.verdict === 'resolved') {
      expect(r.head).toBe(head);
      expect(r.entriesCount).toBe(3);
    }
  });

  it('conflicts when an event belongs to a DIFFERENT campaign coordinate', () => {
    const otherSK = generateSecretKey();
    const other = `39801:${getPublicKey(otherSK)}:other`;
    const foreign = finalizeEvent({
      kind: ESCROW_LEDGER_KIND, created_at: 1_700_000_001, tags: [],
      content: JSON.stringify({ ...JSON.parse(mkEntry({ seq: 1, type: 'STAKE_LOCK' }).content), campaign: other }),
    }, SK);
    const r = resolveCampaignRef(REF, { cardEventId: CARD_ID, ledgerEvents: [foreign] });
    expect(r.verdict).toBe('conflicted');
  });

  it('conflicts on schema-version disagreement', () => {
    const mutated = JSON.parse(mkEntry({ seq: 1, type: 'STAKE_LOCK' }).content);
    mutated.v = 2;
    const ev = finalizeEvent({ kind: ESCROW_LEDGER_KIND, created_at: 1_700_000_002, tags: [], content: JSON.stringify(mutated) }, SK);
    const r = resolveCampaignRef(REF, { cardEventId: CARD_ID, ledgerEvents: [ev] });
    expect(r.verdict).toBe('conflicted');
    if (r.verdict === 'conflicted') expect(r.reason).toMatch(/schema|content\.v/);
  });

  it('conflicts when the head disagrees with the pinned expectedHead', () => {
    const e1 = mkEntry({ seq: 1, type: 'STAKE_LOCK' });
    const ref = issueCampaignRef({
      campaign: CAMPAIGN, registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN,
      expectedHead: '9'.repeat(64), // pinned head that the ledger will NOT reach
    });
    const r = resolveCampaignRef(ref, { cardEventId: CARD_ID, ledgerEvents: [e1] });
    expect(r.verdict).toBe('conflicted');
    if (r.verdict === 'conflicted') expect(r.reason).toContain('≠ expected');
  });

  it('unavailable with no events; conflicted on forged signature', () => {
    const empty = resolveCampaignRef(REF, { cardEventId: CARD_ID, ledgerEvents: [] });
    expect(empty.verdict).toBe('unavailable');
    const forged = finalizeEvent(JSON.parse(JSON.stringify({ ...mkEntry({ seq: 1, type: 'STAKE_LOCK' }), sig: undefined })), generateSecretKey());
    const r = resolveCampaignRef(REF, { cardEventId: CARD_ID, ledgerEvents: [forged] });
    expect(r.verdict).toBe('conflicted');
  });

  it('genesis head helper matches the fold’s genesis', () => {
    expect(campaignRefGenesisHead(CAMPAIGN)).toBe(genesisPrevHash(CAMPAIGN));
    const ref = issueCampaignRef({ campaign: CAMPAIGN, registrarKey: PK, registrarEpoch: 0, cardEventId: CARD_ID, fundOrigin: ORIGIN, expectedHead: campaignRefGenesisHead(CAMPAIGN) });
    // An empty ledger cannot be resolved (unavailable) - head pinning for
    // empty campaigns is exercised once the first entry lands.
    expect(resolveCampaignRef(ref, { cardEventId: CARD_ID, ledgerEvents: [] }).verdict).toBe('unavailable');
    void authority; void initialLedgerFold; void foldLedgerEntry;
  });
});
