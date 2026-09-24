/**
 * fundFeed - live BAO Fund data.
 *
 * Uses the shared protocol client (bao.markets API at relay.bao.network,
 * anonymous reads). Shows BOTH formats like the parent app:
 *  - 'milestones' → one card per milestone (each milestone is a market)
 *  - 'stream' / time-release → one card per fundraiser
 */
import { useEffect, useState } from 'react';
import {
  baoRelayUrl,
  fetchFundraisers,
  fetchFundraiser,
  type BaoFundraiser,
  type BaoMilestone,
} from '../lib/baoFundraising';
import type { CampaignCardDraft } from '../components/frames/FundingCampaignCard';
import type { SignerLike } from '../lib/baoFundraising';
import { errorMessage } from '../lib/errors';
import { fetchRelayCards } from './relayFeed';
import { fetchRelayLedger, registrarPinFromEnv, type LedgerSummary } from './ledgerFeed';
import { releaseGateView, gateBadgeLine, gateStripCodes } from '../lib/releaseGateBridge';
import type { CampaignStatusView } from '../lib/campaignStatus';

export interface FundFeedState {
  loading: boolean;
  error: string | null;
  cards: CampaignCardDraft[];
  /** `relay` = served from signed kind-39801 cards (API not consulted);
   *  `live` = API fallback (no cards on the relay yet); `offline` = neither. */
  source: 'relay' | 'live' | 'offline';
  /** Campaign-status gate views per card id - present ONLY for cards with a
   *  verified registrar-ledger fold (never projected for unverified money). */
  gateViews: Map<string, CampaignStatusView>;
}

/** The card's gate-strip prop from its gate view (null when none). Pure. */
export function gateStripProp(
  view: CampaignStatusView | undefined,
  nowSeconds: number,
): { codes: readonly string[]; overflow: number; reason: string; title: string } | null {
  if (!view) return null;
  const strip = gateStripCodes(view);
  const reason = gateBadgeLine(view);
  if (!reason) return null;
  return {
    codes: strip.codes,
    overflow: strip.overflow,
    reason,
    title: `Release gates at ${new Date(nowSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')}Z - registrar-signed ledger fold`,
  };
}

const MAX_FUNDRAISERS = 20;
const MILESTONES_PER_FR = 4;

function runnerLabel(r: BaoFundraiser['runner_type']): string {
  if (r === 'agent_human') return 'Agent + Human';
  if (r === 'agent') return 'Agent';
  return 'Human';
}

function deadlined(r: BaoFundraiser): number {
  const now = Math.floor(Date.now() / 1000);
  if (typeof r.stream_end_at === 'number' && r.stream_end_at > now) return r.stream_end_at;
  const n = Number(r.stream_end_at);
  if (Number.isFinite(n) && n > now) return n;
  return now + 86400 * 30;
}

export function milestoneCard(f: BaoFundraiser, m: BaoMilestone, priorSats = 0): CampaignCardDraft {
  const now = Math.floor(Date.now() / 1000);
  const dl = typeof m.deadline_at === 'number' && m.deadline_at ? m.deadline_at : deadlined(f);
  return {
    id: `${f.id}::${m.id}`,
    // The milestone IS a resolution market under the hood, but the FUND card
    // presents the deliverable, not the market question ("Will … deliver …
    // ?"). The question stays available via `market.question` for surfaces
    // that genuinely need the resolution contract.
    title: m.title || m.question || `${f.title} - Milestone ${m.idx + 1}`,
    description: m.description || m.criteria || f.description || '',
    category: f.category ?? 'fund',
    // API network is authoritative; the legacy description marker is NOT
    // a money authority (fail closed).
    mainnetCashu: f.network === 'mainnet',
    // The escrow is a single pot that fills milestones IN ORDER; crediting
    // every milestone the full raised total showed all of them as funded.
    pledgedSats: m.status === 'released'
      ? m.amount_sats
      : Math.max(0, Math.min(m.amount_sats, f.raised_sats - priorSats)),
    goalSats: m.amount_sats,
    endTimeSec: dl > now ? dl : now + 86400 * 30,
    status: m.status,
    rail: f.settlement_rail,
    runner: runnerLabel(f.runner_type),
    frId: f.id,
    frStatus: f.status,
    roomAvailable: f.chat_room_available,
    contributor: f.is_contributor,
    ownerPubkey: f.owner_pubkey,
    market: m.market_id
      ? {
          id: m.market_id,
          question: m.question ?? null,
          status: m.market_resolution ? 'resolved' : 'unknown',
          resolution: m.market_resolution ?? null,
        }
      : undefined,
  };
}

