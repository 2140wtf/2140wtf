/**
 * railRefund - donor-controlled refund execution core for the on-chain rails
 * (testnet4 / liquid-testnet), WS-3 / R10 rail path.
 *
 * Design constraints (docs/TESTNET4-RAIL-DESIGN.md §1, §3):
 *   - No platform key exists. The refund is a DONOR self-spend through the
 *     `donor_refund` CLTV leaf; this module never holds a key - the rail
 *     adapter's `buildSpend` signs locally and hands back raw bytes.
 *   - Fail closed on unknown state. Any chain error, malformed stage, missing
 *     clock or build failure produces a typed `failed`/`skipped` outcome and
 *     NO broadcast.
 *   - Idempotent by journal. An `intent` (with the raw tx) is durable BEFORE
 *     broadcast; a rerun reconciles against the chain instead of
 *     double-spending. A crash between broadcast and the completion record is
 *     therefore safe: the next run sees the UTXO spent and records
 *     `reconciled` without rebroadcasting.
 *
 * Timing (ROW-B B6 / R02): an optional Unix-second `refundDeadlineUnix` gates
 * eligibility at the boundary (eligible AT the deadline, not 1s before); a
 * CLTV `refundUnlock` gates on the chain tip (height domain) or the checked
 * clock (seconds domain). Both are pure and exhaustively boundary-tested.
 */

export type RefundRail = 'btc-testnet4' | 'liquid-testnet';

export interface RefundStage {
  /** Stable idempotency key, e.g. `${depositTxid}:${vout}`. */
  readonly id: string;
  readonly rail: RefundRail;
  readonly depositTxid: string;
  readonly vout: number;
  /** Value in sats (LBTC sats on the Liquid rail). */
  readonly amountSats: number;
  /** Expected scriptPubKey hex of the funded output - the build step must
   *  re-derive and compare it before signing (fail closed). */
  readonly scriptPubKeyHex: string;
  /** CLTV unlock target: a block height ('blocks') or Unix seconds ('seconds'). */
  readonly refundUnlock: number;
  readonly refundUnlockDomain: 'blocks' | 'seconds';
  /** Optional R02/B6 absolute Unix-second campaign deadline. */
  readonly refundDeadlineUnix?: number;
}

export interface ChainView {
  tipHeight(rail: RefundRail): Promise<number>;
  /** Whether the funded output is already spent, and by which tx. */
  outspend(rail: RefundRail, txid: string, vout: number): Promise<{ spent: boolean; spendTxid?: string }>;
  /** Broadcast raw tx hex; resolves to the txid. */
  broadcast(rail: RefundRail, rawTxHex: string): Promise<string>;
}

export type RefundJournalStatus = 'intent' | 'broadcast' | 'confirmed' | 'reconciled';

export interface RefundJournalEntry {
  readonly id: string;
  readonly rail: RefundRail;
  readonly depositTxid: string;
  readonly vout: number;
  readonly amountSats: number;
  readonly status: RefundJournalStatus;
  readonly rawTxHex?: string;
  readonly txid?: string;
  readonly at: number;
  readonly detail?: string;
}

export interface RefundJournal {
  read(id: string): RefundJournalEntry | null;
  /** Durable, atomic write (real impls fsync; see refundJournal.ts). */
  write(entry: RefundJournalEntry): void;
}

/** Non-durable journal for tests and single-shot callers. */
export class InMemoryRefundJournal implements RefundJournal {
  private readonly entries = new Map<string, RefundJournalEntry>();
  read(id: string): RefundJournalEntry | null {
    return this.entries.get(id) ?? null;
  }
  write(entry: RefundJournalEntry): void {
    this.entries.set(entry.id, entry);
  }
}

// ── Timing gate (pure, boundary-pinned) ─────────────────────────────────────

export const LOCKTIME_THRESHOLD = 500_000_000;

