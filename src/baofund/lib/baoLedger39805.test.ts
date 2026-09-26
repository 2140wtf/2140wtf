import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  ESCROW_LEDGER_KIND,
  LedgerEntryError,
  detectFork,
  entryHash,
  foldLedgerEntry as foldWithAuthority,
  genesisPrevHash,
  initialLedgerFold,
  validateLedgerEntry,
  type LedgerEntryContent,
  type LedgerEvent,
} from './baoLedger39805';
import { canonicalJson } from './baoLedger';

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const CAMPAIGN = `39801:${PK}:bridge`;
const GENESIS = genesisPrevHash(CAMPAIGN);
const authority = { campaign: CAMPAIGN, registrarEpochs: new Map([[0, PK]]) };
const foldLedgerEntry = (s: ReturnType<typeof initialLedgerFold>, e: LedgerEvent) => foldWithAuthority(s, e, authority);

let counter = 0;
// Milestone defaults follow the §5.6 matrix req rows: CONTRIB_LOCK, RELEASE,
// DISPUTE_OPEN, DISPUTE_RESOLVED carry a milestone; the rest must be null.
const MILESTONE_REQ: ReadonlySet<LedgerEntryContent['type']> = new Set(['CONTRIB_LOCK', 'RELEASE', 'DISPUTE_OPEN', 'DISPUTE_RESOLVED']);
function makeEvent(content: Partial<LedgerEntryContent> & { seq: number; type: LedgerEntryContent['type'] }, over: Partial<LedgerEvent> = {}): LedgerEvent {
  counter += 1;
  const full: LedgerEntryContent = {
    v: 1,
    seq: content.seq,
    prevHash: content.prevHash ?? GENESIS,
    campaign: content.campaign ?? CAMPAIGN,
    type: content.type,
    milestone: 'milestone' in content ? (content.milestone as string | null) : (MILESTONE_REQ.has(content.type) ? 'm1' : null),
    amountSats: content.amountSats ?? (content.type === 'DISPUTE_OPEN' ? 0 : content.type === 'ROTATION' ? null : 21_000),
    proofSetHash: content.proofSetHash ?? (['STAKE_LOCK', 'CONTRIB_LOCK', 'RELEASE', 'REFUND_ALL'].includes(content.type) ? 'b'.repeat(64) : null),
    nullifierRoot: content.nullifierRoot ?? 'c'.repeat(64),
    externalContributors: content.externalContributors ?? (['CONTRIB_LOCK', 'RELEASE', 'CLOSE'].includes(content.type) ? 3 : content.type === 'ROTATION' ? 3 : null),
    window: content.window ?? (['CONTRIB_LOCK', 'RELEASE', 'DISPUTE_OPEN', 'DISPUTE_RESOLVED'].includes(content.type) ? { disputeEndsUnix: 1_900_000_000, paused: false } : null),
    verdict: 'verdict' in content ? (content.verdict as LedgerEntryContent['verdict']) : (content.type === 'DISPUTE_RESOLVED' ? { id: 'd1', hash: 'd'.repeat(64), courtSigHint: '', final: true } : null),
    registrarEpoch: content.registrarEpoch ?? 0,
  };
  return finalizeEvent({
    kind: ESCROW_LEDGER_KIND,
    created_at: 1_700_000_000 + counter,
    tags: [],
    content: JSON.stringify(full),
    ...over,
  }, SK);
}

describe('genesis + envelope hashing (§5.6 amend 4)', () => {
  it('genesis prevHash = blake3 of the campaign a-coordinate', () => {
    expect(GENESIS).toMatch(/^[0-9a-f]{64}$/);
    expect(genesisPrevHash(CAMPAIGN)).toBe(genesisPrevHash(CAMPAIGN.toLowerCase()));
  });
  it('rejects bare slugs as genesis preimage', () => {
    expect(() => genesisPrevHash('bridge')).toThrow(LedgerEntryError);
  });
  it('entryHash covers seq, created_at, event_id, content (canonical bytes)', () => {
    const ev = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const c = validateLedgerEntry(ev);
    const h1 = entryHash(ev, c);
    const expectH = bytesToHex(
      blake3(new TextEncoder().encode(canonicalJson({ seq: c.seq, created_at: ev.created_at, event_id: ev.id, content: c }))),
    );
    expect(h1).toBe(expectH);
  });
  it('entryHash binds event_id (same content, different id → different hash)', () => {
    const a = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const b = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const ca = validateLedgerEntry(a);
    const cb = validateLedgerEntry(b);
    expect(entryHash(a, ca)).not.toBe(entryHash(b, cb));
  });
});

