// @vitest-environment node
/**
 * Opt-in LIVE check of the gate-strip ledger path against relay.bao.fund.
 * READ-ONLY (never publishes) and skipped unless explicitly enabled:
 *
 *   BAO_RELAY_LIVE=1 BAO_REGISTRAR_PUBKEY=<64hex> [BAO_REGISTRAR_EPOCH=1] \
 *     npx vitest run src/relay/fundFeed.live.test.ts --testTimeout=60000
 *
 * Proves on REAL relay data that:
 *   1. the registrar-signed kind-49305 fold still executes end-to-end
 *      (the exact-match fix must not break folding);
 *   2. a card whose own a-coordinate is in the fold resolves its strip;
 *   3. NO live card inherits a strip from a same-owner / different-slug
 *      ledger entry (the e2e-bridge-fixture-* misattribution).
 */
import { describe, expect, it } from 'vitest';
import { WebRelayConn } from '@/baofund/community/websocket.js';
import { ESCROW_LEDGER_KIND } from '../lib/baoLedger39805';
import { registrarPinFromConfig, summarizeLedger } from './ledgerFeed';
import { fetchRelayCards } from './relayFeed';
import { gateViewsForCards } from './fundFeed';
import type { CampaignCardDraft } from '../components/frames/FundingCampaignCard';

const LIVE = process.env.BAO_RELAY_LIVE === '1';
const RELAY = process.env.BAO_RELAY_URL ?? 'wss://relay.bao.fund';
const PIN = registrarPinFromConfig(process.env.BAO_REGISTRAR_PUBKEY, process.env.BAO_REGISTRAR_EPOCH);

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe.skipIf(!LIVE || !PIN)('LIVE gate-strip ledger fold against relay.bao.fund (read-only)', () => {
  it('folds real relay chains and projects strips only on the exact a-coordinate', async () => {
    const conn = new WebRelayConn(RELAY);
    let events: Awaited<ReturnType<WebRelayConn['query']>>;
    try {
      events = await conn.query({ kinds: [ESCROW_LEDGER_KIND], limit: 1000 }, 10_000);
    } finally {
      try {
        conn.close();
      } catch {
        /* already closed */
      }
    }
    expect(events.length).toBeGreaterThan(0);

    const ledger = summarizeLedger(events, PIN!);
    const cards = await fetchRelayCards(RELAY);
    const views = gateViewsForCards(cards, ledger, nowSeconds());

    // Exact keying: every projected view is the card's OWN coordinate.
    for (const c of cards) {
      const view = views.get(c.id);
      if (!view) continue;
      expect(ledger.has(c.id)).toBe(true);
      expect(view.campaign).toBe(c.id);
    }

    // No same-owner / different-slug inheritance on the live feed.
    for (const c of cards) {
      const owner = c.ownerPubkey?.toLowerCase();
      const sibling = [...ledger.keys()].some((k) => k !== c.id && k.split(':')[1]?.toLowerCase() === owner);
      if (sibling) expect(views.has(c.id)).toBe(false);
    }

    // Folding still works for a card whose coordinate is in the live fold.
    if (ledger.size > 0) {
      const [campaign, summary] = [...ledger.entries()][0];
      const exact: CampaignCardDraft = {
        id: campaign,
        title: 'live exact-match card',
        description: '',
        category: 'fund',
        pledgedSats: 0,
        goalSats: 0,
        endTimeSec: 0,
        ownerPubkey: campaign.split(':')[1],
      };
      const exactViews = gateViewsForCards([exact], ledger, nowSeconds());
      expect(exactViews.size).toBe(1);
      expect(exactViews.get(campaign)?.campaign).toBe(campaign);
      console.log(
        `LIVE fold: ${ledger.size} registrar chain(s); exact card ${campaign.split(':')[2]} raised=${summary.raisedSats} entries=${summary.entriesCount}; live cards=${cards.length} inherited=${views.size}`,
      );
    } else {
      console.log(`LIVE fold: no registrar-signed chains currently on ${RELAY}; exact-match invariants held for ${cards.length} live card(s)`);
    }
  }, 60_000);
});
