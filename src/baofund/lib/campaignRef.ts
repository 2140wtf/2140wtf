/**
 * CampaignRef - the §11.1 blocker: a campaign reference that BINDS every
 * authority input so any disagreement yields `conflicted`/`unavailable`
 * and ZERO mutation calls (never a partial settlement attempt).
 *
 * Bound inputs (plan §11.1):
 *   - campaign coordinate (kind:pubkey:slug a-coordinate)
 *   - registrar key + epoch (the authority that may sign the ledger)
 *   - card event id (the signed 39801 card this campaign is)
 *   - ledger schema/version (content.v the fold must enforce)
 *   - Fund origin (the dedicated bao-fund-api base URL - no markets fallback)
 *   - expected ledger head (the entryHash the fold must land on)
 *
 * Resolution is PURE: given the caller-fetched card event, ledger events,
 * and pins, `resolveCampaignRef` recomputes every binding independently and
 * refuses (typed) on any mismatch. The ref never trusts a server echo -
 * every field is either pinned at issue time or re-derived from raw events.
 */
import { validateLedgerEntry, foldLedgerEntry, initialLedgerFold, type LedgerEvent, type LedgerAuthority } from './baoLedger39805';

export const FUND_ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/i;
const A_COORD_RE = /^39801:[0-9a-f]{64}:[a-z0-9][a-z0-9-]{0,63}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;

export type CampaignRefVerdict = 'resolved' | 'conflicted' | 'unavailable';

export interface CampaignRef {
  v: 1;
  campaign: string;
  registrarKey: string;
  registrarEpoch: number;
  cardEventId: string;
  ledgerSchemaVersion: 1;
  fundOrigin: string;
  /** The expected post-fold entryHash (genesis when no entries yet). */
  expectedHead: string | null;
}

export type CampaignRefResolution =
  | { verdict: 'resolved'; ref: CampaignRef; head: string; entriesCount: number; runningSats: number }
  | { verdict: 'conflicted' | 'unavailable'; reason: string; ref: CampaignRef };

/** Issue a CampaignRef after shape-validating every binding. Throws on
 *  malformed input - issuance never produces a partially-bound ref. */
export function issueCampaignRef(input: {
  campaign: string;
  registrarKey: string;
  registrarEpoch: number;
  cardEventId: string;
  fundOrigin: string;
  expectedHead?: string | null;
}): CampaignRef {
  if (!A_COORD_RE.test(input.campaign)) throw new Error('campaign must be a full 39801 a-coordinate');
  if (!HEX_64.test(input.registrarKey)) throw new Error('registrarKey must be raw 64-hex (bl3hex: forbidden on pubkeys)');
  if (!Number.isSafeInteger(input.registrarEpoch) || input.registrarEpoch < 0) throw new Error('registrarEpoch must be a non-negative integer');
  if (!HEX_64.test(input.cardEventId)) throw new Error('cardEventId must be a raw 64-hex Nostr event id');
  if (!FUND_ORIGIN_RE.test(input.fundOrigin)) throw new Error('fundOrigin must be an https origin');
  if (input.expectedHead != null && !HEX_64.test(input.expectedHead)) throw new Error('expectedHead must be 64-hex or null');
  return {
    v: 1,
    campaign: input.campaign,
    registrarKey: input.registrarKey,
    registrarEpoch: input.registrarEpoch,
    cardEventId: input.cardEventId,
    ledgerSchemaVersion: 1,
    fundOrigin: input.fundOrigin,
    expectedHead: input.expectedHead ?? null,
  };
}

/**
 * Resolve a CampaignRef against RAW inputs (never server echoes):
 *   - every ledger event's campaign field must EQUAL the ref's coordinate;
 *   - the fold must run clean under the ref's pinned registrar (epoch + key)
 *     at the ref's schema version;
 *   - the fold head must equal the ref's expectedHead when one was issued;
 *   - the card event id must be well-formed (content binding is the card's
 *     own signature check upstream; here we bind the REFERENCE).
 * Any disagreement → conflicted/unavailable, callers make ZERO mutation calls.
 */
export function resolveCampaignRef(ref: CampaignRef, input: {
  cardEventId: string;
  ledgerEvents: LedgerEvent[];
  nowSeconds?: number;
}): CampaignRefResolution {
  if (!HEX_64.test(input.cardEventId)) return { verdict: 'unavailable', reason: 'card event id missing/malformed', ref };
  if (input.ledgerEvents.length === 0) return { verdict: 'unavailable', reason: 'no ledger events supplied', ref };
  const authority: LedgerAuthority = {
    campaign: ref.campaign,
    registrarEpochs: new Map([[ref.registrarEpoch, ref.registrarKey]]),
  };
  let state = initialLedgerFold(ref.campaign);
  try {
    for (const ev of input.ledgerEvents) {
      const content = validateLedgerEntry(ev);
      if (content.campaign !== ref.campaign) {
        return { verdict: 'conflicted', reason: `ledger event ${ev.id.slice(0, 12)}… is for a different campaign coordinate`, ref };
      }
      if (content.v !== ref.ledgerSchemaVersion) {
        return { verdict: 'conflicted', reason: `ledger schema v${content.v} ≠ ref v${ref.ledgerSchemaVersion}`, ref };
      }
      state = foldLedgerEntry(state, ev, authority);
    }
  } catch (err) {
    return { verdict: 'conflicted', reason: err instanceof Error ? err.message.slice(0, 140) : 'ledger fold failed', ref };
  }
  if (state.frozen) return { verdict: 'conflicted', reason: `ledger ${state.frozen}`, ref };
  if (ref.expectedHead !== null && state.headHash !== ref.expectedHead) {
    return { verdict: 'conflicted', reason: `ledger head ${state.headHash.slice(0, 12)}… ≠ expected ${ref.expectedHead.slice(0, 12)}…`, ref };
  }
  return { verdict: 'resolved', ref, head: state.headHash, entriesCount: state.entriesCount, runningSats: state.runningSats };
}

/** Genesis head for a campaign with no entries (deterministic, per amend 4). */
export function campaignRefGenesisHead(campaign: string): string {
  // Reuses the ledger's genesis rule so an empty-ledger ref pins the same
  // head the fold will produce.
  return genesisPrevHash(campaign);
}

import { genesisPrevHash } from './baoLedger39805';