export function fundraiserCard(f: BaoFundraiser): CampaignCardDraft {
  return {
    id: f.id,
    title: f.title,
    description: f.description ?? '',
    category: f.category ?? 'fund',
    // API network is authoritative; the description marker is NOT a money
    // authority (twin of milestoneCard; a testnet record with the marker in
    // its owner-controlled description must never open the real-money flow).
    mainnetCashu: f.network === 'mainnet',
    pledgedSats: f.raised_sats,
    goalSats: f.goal_sats,
    endTimeSec: deadlined(f),
    rail: f.settlement_rail,
    runner: runnerLabel(f.runner_type),
    frId: f.id,
    frStatus: f.status,
    roomAvailable: f.chat_room_available,
    contributor: f.is_contributor,
    ownerPubkey: f.owner_pubkey,
    market: undefined,
  };
}

/**
 * Merge relay-discovered cards with registrar-ledger summaries and API
 * details. GATE authority stays ledger-only: `ledgerVerified`, a closed
 * ledger's `frStatus`, and every `gateViewsForCards` projection come from
 * the registrar-signed fold. The DISPLAYED raised total uses the live API
 * `raised_sats` when the detail is reachable (the same source the campaign
 * popup reads), with the registrar ledger total as the offline fallback and
 * the relay value last (the relay cards carry no raised total) - a stale
 * ledger snapshot must not freeze the card list while the API is live. Pure
 * - exported for tests.
 */
export function mergeEnrichedCards(
  cards: CampaignCardDraft[],
  ledger: Map<string, LedgerSummary>,
  apiById: Map<string, BaoFundraiser>,
): CampaignCardDraft[] {
  return cards.map((c) => {
    const summary = ledger.get(c.id);
    const fromLedger = summary
      ? { ...c, pledgedSats: summary.raisedSats, ledgerVerified: true, ...(summary.closed ? { frStatus: 'completed' } : {}) }
      : c;
    const f = apiById.get(c.id);
    if (!f) return fromLedger;
    // Shape-drifted API totals fall back to the ledger/relay value instead of
    // reaching formatSats() (which would throw during render).
    const apiRaised =
      typeof f.raised_sats === 'number' && Number.isFinite(f.raised_sats) ? f.raised_sats : null;
    return {
      ...fromLedger,
      pledgedSats: apiRaised ?? fromLedger.pledgedSats,
      // Ledger goal wins when present; the API value is sanitized so a
      // null/shape-drifted field cannot reach formatSats() (which would throw
      // during render and blank the whole grid).
      goalSats: fromLedger.goalSats
        || (typeof f.goal_sats === 'number' && Number.isFinite(f.goal_sats) && f.goal_sats > 0 ? f.goal_sats : 0),
      frStatus: summary?.closed ? fromLedger.frStatus : f.status,
      rail: f.settlement_rail || fromLedger.rail,
      runner: runnerLabel(f.runner_type),
      // The SIGNED card's owner is authoritative for attribution: an `fr`
      // tag is attacker-chosen and must not let a card claim another
      // campaign's owner/identity. The API owner only fills a missing one.
      ownerPubkey: fromLedger.ownerPubkey || f.owner_pubkey,
      mainnetCashu: f.network === 'mainnet',
      endTimeSec: deadlined(f),
    };
  });
}