describe('validateLedgerEntry - per-type field matrix (§5.6 build gate)', () => {
  it('accepts a well-formed STAKE_LOCK', () => {
    const c = validateLedgerEntry(makeEvent({ seq: 1, type: 'STAKE_LOCK' }));
    expect(c.amountSats).toBe(21_000);
    expect(c.milestone).toBeNull(); // matrix: null for STAKE_LOCK
  });
  it('rejects CONTRIB_LOCK without milestone (matrix req)', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'CONTRIB_LOCK', milestone: null }))).toThrow(/milestone is required/);
  });
  it('rejects STAKE_LOCK carrying a milestone (matrix null)', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'STAKE_LOCK', milestone: 'm1' }))).toThrow(/must be null/);
  });
  it('rejects DISPUTE_OPEN with nonzero amountSats (matrix: exactly 0)', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'DISPUTE_OPEN', amountSats: 5 }))).toThrow(/exactly 0/);
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'DISPUTE_RESOLVED', amountSats: 1 }))).toThrow(/exactly 0/);
    // 0 itself is VALID (amend 6: zero is a valid SET value)
    expect(validateLedgerEntry(makeEvent({ seq: 1, type: 'DISPUTE_OPEN', amountSats: 0 })).amountSats).toBe(0);
  });
  it('rejects DISPUTE_RESOLVED without a verdict', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'DISPUTE_RESOLVED', amountSats: 0, verdict: null }))).toThrow(/verdict is required/);
  });
  it('rejects a d tag (parameterized-replaceable forbidden on 49305)', () => {
    const ev = makeEvent({ seq: 1, type: 'STAKE_LOCK' }, { tags: [['d', 'nope']] });
    expect(() => validateLedgerEntry(ev)).toThrow(/d tag/);
  });
  it('rejects non-integer / zero seq', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 0, type: 'STAKE_LOCK' }))).toThrow(/seq/);
    expect(() => validateLedgerEntry(makeEvent({ seq: 2.5, type: 'STAKE_LOCK' }))).toThrow(/seq/);
  });
  it('rejects bad campaign coordinates and unknown types', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'STAKE_LOCK', campaign: 'bridge' }))).toThrow(/a-coordinate/);
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'STAKE_LOCK' }, { content: JSON.stringify({ v: 1, seq: 1, type: 'MINT_ALL', campaign: CAMPAIGN }) }))).toThrow(/type/);
  });
  it('rejects unparseable content', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'STAKE_LOCK' }, { content: '{nope' }))).toThrow(/unparseable|JSON/);
  });
  it('rejects float amounts (sats are integers)', () => {
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'CONTRIB_LOCK', amountSats: 10.5 }))).toThrow(/amountSats/);
  });
});

