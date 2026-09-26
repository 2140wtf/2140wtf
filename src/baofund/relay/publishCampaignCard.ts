// src/relay/publishCampaignCard.ts
//
// Relay-first campaign discovery, publisher side: after the Fund API creates
// a campaign, the creator's own key signs a kind-39801 card and publishes it
// to the fund relay. The card is the relay-native record of the campaign;
// the API remains the write authority (ledger/escrow) and is referenced from
// the card content (`api`) plus a `fr` tag carrying the API id.
//
// Every failure is non-fatal for creation: the campaign already exists in the
// API/ledger. Publishing is best-effort and reported to the caller.

import { WebRelayConn } from '@/baofund/community/websocket.js';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  buildFundraiserCardContent,
  cardTags,
  publishFundraiserCard,
  type CardFormat,
  type CardMilestone,
  type CardRail,
} from '../lib/baoCards';
import type { BaoFundraiser, BaoMilestone, SignerLike } from '../lib/baoFundraising';
import { baoRelayUrl } from '../lib/baoFundraising';
import { fundApiOrigin } from '../lib/fundHttp';

export interface PublishCampaignCardResult {
  ok: boolean;
  /** Relay event id (hex) when published. */
  id?: string;
  /** `39801:<creatorPubkey>:<slug>` - the discovery identity of the card. */
  aCoord?: string;
  error?: string;
}

export type CardPublishFn = (t: {
  kind: number;
  content: string;
  tags: string[][];
  relay?: string;
}) => Promise<{ id: string }>;

/** Slug-safe campaign identifier: title + a short API-id suffix so two
 *  campaigns with the same title still get distinct a-coordinates. */
export function campaignSlug(title: string, fundraiserId: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'campaign';
  const suffix = fundraiserId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6) || '0';
  return `${base}-${suffix}`.slice(0, 63);
}

/** Card rail labels the relay card schema accepts. */
export function cardRailsFor(fundraiser: BaoFundraiser): CardRail[] {
  const rail = (fundraiser.settlement_rail ?? '').toLowerCase();
  if (rail.includes('cashu')) return ['cashu'];
  if (rail.includes('liquid')) return ['liquid'];
  if (['lightning', 'bolt', 'nwc', 'spark', 'ark', 'fedimint'].some((r) => rail.includes(r))) return ['lightning'];
  if (rail === 'l1' || rail.includes('bitcoin') || rail.includes('testnet4') || rail.includes('onchain')) return ['l1'];
  // Unknown rails must FAIL CLOSED: publishing them as l1 advertised a rail
  // the campaign never configured (and offered testnet pledges for it).
  return [];
}

export function cardMilestonesFor(milestones: BaoMilestone[]): CardMilestone[] {
  return milestones.map((m) => ({
    id: m.id,
    title: m.title,
    amount: Number.isSafeInteger(m.amount_sats) && m.amount_sats >= 0 ? m.amount_sats : 0,
    status: m.status,
  }));
}

/**
 * Sign + publish the campaign card. Returns `{ ok: false, error }` instead of
 * throwing so callers can surface or ignore a relay-policy rejection without
 * affecting the API-side success.
 */
export async function publishCampaignCard(args: {
  signer: SignerLike;
  fundraiser: BaoFundraiser;
  milestones: BaoMilestone[];
  relayUrl?: string;
  /** Injectable for tests; defaults to sign-with-signer + WebRelayConn. */
  publish?: CardPublishFn;
}): Promise<PublishCampaignCardResult> {
  try {
    const { signer, fundraiser, milestones } = args;
    const relayUrl = args.relayUrl ?? baoRelayUrl();
    const origin = fundApiOrigin();
    const apiUrl = new URL(origin, window.location.origin).toString();
    if (!apiUrl.startsWith('https://')) {
      return { ok: false, error: 'api base must be https to publish a card' };
    }
    const slug = campaignSlug(fundraiser.title, fundraiser.id);
    const content = buildFundraiserCardContent({
      title: fundraiser.title,
      summary: (fundraiser.description ?? '').trim() || fundraiser.title,
      format: (fundraiser.format ?? 'milestones') as CardFormat,
      rails: cardRailsFor(fundraiser),
      milestones: cardMilestonesFor(milestones),
      attestation: 'none',
      api: apiUrl,
      agentHints: { amountUnit: 'sats', canContributeFrom: ['browser', 'mcp'], idempotency: 'pledgeId' },
    });
    const tags = [
      ...cardTags({ slug, title: fundraiser.title, summary: content.summary }),
      // API id so relay-discovered cards can link back to the ledger/escrow
      // record without re-introducing a required API read.
      ['fr', fundraiser.id] as string[],
    ];
    const publish: CardPublishFn =
      args.publish ??
      (async (t) => {
        const signed = (await signer.signEvent({
          kind: t.kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: t.tags,
          content: t.content,
        })) as NostrEvent;
        if (signed.pubkey.toLowerCase() !== fundraiser.owner_pubkey.toLowerCase()) {
          throw new Error('signer does not match campaign owner');
        }
        const conn = new WebRelayConn(t.relay ?? relayUrl);
        try {
          await conn.publish(signed);
        } finally {
          conn.close();
        }
        return { id: signed.id };
      });
    const out = await publishFundraiserCard(publish, {
      creatorPubkey: fundraiser.owner_pubkey,
      slug,
      content,
      tags,
      relay: relayUrl,
    });
    return { ok: true, id: out.id, aCoord: out.aCoord };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
