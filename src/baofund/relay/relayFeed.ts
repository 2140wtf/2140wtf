// src/relay/relayFeed.ts
//
// Relay-first campaign discovery, reader side. Folds kind-39801 cards from
// the fund relay into the same `CampaignCardDraft` shape the API feed
// produces, so the UI is source-agnostic. Card content carries no raised
// totals (those are ledger facts); progress fields stay 0 until a ledger
// read enriches them - existence/discovery needs no API.

import { WebRelayConn } from '@/baofund/community/websocket.js';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  emptyFundFeedFoldState,
  foldFundFeedEvent,
  FUNDRAISER_CARD_KIND,
  MILESTONE_STATUS_KIND,
  type FundFeedFoldState,
  type FundraiserCardContentV1,
} from '../lib/baoCards';
import { registrarPinFromEnv } from './ledgerFeed';
import type { CampaignCardDraft } from '../components/frames/FundingCampaignCard';

const MAX_RELAY_CARDS = 20;
const CARD_QUERY_TIMEOUT_MS = 4_000;
/** Card discovery never claims a deadline it cannot see; show a 30-day
 *  placeholder rather than pretending the card carries stream_end_at. */
const PLACEHOLDER_HORIZON_SEC = 30 * 86_400;

const FR_TAG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Registrar authority map for the 39803 fold: every card's a-coordinate
 *  trusts the pinned registrar key (never an event's own author). */
function registrarPinsFor(events: NostrEvent[], pin: { pubkey: string } | null): Map<string, Set<string>> {
  const pins = new Map<string, Set<string>>();
  if (!pin) return pins;
  for (const ev of events) {
    if (ev.kind !== FUNDRAISER_CARD_KIND) continue;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (d) pins.set(`${FUNDRAISER_CARD_KIND}:${ev.pubkey.toLowerCase()}:${d}`, new Set([pin.pubkey.toLowerCase()]));
  }
  return pins;
}

/** Map one validated card into the UI draft shape. */
export function draftFromCard(
  aCoord: string,
  content: FundraiserCardContentV1,
  frId?: string,
): CampaignCardDraft {
  const ownerPubkey = aCoord.split(':')[1];
  const now = Math.floor(Date.now() / 1000);
  const goalSats = content.milestones.reduce((sum, m) => sum + (m.amount > 0 ? m.amount : 0), 0);
  return {
    id: aCoord,
    title: content.title,
    description: content.summary,
    category: 'fund',
    pledgedSats: 0,
    goalSats,
    endTimeSec: now + PLACEHOLDER_HORIZON_SEC,
    status: content.milestones[0]?.status,
    rail: content.rails[0],
    ownerPubkey,
    // Real-money status is an API fact (`network`), never a relay-card text
    // marker: a hostile card could otherwise make the pledge modal spend the
    // donor's mainnet wallet. Unknown network = not real.
    mainnetCashu: false,
    ...(frId ? { frId } : {}),
  };
}

/** Fold raw relay events into drafts. Invalid/stale events are counted and
 *  dropped by the shared fold; unknown-aCoord duplicates keep the newest.
 *  When registrar pins are supplied, 39803 milestone statuses are folded too
 *  and the newest signed status per campaign overrides the card default. */
/** Reject events stamped implausibly far in the future: a flood of
 *  future-dated cards would otherwise evict every real campaign from the
 *  newest-first window (the relay is untrusted). */
const MAX_CLOCK_SKEW_SEC = 300;

export function draftsFromEvents(
  events: NostrEvent[],
  limit = MAX_RELAY_CARDS,
  registrarPins?: Map<string, Set<string>>,
): CampaignCardDraft[] {
  let state: FundFeedFoldState = emptyFundFeedFoldState();
  const frByACoord = new Map<string, string>();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const ev of events) {
    // Reject implausible future timestamps BEFORE folding: a flood of
    // future-dated cards would evict every real campaign from the
    // newest-first window (and suppress the API fallback).
    if (!Number.isSafeInteger(ev.created_at) || ev.created_at > nowSec + MAX_CLOCK_SKEW_SEC) continue;
    try {
      const next = foldFundFeedEvent(state, ev, ev.kind, registrarPins ? { registrarPins } : undefined);
      state = next;
      if (ev.kind !== FUNDRAISER_CARD_KIND) continue;
      const d = ev.tags.find((t) => t[0] === 'd')?.[1];
      const fr = ev.tags.find((t) => t[0] === 'fr')?.[1];
      // Only the event the fold actually ACCEPTED may set the fr linkage - a
      // stale replay must not relink the newer card to an old fundraiser.
      // The accepted card is also authoritative in the OTHER direction: a
      // republish without (or with a malformed) fr clears the old link
      // instead of silently inheriting another fundraiser's API identity.
      const acceptedId = state.cards.get(`${FUNDRAISER_CARD_KIND}:${ev.pubkey.toLowerCase()}:${d ?? ''}`)?.eventId;
      if (d && acceptedId === ev.id) {
        const key = `${FUNDRAISER_CARD_KIND}:${ev.pubkey.toLowerCase()}:${d}`;
        if (fr && FR_TAG_RE.test(fr)) frByACoord.set(key, fr);
        else frByACoord.delete(key);
      }
    } catch {
      /* fold is defensive; never break the feed on one bad event */
    }
  }
  return [...state.cards.values()]
    .sort((a, b) => b.createdAt - a.createdAt || a.aCoord.localeCompare(b.aCoord))
    .slice(0, limit)
    .map((c) => {
      const draft = draftFromCard(c.aCoord, c.content, frByACoord.get(c.aCoord));
      const statuses = state.milestoneStatuses.get(c.aCoord);
      const latest = statuses?.[statuses.length - 1];
      return latest && isMilestoneLifecycle(latest.status) ? { ...draft, status: latest.status } : draft;
    });
}

const MILESTONE_LIFECYCLE = ['locked', 'unlocked', 'released', 'refunded'] as const;

function isMilestoneLifecycle(status: string): status is CampaignCardDraft['status'] & string {
  return (MILESTONE_LIFECYCLE as readonly string[]).includes(status);
}

/** Query + fold the relay discovery feed (cards + registrar milestone
 *  statuses). Never throws: an unreachable relay resolves to `[]` so callers
 *  fall back to the API path. */
export async function fetchRelayCards(
  relayUrl: string,
  timeoutMs = CARD_QUERY_TIMEOUT_MS,
  limit = MAX_RELAY_CARDS,
): Promise<CampaignCardDraft[]> {
  let conn: WebRelayConn | null = null;
  try {
    conn = new WebRelayConn(relayUrl);
    const events = await conn.query({ kinds: [FUNDRAISER_CARD_KIND, MILESTONE_STATUS_KIND] }, timeoutMs);
    return draftsFromEvents(events, limit, registrarPinsFor(events, registrarPinFromEnv()));
  } catch {
    return [];
  } finally {
    try {
      conn?.close();
    } catch {
      /* already closed */
    }
  }
}