/** Unique campaign ids (`frId`) to enrich, in card order, bounded by
 *  `max` - the same bound the API-fallback path uses. Multiple cards of one
 *  campaign share one API detail fetch. Pure. */
export function uniqueCampaignsForEnrichment(
  cards: CampaignCardDraft[],
  max = MAX_FUNDRAISERS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (typeof c.frId !== 'string' || c.frId.length === 0 || seen.has(c.frId)) continue;
    seen.add(c.frId);
    out.push(c.frId);
    if (out.length >= max) break;
  }
  return out;
}

/** Injection seam for tests; production uses the env pin +
 *  `fetchFundraiser`/`fetchRelayLedger`. `registrarPin: null` forces the
 *  no-pin offline path. */
export interface EnrichRelayCardsDeps {
  fetchDetail?: (frId: string, signer?: SignerLike) => Promise<{ fundraiser: BaoFundraiser }>;
  fetchLedger?: (
    relayUrl: string,
    pin: NonNullable<ReturnType<typeof registrarPinFromEnv>>,
  ) => Promise<Map<string, LedgerSummary>>;
  registrarPin?: ReturnType<typeof registrarPinFromEnv>;
}

/**
 * Optional enrichment of relay-discovered cards. The relay carries existence,
 * signed content and (with a registrar pin) ledger totals; the API fills the
 * remaining presentation fields when it happens to be reachable. The API is
 * fetched ONCE per unique campaign (not per card and not capped by card
 * position), bounded by MAX_FUNDRAISERS like the API-fallback path, and the
 * detail is merged into every card of that campaign. Any failure leaves the
 * affected card exactly as the relay served it.
 */
export async function enrichRelayCards(
  cards: CampaignCardDraft[],
  signer?: SignerLike,
  deps: EnrichRelayCardsDeps = {},
): Promise<{ cards: CampaignCardDraft[]; ledger: Map<string, LedgerSummary> }> {
  let ledger = new Map<string, LedgerSummary>();
  const fetchLedger = deps.fetchLedger ?? fetchRelayLedger;
  try {
    const pin = deps.registrarPin !== undefined ? deps.registrarPin : registrarPinFromEnv();
    if (pin) ledger = await fetchLedger(baoRelayUrl(), pin);
  } catch {
    /* ledger enrichment is optional */
  }
  const frIds = uniqueCampaignsForEnrichment(cards);
  if (frIds.length === 0) return { cards: mergeEnrichedCards(cards, ledger, new Map()), ledger };
  const fetchDetail = deps.fetchDetail ?? fetchFundraiser;
  const details = await Promise.all(
    frIds.map(async (frId) => {
      try {
        const d = await fetchDetail(frId, signer);
        return { frId, f: d.fundraiser };
      } catch {
        return null;
      }
    }),
  );
  const detailByFrId = new Map(
    details.filter((d): d is { frId: string; f: BaoFundraiser } => d !== null).map((d) => [d.frId, d.f]),
  );
  // The merge map is keyed by CARD id (the signed card's a-coordinate) while
  // the fetch is keyed by campaign: project one detail onto every card that
  // links to it.
  const byCardId = new Map<string, BaoFundraiser>();
  for (const c of cards) {
    if (typeof c.frId !== 'string') continue;
    const f = detailByFrId.get(c.frId);
    if (f) byCardId.set(c.id, f);
  }
  return { cards: mergeEnrichedCards(cards, ledger, byCardId), ledger };
}

/** Gate views for the merged cards, keyed by card id. Only ledger-verified
 *  campaigns project gates; the registrar's last activity is unknown at feed
 *  time, so liveness defaults to "seen now" (never fabricates a dead-registrar
 *  alarm from silence in the feed path).
 *
 *  Keying: the ledger fold is keyed by the FULL campaign a-coordinate (the
 *  content's `campaign` field), and a card may only claim the fold of its OWN
 *  coordinate. No owner-only, substring, or `fr`-tag (attacker-chosen) lookup:
 *  a card whose own a-coordinate is absent from the fold shows NO strip (fail
 *  closed) - projecting a sibling campaign's registrar-signed gates onto it
 *  was a real misattribution (same owner, different slug). */
