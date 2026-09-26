/**
 * releaseGateBridge - the ledger→campaignStatus projection bridge (the GUI
 * half of PR #91's campaign-status surface).
 *
 * The relay ledger fold (ledgerFeed.summarizeLedger) yields registrar-signed
 * money facts; this bridge turns them into `campaignStatus` inputs so cards
 * can show WHY release is blocked. Honesty rules:
 *
 *   - No ledger fold → `null` (never project gates for unverifiable money).
 *   - Facts the ledger fold does not carry (milestone completion time,
 *     open dispute, external-contribution split) are UNKNOWN here, and the
 *     projection must treat unknown conservatively: the bridge emits the
 *     fail-closed shape (no clock-based window credit, no diversity credit)
 *     so a card never shows "releasable" on missing evidence.
 *   - Tier comes from the API card rail label; unknown rail → 'none' (the
 *     longest window - fail-closed again).
 */

import { campaignStatus, type CampaignStatusInputs, type CampaignStatusView, type CampaignTier } from './campaignStatus';
import type { LedgerSummary } from '../relay/ledgerFeed';

/** Map a card's rail label to the dispute tier. Unknown → 'none'. */
export function tierFromRail(rail: string | undefined): CampaignTier {
  const r = (rail ?? '').toLowerCase();
  if (r.includes('court')) return 'human-court';
  if (r.includes('verified') || r.includes('agent')) return 'agent-verified';
  return 'none';
}

/**
 * Bridge registrar-signed fold facts into a gate view. Returns null when
 * there is no verified ledger fold - gate copy is only meaningful for
 * ledger-verified campaigns.
 */
export function releaseGateView(input: {
  readonly campaign: string;
  readonly summary: LedgerSummary | undefined;
  readonly rail: string | undefined;
  readonly nowSeconds: number;
  /** Registrar's last signed activity; unknown → fold's existence is the only signal. */
  readonly registrarLastSeen?: number;
}): CampaignStatusView | null {
  if (!input.summary) return null;

  const tier = tierFromRail(input.rail);
  const inputs: CampaignStatusInputs = {
    fold: {
      campaign: input.campaign,
      seq: input.summary.entriesCount,
      runningSats: input.summary.raisedSats,
      closed: input.summary.closed,
      frozen: false,
    },
    // No dispute surface is folded into the card feed yet: unknown must not
    // fabricate a pass, so dispute_open blocks only when a dispute is KNOWN.
    // Conservatively, an unknown dispute state cannot unblock anything that
    // the window gate would already block; a live dispute feed can pass
    // openDispute:null only while the window gate still runs.
    openDispute: null,
    // Unknown milestone completion → treat as "completed now": the dispute
    // window gate then reports the full remaining window instead of a
    // fabricated pass.
    milestoneCompletedAt: input.nowSeconds,
    tier,
    // Ledger fold does not carry the external/internal split (sealed totals):
    // unknown → zero credit, diversity gate fails closed until the registrar
    // publishes the split.
    diversity: { distinctExternal: 0, externalSats: 0, totalSats: input.summary.raisedSats },
    registrarLastSeen: input.registrarLastSeen ?? input.nowSeconds,
    nowSeconds: input.nowSeconds,
  };
  return campaignStatus(inputs);
}

/** One-line card copy: the first blocking gate's creator-facing reason. */
export function gateBadgeLine(view: CampaignStatusView): string | null {
  if (view.releaseEligible) return 'Release eligible';
  const first = view.gates.find((g) => !g.pass);
  return first?.reason ?? null;
}

/** Short gate codes for the card strip (max 3 shown, +N for the rest). */
export function gateStripCodes(view: CampaignStatusView): { codes: readonly string[]; overflow: number } {
  const failing = view.gates.filter((g) => !g.pass).map((g) => g.code);
  return { codes: failing.slice(0, 3), overflow: Math.max(0, failing.length - 3) };
}
