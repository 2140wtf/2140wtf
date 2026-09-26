/**
 * S6 fold tests - jurorVote (COURT-GUI-WIRING-DESIGN.md §2 S6).
 *
 * Fixtures are REAL signed events: the vendor's buildVoteCommitEvent /
 * buildVoteRevealEvent produce the templates and finalizeEvent signs them,
 * so the verify-before-parse gate and the vendor hashCommit/tallyVotes math
 * are exercised end-to-end (not mocked).
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/curves/utils.js';
import {
  buildVoteCommitEvent,
  buildVoteRevealEvent,
} from '@/baofund/court-core/events.js';
import { hashCommit } from '@/baofund/court-core/dispute.js';
import {
  foldVotes,
  parseCommitEvent,
  parseRevealEvent,
  revealWindow,
  votesFilter,
  commitTemplate,
  revealTemplate,
  type CourtEvent,
} from './jurorVote';

const DISPUTE = 'b'.repeat(64);
const NOW = 1_700_000_500;
const DEADLINE = 1_700_000_400; // commit phase ends before `now`

function signCommit(opts: {
  seckey?: Uint8Array;
  jurorIdx?: number;
  outcome?: string;
  salt?: string;
  disputeId?: string;
  createdAt?: number;
}): { event: CourtEvent; seckey: Uint8Array; commitHash: string } {
  const seckey = opts.seckey ?? generateSecretKey();
  const outcome = opts.outcome ?? 'challenger';
  const salt = opts.salt ?? bytesToHex(generateSecretKey());
  const commitHash = hashCommit(outcome, salt);
  const template = buildVoteCommitEvent({
    disputeId: opts.disputeId ?? DISPUTE,
    jurorIdx: opts.jurorIdx ?? 1, // FROST juror indices are 1-based (vendor parsePositiveInt rejects 0)
    commitHash,
    publisherPubkey: undefined,
  });
  const signed = finalizeEvent(
    { kind: template.kind, created_at: opts.createdAt ?? NOW - 100, tags: template.tags, content: template.content },
    seckey,
  ) as unknown as CourtEvent;
  return { event: signed, seckey, commitHash };
}

function signReveal(opts: {
  seckey?: Uint8Array;
  jurorIdx?: number;
  outcome?: string;
  salt?: string;
  disputeId?: string;
  createdAt?: number;
}): { event: CourtEvent; seckey: Uint8Array } {
  const seckey = opts.seckey ?? generateSecretKey();
  const template = buildVoteRevealEvent({
    disputeId: opts.disputeId ?? DISPUTE,
    jurorIdx: opts.jurorIdx ?? 1, // 1-based, same as commits
    outcome: opts.outcome ?? 'challenger',
    salt: opts.salt ?? bytesToHex(generateSecretKey()),
    publisherPubkey: undefined,
  });
  const signed = finalizeEvent(
    { kind: template.kind, created_at: opts.createdAt ?? NOW - 50, tags: template.tags, content: template.content },
    seckey,
  ) as unknown as CourtEvent;
  return { event: signed, seckey };
}

describe('parseCommitEvent / parseRevealEvent - verify-before-parse', () => {
  it('parses real signed commit + reveal end-to-end', () => {
    const c = signCommit({ jurorIdx: 2 });
    const parsedC = parseCommitEvent(c.event);
    expect(parsedC).not.toBeNull();
    expect(parsedC!.jurorIdx).toBe(2);
    expect(parsedC!.commitHash).toBe(c.commitHash);
    expect(parsedC!.disputeId).toBe(DISPUTE);

    const r = signReveal({ seckey: c.seckey, jurorIdx: 2, outcome: 'challenger', salt: 'deadbeef' });
    const parsedR = parseRevealEvent(r.event);
    expect(parsedR).not.toBeNull();
    expect(parsedR!.outcome).toBe('challenger');
    expect(parsedR!.salt).toBe('deadbeef');
  });

  it('rejects a tampered commit (signature no longer valid)', () => {
    const c = signCommit({});
    // Deterministic tamper: flip the first content character. A plain
    // `replace('0', '1')` was a silent no-op whenever the random commit hash
    // happened to contain no '0', which made this test flaky.
    const flipped = (c.event.content[0] === '0' ? '1' : '0') + c.event.content.slice(1);
    const tampered = { ...c.event, content: flipped } as CourtEvent;
    expect(tampered.content).not.toBe(c.event.content);
    expect(parseCommitEvent(tampered)).toBeNull();
  });

  it('rejects a locally-finalized event object (verifiedSymbol memoization hazard)', () => {
    // finalizeEvent stamps verifiedSymbol=true; a spread copies it. The fold
    // must re-verify from stripped bytes, so a tampered spread is REJECTED.
    const c = signCommit({});
    const spread = { ...c.event, content: '{"disputeId":"forged"}' } as CourtEvent;
    expect(parseCommitEvent(spread)).toBeNull();
    // and the honest event still passes
    expect(parseCommitEvent(c.event)).not.toBeNull();
  });

  it('rejects a commit with an empty commitHash tag', () => {
    const seckey = generateSecretKey();
    const template = buildVoteCommitEvent({ disputeId: DISPUTE, jurorIdx: 1, commitHash: 'x', publisherPubkey: undefined });
    const signed = finalizeEvent(
      { kind: template.kind, created_at: NOW, tags: template.tags.map(([k, ...rest]) => (k === 'commit' ? ['commit', ''] : [k, ...rest])), content: template.content },
      seckey,
    ) as unknown as CourtEvent;
    expect(parseCommitEvent(signed)).toBeNull();
  });
});

describe('revealWindow - deny-by-default phase gating', () => {
  it('closed before the deadline (salt would be public while commits can be forged)', () => {
    expect(revealWindow(DEADLINE, DEADLINE - 1)).toEqual({ open: false, reason: 'commit_phase_open' });
  });
  it('open exactly at the deadline (injected boundary)', () => {
    expect(revealWindow(DEADLINE, DEADLINE)).toEqual({ open: true });
  });
});

describe('foldVotes - commit/reveal matching and the vendor tally', () => {
  it('matches a reveal to its commit and counts it in the tally', () => {
    const c = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'aa' });
    const r = signReveal({ seckey: c.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'aa' });
    const view = foldVotes(DISPUTE, [c.event, r.event], { threshold: 2, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]!.commit).not.toBeNull();
    expect(view.rows[0]!.reveal).not.toBeNull();
    expect(view.rows[0]!.mismatch).toBe(false);
    expect(view.tally.outcome).toBe('challenger');
    expect(view.revealsSoFar).toBe(1);
    expect(view.finalized).toBe(false);
  });

  it('flags a mismatched reveal as invalid - never counted (vendor math)', () => {
    const c = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'aa' });
    const r = signReveal({ seckey: c.seckey, jurorIdx: 1, outcome: 'respondent', salt: 'aa' });
    const view = foldVotes(DISPUTE, [c.event, r.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.rows[0]!.mismatch).toBe(true);
    expect(view.revealsSoFar).toBe(0);
    expect(view.tally.outcome).toBe('');
    expect(view.tally.invalidReveals).toHaveLength(1);
    expect(view.finalized).toBe(false);
  });

  it('a reveal with NO commit is a violation row, never a vote', () => {
    const r = signReveal({ jurorIdx: 3, outcome: 'challenger', salt: 'bb' });
    const view = foldVotes(DISPUTE, [r.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.rows[0]!.commit).toBeNull();
    expect(view.rows[0]!.reveal).not.toBeNull();
    expect(view.rows[0]!.mismatch).toBe(true);
    expect(view.revealsSoFar).toBe(0);
  });

  it('reaching threshold finalizes the view', () => {
    const c1 = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'a1' });
    const c2 = signCommit({ jurorIdx: 2, outcome: 'challenger', salt: 'a2' });
    const r1 = signReveal({ seckey: c1.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'a1' });
    const r2 = signReveal({ seckey: c2.seckey, jurorIdx: 2, outcome: 'challenger', salt: 'a2' });
    const view = foldVotes(DISPUTE, [c1.event, c2.event, r1.event, r2.event], { threshold: 2, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.revealsSoFar).toBe(2);
    expect(view.finalized).toBe(true);
    expect(view.tally.outcome).toBe('challenger');
    expect(view.tally.supportingVotes).toHaveLength(2);
  });

  it('deterministic tie-break: equal counts resolve to the smaller outcome (vendor rule)', () => {
    const ca = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 's1' });
    const cb = signCommit({ jurorIdx: 2, outcome: 'respondent', salt: 's2' });
    const ra = signReveal({ seckey: ca.seckey, jurorIdx: 1, outcome: 'challenger', salt: 's1' });
    const rb = signReveal({ seckey: cb.seckey, jurorIdx: 2, outcome: 'respondent', salt: 's2' });
    const view = foldVotes(DISPUTE, [ca.event, cb.event, ra.event, rb.event], { threshold: 3, deadlineSeconds: DEADLINE, now: NOW });
    // 'challenger' < 'respondent' in UTF-8 byte order → deterministic winner
    expect(view.tally.outcome).toBe('challenger');
  });

  it('ignores commits/reveals for other disputes', () => {
    const other = 'c'.repeat(64);
    const c = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'aa', disputeId: other });
    const r = signReveal({ seckey: c.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'aa', disputeId: other });
    const view = foldVotes(DISPUTE, [c.event, r.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.rows).toHaveLength(0);
    expect(view.revealsSoFar).toBe(0);
  });

  it('latest commit wins per (pubkey, idx) with deterministic same-time tie-break', () => {
    const c1 = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'first', createdAt: NOW - 200 });
    const c2 = signCommit({ seckey: c1.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'second', createdAt: NOW - 100 });
    const view = foldVotes(DISPUTE, [c1.event, c2.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]!.commit!.commitHash).toBe(c2.commitHash);
  });
});

describe('relay query + templates', () => {
  it('votesFilter targets both kinds by the single-char dispute root tag', () => {
    const f = votesFilter(DISPUTE);
    expect(f.kinds).toEqual([39004, 39014]);
    expect(f['#e']).toEqual([DISPUTE]);
  });

  it('juror idx 0 is rejected by the fold (vendor 1-based contract)', () => {
    const seckey = generateSecretKey();
    const template = buildVoteCommitEvent({ disputeId: DISPUTE, jurorIdx: 0, commitHash: 'ff'.repeat(32), publisherPubkey: undefined });
    const signed = finalizeEvent(
      { kind: template.kind, created_at: NOW, tags: template.tags, content: template.content },
      seckey,
    ) as unknown as CourtEvent;
    expect(parseCommitEvent(signed)).toBeNull();
  });

  it('commitTemplate uses the vendor hashCommit over outcome||salt', () => {
    const t = commitTemplate({ disputeId: DISPUTE, jurorIdx: 5, outcome: 'challenger', salt: 'cc', publisherPubkey: 'ff'.repeat(32), nowSeconds: NOW });
    expect(t.commitHash).toBe(hashCommit('challenger', 'cc'));
    expect(t.created_at).toBe(NOW);
    expect(t.kind).toBe(39004);
    expect(t.tags.find((x) => x[0] === 'commit')![1]).toBe(hashCommit('challenger', 'cc'));
  });

  it('revealTemplate publishes outcome + salt with the injected clock', () => {
    const t = revealTemplate({ disputeId: DISPUTE, jurorIdx: 5, outcome: 'challenger', salt: 'cc', publisherPubkey: 'ff'.repeat(32), nowSeconds: NOW });
    expect(t.created_at).toBe(NOW);
    expect(t.kind).toBe(39014);
    expect(t.tags.find((x) => x[0] === 'outcome')![1]).toBe('challenger');
    expect(t.tags.find((x) => x[0] === 'salt')![1]).toBe('cc');
  });
});

describe('foldVotes - reveal window (deep-hunt wave 2)', () => {
  it('does not count a reveal published before the reveal window opens', () => {
    const c = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'a1'.repeat(32) });
    // Reveal BEFORE the deadline: commit phase still running -> invalid.
    const r = signReveal({ seckey: c.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'a1'.repeat(32), createdAt: DEADLINE - 10 });
    const view = foldVotes(DISPUTE, [c.event, r.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW });
    expect(view.revealsSoFar).toBe(0);
    expect(view.finalized).toBe(false);
    expect(view.rows[0].mismatch).toBe(true);
  });
});

describe('foldVotes - roster binding (S6: the signed selection is authoritative)', () => {
  it('does not count a commit/reveal from a pubkey outside the roster', () => {
    const honest = signCommit({ jurorIdx: 2, outcome: 'respondent', salt: 'h2' });
    const honestReveal = signReveal({ seckey: honest.seckey, jurorIdx: 2, outcome: 'respondent', salt: 'h2' });
    const attacker = signCommit({ jurorIdx: 1, outcome: 'challenger', salt: 'atk' });
    const attackerReveal = signReveal({ seckey: attacker.seckey, jurorIdx: 1, outcome: 'challenger', salt: 'atk' });
    const roster = new Map([[getPublicKey(honest.seckey), 2]]);

    const view = foldVotes(DISPUTE, [attacker.event, attackerReveal.event, honest.event, honestReveal.event], {
      threshold: 1,
      deadlineSeconds: DEADLINE,
      now: NOW,
      roster,
    });
    expect(view.revealsSoFar).toBe(1);
    expect(view.tally.outcome).toBe('respondent');
    const attackerRow = view.rows.find((r) => r.pubkey === getPublicKey(attacker.seckey));
    expect(attackerRow?.mismatch).toBe(true);
  });

  it('does not let one roster juror stuff the tally under a second idx', () => {
    const seckey = generateSecretKey();
    const pubkey = getPublicKey(seckey);
    // Roster says this juror is idx 1 and voted respondent...
    const c1 = signCommit({ seckey, jurorIdx: 1, outcome: 'respondent', salt: 'r1' });
    const r1 = signReveal({ seckey, jurorIdx: 1, outcome: 'respondent', salt: 'r1' });
    // ...then the same key also commits+reveals under idx 2 (double vote).
    const c2 = signCommit({ seckey, jurorIdx: 2, outcome: 'challenger', salt: 'r2' });
    const r2 = signReveal({ seckey, jurorIdx: 2, outcome: 'challenger', salt: 'r2' });
    const roster = new Map([[pubkey, 1]]);

    const view = foldVotes(DISPUTE, [c1.event, r1.event, c2.event, r2.event], {
      threshold: 1,
      deadlineSeconds: DEADLINE,
      now: NOW,
      roster,
    });
    expect(view.revealsSoFar).toBe(1);
    expect(view.tally.outcome).toBe('respondent');
  });

  it('does not count a roster juror revealing under the wrong idx', () => {
    const seckey = generateSecretKey();
    const pubkey = getPublicKey(seckey);
    const c = signCommit({ seckey, jurorIdx: 4, outcome: 'challenger', salt: 'w4' });
    const r = signReveal({ seckey, jurorIdx: 4, outcome: 'challenger', salt: 'w4' });
    const roster = new Map([[pubkey, 3]]);
    const view = foldVotes(DISPUTE, [c.event, r.event], { threshold: 1, deadlineSeconds: DEADLINE, now: NOW, roster });
    expect(view.revealsSoFar).toBe(0);
    expect(view.finalized).toBe(false);
  });
});
