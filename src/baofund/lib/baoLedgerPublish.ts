/**
 * baoLedgerPublish - registrar-side construction of kind-49305 ledger chains.
 *
 * The validator/fold (`baoLedger39805`) is the normative gate; this module is
 * the publisher half: it assembles content that satisfies the per-type field
 * matrix (via `ledgerFieldRules`), links entries with the amend-4 envelope
 * hash, and self-checks the built chain under the signer's own pin before
 * handing events back. Backend publishers and operator tooling use it so the
 * wire format can never drift from validation.
 */
import { verifyEvent, type Event } from 'nostr-tools/pure';
import {
  ESCROW_LEDGER_KIND,
  entryHash,
  foldLedgerEntry,
  genesisPrevHash,
  initialLedgerFold,
  ledgerFieldRules,
  type LedgerEntryContent,
  type LedgerEntryType,
  type LedgerFieldName,
  type LedgerFoldState,
  type LedgerAuthority,
} from './baoLedger39805';
import type { SignerLike } from './baoFundraising';

export class LedgerPublishError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LedgerPublishError';
  }
}

export interface LedgerEntrySpec {
  type: LedgerEntryType;
  /** Registrar epoch this entry is signed under (the reader pins it). */
  registrarEpoch: number;
  milestone?: string | null;
  amountSats?: number | null;
  proofSetHash?: string | null;
  nullifierRoot?: string | null;
  externalContributors?: number | null;
  window?: LedgerEntryContent['window'];
  verdict?: LedgerEntryContent['verdict'];
  /** Unix seconds; defaults to the chain timestamp + (seq - 1). */
  createdAt?: number;
}

export interface SignLedgerChainOptions {
  /** Chain base timestamp (default: now). */
  timestamp?: number;
  /** When false, skip the pre-publish fold self-check (default true). */
  selfCheck?: boolean;
}

/** Assemble one validated-shape entry content for a given chain position. */
export function buildLedgerContent(
  spec: LedgerEntrySpec,
  ctx: { campaign: string; seq: number; prevHash: string },
): LedgerEntryContent {
  if (!Number.isSafeInteger(spec.registrarEpoch) || spec.registrarEpoch < 0) {
    throw new LedgerPublishError('registrarEpoch must be a non-negative integer', 'ledger_bad_epoch');
  }
  const rules = ledgerFieldRules(spec.type);
  const pick = <T>(field: LedgerFieldName, value: T | null | undefined): T | null => {
    const rule = rules[field];
    if (rule === 'null') {
      if (value !== undefined && value !== null) {
        throw new LedgerPublishError(`${field} must be null for ${spec.type} (unset = null, never 0/empty)`, 'ledger_matrix_null');
      }
      return null;
    }
    if (rule === 'zero') {
      if (value !== undefined && value !== null && value !== 0) {
        throw new LedgerPublishError(`${field} must be exactly 0 for ${spec.type}`, 'ledger_matrix_zero');
      }
      return 0 as T;
    }
    if (rule === 'req' && (value === undefined || value === null)) {
      throw new LedgerPublishError(`${field} is required for ${spec.type}`, 'ledger_matrix_req');
    }
    return (value ?? null) as T | null;
  };
  const content: LedgerEntryContent = {
    v: 1,
    seq: ctx.seq,
    prevHash: ctx.prevHash,
    campaign: ctx.campaign,
    type: spec.type,
    milestone: pick('milestone', spec.milestone),
    amountSats: pick('amountSats', spec.amountSats),
    proofSetHash: pick('proofSetHash', spec.proofSetHash),
    nullifierRoot: pick('nullifierRoot', spec.nullifierRoot),
    externalContributors: pick('externalContributors', spec.externalContributors),
    window: pick('window', spec.window),
    verdict: pick('verdict', spec.verdict),
    registrarEpoch: spec.registrarEpoch,
  };
  return content;
}

/**
 * Sign a gap-free 49305 chain: genesis anchor, sequential prevHash links,
 * empty tags (a `d` tag is forbidden). The built chain is folded under the
 * signer's pin and rejected before return if anything fails - a publisher
 * must never emit an entry its own reader would refuse.
 */
export async function signLedgerChain(
  signer: SignerLike,
  campaign: string,
  specs: LedgerEntrySpec[],
  opts: SignLedgerChainOptions = {},
): Promise<Event[]> {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new LedgerPublishError('at least one ledger entry is required', 'ledger_no_entries');
  }
  const base = opts.timestamp ?? Math.floor(Date.now() / 1000);
  let headHash = genesisPrevHash(campaign);
  const events: Event[] = [];
  let state: LedgerFoldState = initialLedgerFold(campaign);
  for (const [i, spec] of specs.entries()) {
    const seq = i + 1;
    if (spec.createdAt !== undefined && (!Number.isSafeInteger(spec.createdAt) || spec.createdAt < 0)) {
      throw new LedgerPublishError('createdAt must be a non-negative integer', 'ledger_bad_created_at');
    }
    const createdAt = spec.createdAt ?? base + i;
    const content = buildLedgerContent(spec, { campaign, seq, prevHash: headHash });
    const unsigned = {
      kind: ESCROW_LEDGER_KIND,
      created_at: createdAt,
      tags: [] as string[][],
      content: JSON.stringify(content),
    };
    const signed = (await signer.signEvent(unsigned)) as Event;
    if (!verifyEvent(JSON.parse(JSON.stringify(signed)) as Event)) {
      throw new LedgerPublishError(`entry ${seq} signature does not verify`, 'ledger_bad_signature');
    }
    if (opts.selfCheck !== false) {
      const authority: LedgerAuthority = {
        campaign,
        registrarEpochs: new Map([[spec.registrarEpoch, signed.pubkey]]),
      };
      const next = foldLedgerEntry(state, signed, authority);
      if (next.frozen) {
        throw new LedgerPublishError(`self-check froze the chain at seq ${seq}: ${next.frozen}`, 'ledger_self_check_failed');
      }
      state = next;
    }
    events.push(signed);
    headHash = entryHash(signed, content);
  }
  if (opts.selfCheck !== false && state.seq !== specs.length) {
    throw new LedgerPublishError('self-check did not accept every entry', 'ledger_self_check_incomplete');
  }
  return events;
}