export function gateViewsForCards(
  cards: CampaignCardDraft[],
  ledger: Map<string, LedgerSummary>,
  nowSeconds: number,
): Map<string, CampaignStatusView> {
  const out = new Map<string, CampaignStatusView>();
  for (const c of cards) {
    const summary = ledgerSummaryForCard(ledger, c);
    if (!summary) continue;
    const view = releaseGateView({
      campaign: c.id,
      summary,
      rail: c.rail,
      nowSeconds,
    });
    if (view) out.set(c.id, view);
  }
  return out;
}

/** Exact match on the card's full a-coordinate (`c.id`). The a-coordinate's
 *  hex pubkey (and slug) are case-insensitive in the validated wire shape
 *  (`A_COORD_RE`), so the comparison case-folds the WHOLE coordinate - never
 *  a segment of it. Two ledger streams that normalize to the same coordinate
 *  are ambiguous and project nothing. */
function ledgerSummaryForCard(ledger: Map<string, LedgerSummary>, c: CampaignCardDraft): LedgerSummary | undefined {
  const direct = ledger.get(c.id);
  if (direct) return direct;
  const wanted = c.id.toLowerCase();
  let match: LedgerSummary | undefined;
  for (const [campaign, summary] of ledger) {
    if (campaign.toLowerCase() !== wanted) continue;
    if (match !== undefined) return undefined;
    match = summary;
  }
  return match;
}

export function useFundFeed(signer?: SignerLike): FundFeedState & { reload: () => void } {
  const [state, setState] = useState<FundFeedState>({
    loading: true,
    error: null,
    cards: [],
    source: 'offline',
    gateViews: new Map(),
  });
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Relay-first: signed cards are the native discovery source. Only when
      // the relay holds none (fresh relay, or cards not yet published) do we
      // fall back to the API index.
      try {
        const relayCards = await fetchRelayCards(baoRelayUrl());
        if (cancelled) return;
        if (relayCards.length > 0) {
          const { cards: enriched, ledger } = await enrichRelayCards(relayCards, signer);
          if (cancelled) return;
          setState({
            loading: false,
            error: null,
            cards: enriched,
            source: 'relay',
            gateViews: gateViewsForCards(enriched, ledger, Math.floor(Date.now() / 1000)),
          });
          return;
        }
      } catch {
        /* fall through to API */
      }
      try {
        const list = await fetchFundraisers(undefined, signer);
        const frs = list.slice(0, MAX_FUNDRAISERS);
        // Preserve fundraiser order - fill by index so cards never shuffle
        // between reloads (Promise.all resolves in completion order).
        const perFundraiser = await Promise.all(
          frs.map(async (f) => {
            const out: CampaignCardDraft[] = [];
            try {
              const detail = await fetchFundraiser(f.id);
              const ms = detail.milestones ?? [];
              const isMilestones = (f.format ?? 'milestones') === 'milestones';
              if (isMilestones && ms.length > 0) {
                // Waterfall: each milestone's slice excludes the amounts of all
                // earlier milestones (index order = fill order).
                let prior = 0;
                for (const m of ms.slice(0, MILESTONES_PER_FR)) {
                  out.push(milestoneCard(f, m, prior));
                  prior += Number(m.amount_sats) || 0;
                }
              } else {
                out.push(fundraiserCard(f));
              }
            } catch {
              out.push(fundraiserCard(f)); // detail failed → show the fundraiser itself
            }
            return out;
          })
        );
        const cards = perFundraiser.flat();
        if (cancelled) return;
        setState({ loading: false, error: null, cards, source: 'live', gateViews: new Map() });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: errorMessage(err),
          cards: [],
          source: 'offline',
          gateViews: new Map(),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bump, signer]);

  return { ...state, reload: () => setBump((b) => b + 1) };
}