describe('foldLedgerEntry - gap-free chain (amend 1/3)', () => {
  it('folds entries in seq order and accumulates runningSats', () => {
    let s = initialLedgerFold(CAMPAIGN);
    const e1 = makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: 50_000 });
    // chain e2 onto e1's envelope hash
    const c1 = validateLedgerEntry(e1);
    const e2 = makeEvent({ seq: 2, type: 'CONTRIB_LOCK', amountSats: 21_000, prevHash: entryHash(e1, c1) });
    s = foldLedgerEntry(foldLedgerEntry(s, e1), e2);
    expect(s.seq).toBe(2);
    expect(s.runningSats).toBe(71_000);
    expect(s.frozen).toBe(false);
  });
  it('freezes on a seq gap', () => {
    let s = initialLedgerFold(CAMPAIGN);
    s = foldLedgerEntry(s, makeEvent({ seq: 1, type: 'STAKE_LOCK' }));
    expect(foldLedgerEntry(s, makeEvent({ seq: 3, type: 'STAKE_LOCK' })).frozen).toBe('seq_gap');
  });
  it('freezes the campaign on a broken prevHash link (fail-closed forever)', () => {
    let s = initialLedgerFold(CAMPAIGN);
    s = foldLedgerEntry(s, makeEvent({ seq: 1, type: 'STAKE_LOCK' }));
    const broken = makeEvent({ seq: 2, type: 'CONTRIB_LOCK', prevHash: 'f'.repeat(64) });
    const s2 = foldLedgerEntry(s, broken);
    expect(s2.frozen).toBe('chain_broken');
    // frozen is forever - further entries are ignored, not re-evaluated
    const more = foldLedgerEntry(s2, makeEvent({ seq: 3, type: 'RELEASE', prevHash: entryHash(broken, validateLedgerEntry(broken)) }));
    expect(more.frozen).toBe('chain_broken');
    expect(more.entriesCount).toBe(s2.entriesCount);
  });
  it('REFUND_ALL/RELEASE amounts subtract from the running total', () => {
    let s = initialLedgerFold(CAMPAIGN);
    const e1 = makeEvent({ seq: 1, type: 'CONTRIB_LOCK', milestone: 'm1', amountSats: 21_000 });
    s = foldLedgerEntry(s, e1);
    const e2 = makeEvent({ seq: 2, type: 'RELEASE', milestone: 'm1', amountSats: 21_000, prevHash: entryHash(e1, validateLedgerEntry(e1)) });
    s = foldLedgerEntry(s, e2);
    expect(s.runningSats).toBe(0);
  });
  it('entries for a different campaign are rejected at the fold', () => {
    const s = initialLedgerFold(CAMPAIGN);
    expect(() => foldLedgerEntry(s, makeEvent({ seq: 1, type: 'STAKE_LOCK', campaign: `39801:${PK}:other` }))).toThrow(/campaign/);
  });
});

describe('fork detection (amend 2)', () => {
  it('two valid chains at the same seq with different heads = fork', () => {
    const a = foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: 1 }));
    // chain B: same seq, different event id → different envelope hash → fork
    const b = foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: 1 }));
    expect(a.seq).toBe(b.seq);
    expect(a.headHash).not.toBe(b.headHash);
    expect(detectFork(a, b)).toBe(true);
  });
  it('honest continuation is not a fork', () => {
    const e1 = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const a = foldLedgerEntry(initialLedgerFold(CAMPAIGN), e1);
    const b = foldLedgerEntry(a, makeEvent({ seq: 2, type: 'CONTRIB_LOCK', prevHash: a.headHash }));
    expect(detectFork(a, b)).toBe(false);
  });
  it('genesis states (seq 0) never fork', () => {
    expect(detectFork(initialLedgerFold(CAMPAIGN), initialLedgerFold(CAMPAIGN))).toBe(false);
  });
});

describe('kind constant', () => {
  it('49305 is the escrow ledger kind per spec §2', () => {
    expect(ESCROW_LEDGER_KIND).toBe(49305);
  });
});