export type RefundGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'too_early' | 'cltv_not_reached'; readonly detail: string };

export interface RefundTimeGateInput {
  readonly tipHeight: number;
  readonly refundUnlock: number;
  readonly refundUnlockDomain: 'blocks' | 'seconds';
  readonly nowUnix?: number;
  readonly refundDeadlineUnix?: number;
}

/**
 * Pure eligibility gate. Order matters: the R02 time deadline is checked
 * before the CLTV lock. A missing clock with a time deadline FAILS CLOSED
 * (never assume now ≥ deadline). Boundaries: `nowUnix === deadline` and
 * `tipHeight === unlock` are ELIGIBLE; one unit earlier is not.
 */
export function refundTimeGate(input: RefundTimeGateInput): RefundGate {
  if (input.refundDeadlineUnix !== undefined) {
    if (input.nowUnix === undefined) {
      return { ok: false, code: 'too_early', detail: 'nowUnix required when refundDeadlineUnix is set' };
    }
    if (input.nowUnix < input.refundDeadlineUnix) {
      return { ok: false, code: 'too_early', detail: `now ${input.nowUnix} < deadline ${input.refundDeadlineUnix}` };
    }
  }
  if (input.refundUnlockDomain === 'seconds') {
    if (input.refundUnlock >= LOCKTIME_THRESHOLD) {
      if (input.nowUnix === undefined) {
        return { ok: false, code: 'too_early', detail: 'nowUnix required for a seconds-domain CLTV' };
      }
      if (input.nowUnix < input.refundUnlock) {
        return { ok: false, code: 'too_early', detail: `now ${input.nowUnix} < unlock ${input.refundUnlock}` };
      }
      return { ok: true };
    }
    // A seconds-domain value below the BIP-65 threshold is a build bug: it
    // would be interpreted as a block height and silently unlock far later.
    return { ok: false, code: 'cltv_not_reached', detail: `seconds CLTV ${input.refundUnlock} below threshold` };
  }
  if (input.tipHeight < input.refundUnlock) {
    return { ok: false, code: 'cltv_not_reached', detail: `tip ${input.tipHeight} < unlock ${input.refundUnlock}` };
  }
  return { ok: true };
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface RefundExecuteDeps {
  readonly chain: ChainView;
  readonly journal: RefundJournal;
  /** Build and locally sign the donor_refund spend. MUST re-verify the
   *  descriptor/UTXO/value before signing and throw on any mismatch. */
  readonly buildSpend: (stage: RefundStage) => Promise<{ rawTxHex: string }>;
  readonly nowSeconds: () => number;
}

export type RefundSkippedCode = 'too_early' | 'cltv_not_reached' | 'already_confirmed';
export type RefundFailedCode =
  | 'chain_unknown'
  | 'build_failed'
  | 'broadcast_failed'
  | 'unknown_journal_state';

export type RefundOutcome =
  | { readonly id: string; readonly status: 'refunded'; readonly txid: string }
  | { readonly id: string; readonly status: 'reconciled'; readonly txid: string }
  | { readonly id: string; readonly status: 'skipped'; readonly code: RefundSkippedCode; readonly detail?: string }
  | { readonly id: string; readonly status: 'failed'; readonly code: RefundFailedCode; readonly detail?: string };

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function entryFor(stage: RefundStage, now: number, status: RefundJournalStatus, extra: Partial<RefundJournalEntry> = {}): RefundJournalEntry {
  return {
    id: stage.id,
    rail: stage.rail,
    depositTxid: stage.depositTxid,
    vout: stage.vout,
    amountSats: stage.amountSats,
    status,
    at: now,
    ...extra,
  };
}

/**
 * Execute donor refunds for one or more stages (all-milestones: pass every
 * eligible stage). Idempotent across crashes and reruns; safe to call again
 * after any failure. Never throws for a per-stage failure - outcomes are
 * typed so a caller can report honestly.
 */
export async function executeRefund(
  deps: RefundExecuteDeps,
  stages: readonly RefundStage[],
): Promise<RefundOutcome[]> {
  const outcomes: RefundOutcome[] = [];
  for (const stage of stages) outcomes.push(await refundOne(deps, stage));
  return outcomes;
}

async function refundOne(deps: RefundExecuteDeps, stage: RefundStage): Promise<RefundOutcome> {
  const now = deps.nowSeconds();
  const existing = deps.journal.read(stage.id);

  // 1. Already finished → idempotent no-op (never rebroadcast).
  if (existing && (existing.status === 'confirmed' || existing.status === 'reconciled')) {
    return { id: stage.id, status: 'skipped', code: 'already_confirmed', detail: existing.txid };
  }

  // 2. Chain view. Unknown = fail closed, no broadcast.
  let tip: number;
  let spent: { spent: boolean; spendTxid?: string };
  try {
    tip = await deps.chain.tipHeight(stage.rail);
    spent = await deps.chain.outspend(stage.rail, stage.depositTxid, stage.vout);
  } catch (e) {
    return { id: stage.id, status: 'failed', code: 'chain_unknown', detail: errMsg(e) };
  }

  // 3. Crash recovery FIRST: a prior intent/broadcast may already have landed.
  if (existing) {
    if (spent.spent) {
      const txid = spent.spendTxid ?? existing.txid ?? '';
      deps.journal.write(entryFor(stage, now, 'reconciled', { txid, rawTxHex: existing.rawTxHex }));
      return { id: stage.id, status: 'reconciled', txid };
    }
    if (!existing.rawTxHex) {
      // An intent with no recoverable bytes cannot be safely retried.
      return { id: stage.id, status: 'failed', code: 'unknown_journal_state', detail: 'intent without raw tx' };
    }
    try {
      const txid = await deps.chain.broadcast(stage.rail, existing.rawTxHex);
      deps.journal.write(entryFor(stage, now, 'broadcast', { txid, rawTxHex: existing.rawTxHex }));
      return { id: stage.id, status: 'refunded', txid };
    } catch (e) {
      return { id: stage.id, status: 'failed', code: 'broadcast_failed', detail: errMsg(e) };
    }
  }

  // 4. Spent before we ever acted (founder claim / a prior foreign spend) →
  //    record it, never attempt a second spend.
  if (spent.spent) {
    const txid = spent.spendTxid ?? '';
    deps.journal.write(entryFor(stage, now, 'reconciled', { txid }));
    return { id: stage.id, status: 'reconciled', txid };
  }

  // 5. Pure time/CLTV gate.
  const gate = refundTimeGate({
    tipHeight: tip,
    refundUnlock: stage.refundUnlock,
    refundUnlockDomain: stage.refundUnlockDomain,
    nowUnix: now,
    refundDeadlineUnix: stage.refundDeadlineUnix,
  });
  if (!gate.ok) {
    return { id: stage.id, status: 'skipped', code: gate.code, detail: gate.detail };
  }

  // 6. Build + sign locally, then journal the INTENT before broadcast.
  let rawTxHex: string;
  try {
    rawTxHex = (await deps.buildSpend(stage)).rawTxHex;
  } catch (e) {
    return { id: stage.id, status: 'failed', code: 'build_failed', detail: errMsg(e) };
  }
  deps.journal.write(entryFor(stage, now, 'intent', { rawTxHex }));

  let txid: string;
  try {
    txid = await deps.chain.broadcast(stage.rail, rawTxHex);
  } catch (e) {
    // The intent (with raw tx) persists; a rerun reconciles or retries.
    return { id: stage.id, status: 'failed', code: 'broadcast_failed', detail: errMsg(e) };
  }
  deps.journal.write(entryFor(stage, now, 'broadcast', { txid, rawTxHex }));
  return { id: stage.id, status: 'refunded', txid };
}