describe('ledger trust and structural boundaries', () => {
  it('rejects missing authority, wrong registrar, wrong kind and mutation after verification', () => {
    const e = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const initial = initialLedgerFold(CAMPAIGN);
    expect(() => foldWithAuthority(initial, e)).toThrow(/not pinned/);
    const forged = finalizeEvent(e, generateSecretKey());
    expect(() => foldLedgerEntry(initial, forged)).toThrow(/not pinned/);
    expect(() => foldLedgerEntry(initial, finalizeEvent({ ...e, kind: 1 }, SK))).toThrow(/signed ledger/);
    expect(verifyEvent(e)).toBe(true); e.content += ' ';
    expect(() => foldLedgerEntry(initial, e)).toThrow(/signed ledger/);
  });
  it.each([
    { nullifierRoot: 123 }, { externalContributors: -1 }, { externalContributors: 1.5 },
    { milestone: {} }, { window: { disputeEndsUnix: -1, paused: false } },
    { window: { disputeEndsUnix: 1.5, paused: false } }, { window: [] },
  ])('rejects malformed set fields %j', over => {
    const e = makeEvent({ seq: 1, type: 'CONTRIB_LOCK' });
    const changed = { ...e, content: JSON.stringify({ ...JSON.parse(e.content), ...over }) };
    expect(() => validateLedgerEntry(changed)).toThrow(LedgerEntryError);
  });
  it('requires explicit null and complete verdict fields', () => {
    const e = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const c = JSON.parse(e.content); delete c.milestone;
    expect(() => validateLedgerEntry({ ...e, content: JSON.stringify(c) })).toThrow(/explicitly/);
    expect(() => validateLedgerEntry(makeEvent({ seq: 1, type: 'DISPUTE_RESOLVED', amountSats: 0,
      verdict: { id: 'v', final: true } as never }))).toThrow(/verdict/);
  });
  it('does not count CLOSE cumulative amount as fresh funds and rejects continuation', () => {
    let s = foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: 10 }));
    s = foldLedgerEntry(s, makeEvent({ seq: 2, type: 'CLOSE', amountSats: 10, prevHash: s.headHash }));
    expect(s.runningSats).toBe(10); expect(s.closed).toBe(true);
    expect(() => foldLedgerEntry(s, makeEvent({ seq: 3, type: 'STAKE_LOCK', prevHash: s.headHash }))).toThrow(/closed/);
  });
  it('freezes overflow and negative balances without accepting the entry', () => {
    const s = foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: Number.MAX_SAFE_INTEGER }));
    const overflow = foldLedgerEntry(s, makeEvent({ seq: 2, type: 'STAKE_LOCK', amountSats: 1, prevHash: s.headHash }));
    expect(overflow.frozen).toBe('invalid_balance'); expect(overflow.seq).toBe(1);
    expect(foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'RELEASE' })).frozen).toBe('invalid_balance');
  });
  it('deduplicates exact replay and freezes a conflicting signed ancestor', () => {
    const e = makeEvent({ seq: 1, type: 'STAKE_LOCK' });
    const s = foldLedgerEntry(initialLedgerFold(CAMPAIGN), e);
    expect(foldLedgerEntry(s, e)).toBe(s);
    const conflict = makeEvent({ seq: 1, type: 'STAKE_LOCK', amountSats: 1 });
    expect(foldLedgerEntry(s, conflict).frozen).toBe('chain_forked');
    const longer = foldLedgerEntry(s, makeEvent({ seq: 2, type: 'STAKE_LOCK', prevHash: s.headHash }));
    const other = foldLedgerEntry(initialLedgerFold(CAMPAIGN), conflict);
    expect(detectFork(longer, other)).toBe(true);
  });
  it('refuses rotation without a pin grant (B7a: authorization is mandatory, not optional)', () => {
    expect(() => foldLedgerEntry(initialLedgerFold(CAMPAIGN), makeEvent({ seq: 1, type: 'ROTATION' }))).toThrow(/pin grant/);
  });
});

// ── B7a registrar rotation (owner-resolved contract, 2026-09-11) ────────────

import { schnorr } from '@noble/curves/secp256k1.js';
import { canonicalJson as cj } from './baoLedger';

const OLD_SK = generateSecretKey();
const OLD_PK = getPublicKey(OLD_SK);
const NEW_SK = generateSecretKey();
const NEW_PK = getPublicKey(NEW_SK);
const CAMPAIGN2 = `39801:${OLD_PK}:rot`;
const authority2 = { campaign: CAMPAIGN2, registrarEpochs: new Map([[0, OLD_PK], [1, NEW_PK]]) };

/** Build a signed pin grant. Signed by the OLD key over canonical JSON. */
function makeGrant(over: Partial<Record<string, unknown>> = {}, signer = OLD_SK): Record<string, unknown> {
  const g: Record<string, unknown> = {
    kind: 'bao/concord/registrar-pin-grant',
    v: 1,
    campaign: CAMPAIGN2,
    fromEpoch: 0,
    toEpoch: 1,
    toPubkey: NEW_PK,
    fromSeq: 1,
    expiresAtUnix: 1_900_000_000,
    ...over,
  };
  const sig = schnorr.sign(blake3(new TextEncoder().encode(cj(g))), signer);
  return { ...g, sig: bytesToHex(sig) };
}

/** Ledger entry signed by an arbitrary key (the fixture makeEvent pins SK). */
function eventFrom(sk: Uint8Array, content: Partial<LedgerEntryContent> & { seq: number; type: LedgerEntryContent['type'] }): LedgerEvent {
  counter += 1;
  const full: LedgerEntryContent = {
    v: 1,
    seq: content.seq,
    prevHash: content.prevHash ?? genesisPrevHash(CAMPAIGN2),
    campaign: content.campaign ?? CAMPAIGN2,
    type: content.type,
    milestone: content.milestone ?? null,
    amountSats: content.amountSats ?? null,
    proofSetHash: content.proofSetHash ?? null,
    nullifierRoot: content.nullifierRoot ?? 'c'.repeat(64),
    externalContributors: content.externalContributors ?? null,
    window: content.window ?? null,
    verdict: content.verdict ?? null,
    registrarEpoch: content.registrarEpoch ?? 0,
  };
  return finalizeEvent({ kind: ESCROW_LEDGER_KIND, created_at: 1_700_000_000 + counter, tags: [], content: JSON.stringify(full) }, sk as Parameters<typeof finalizeEvent>[1]);
}

/** A valid ROTATION entry signed by the OUTGOING (old) key. */
function rotEvent(seq: number, prevHash?: string, epoch = 0): LedgerEvent {
  return eventFrom(OLD_SK, {
    seq, type: 'ROTATION', campaign: CAMPAIGN2, registrarEpoch: epoch,
    prevHash: prevHash ?? genesisPrevHash(CAMPAIGN2),
    externalContributors: 3,
  });
}
const rotAuthority = { ...authority2, campaign: CAMPAIGN2, registrarEpochs: new Map([[0, OLD_PK], [1, NEW_PK]]) };

describe('B7a registrar rotation', () => {
  it('happy path: verified grant consumed, new key signs the next entry', () => {
    const grant = makeGrant({ fromSeq: 1 });
    const st1 = foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant } });
    expect(st1.frozen).toBe(false);
    expect(st1.pinGrants.get(1)?.toPubkey).toBe(NEW_PK);
    expect(st1.runningSats).toBe(0);
    // Next entry signed by the NEW key under epoch 1 is authorized.
    const next = eventFrom(NEW_SK, { seq: 2, type: 'STAKE_LOCK', registrarEpoch: 1, prevHash: st1.headHash, amountSats: 1_000, milestone: null, proofSetHash: 'b'.repeat(64), nullifierRoot: 'c'.repeat(64) });
    const st2 = foldWithAuthority(st1, next, rotAuthority);
    expect(st2.seq).toBe(2);
    expect(st2.frozen).toBe(false);
  });

  it('old key cannot sign after the handover seq even with its pin configured', () => {
    const grant = makeGrant({ fromSeq: 1 });
    const st1 = foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant } });
    // Old key (epoch 0 pin still in the map) signs seq 2 → must be refused.
    const late = eventFrom(OLD_SK, { seq: 2, type: 'STAKE_LOCK', registrarEpoch: 0, prevHash: st1.headHash, amountSats: 1_000, milestone: null, proofSetHash: 'b'.repeat(64), nullifierRoot: 'c'.repeat(64) });
    expect(() => foldWithAuthority(st1, late, rotAuthority)).toThrow(/rotated out/);
  });

  it('grant signed by any key other than the outgoing pinned key is rejected', () => {
    const forged = makeGrant({}, NEW_SK); // self-authorization attempt
    expect(() =>
      foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant: forged } }),
    ).toThrow(/does not verify/);
  });

  it('grant for the wrong seq window or epoch chain is rejected', () => {
    expect(() =>
      foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant: makeGrant({ fromSeq: 2 }) } }),
    ).toThrow(/fromSeq/);
    expect(() =>
      foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant: makeGrant({ fromEpoch: 1, toEpoch: 2 }) } }),
    ).toThrow(/chain epoch/);
  });

  it('expired grant is rejected (injected clock)', () => {
    const stale = makeGrant({ expiresAtUnix: 1_600_000_000 });
    expect(() =>
      foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant: stale } }),
    ).toThrow(/expired/);
  });

  it('a grant cannot be consumed twice (one grant per epoch, forever)', () => {
    const grant = makeGrant({ fromSeq: 1 });
    const st1 = foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant } });
    // Second ROTATION at seq 2 for the same epoch pair must be refused.
    const again = rotEvent(2, st1.headHash);
    expect(() => foldWithAuthority(st1, again, { ...rotAuthority, pinGrant: { grant: makeGrant({ fromSeq: 2 }) } })).toThrow(/rotated out/);
  });

  it('tampered grant payload breaks the signature', () => {
    const grant = makeGrant({ fromSeq: 1 });
    const tampered = { ...grant, toPubkey: NEW_PK === PK ? OLD_PK : PK } as Record<string, unknown>;
    expect(() =>
      foldWithAuthority(initialLedgerFold(CAMPAIGN2), rotEvent(1), { ...rotAuthority, pinGrant: { grant: tampered } }),
    ).toThrow(/does not verify/);
  });
});
