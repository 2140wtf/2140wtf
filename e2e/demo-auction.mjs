// Publish a demo auction (kind 30402 with `auction` tag) to the app's relays
// so the Auctions tab isn't empty during review. Run with:
//   node e2e/demo-auction.mjs
//
// The seller key is persisted in e2e/.demo-keys.json (gitignored) under the
// "open" identity, so this event can be deleted later:
//   node e2e/delete-demo-auctions.mjs open
//
// Demo values are kept minimal (1 sat start, 21 sats buy-now) so people can
// actually participate with tiny Cashu amounts during testing.
import { finalizeEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';
import { loadOrCreateKey, recordEvent } from './demo-keyring.mjs';

// Safety: publishing demo events to the PUBLIC relays creates real Nostr
// content. Require an explicit opt-in so no garbage is created by accident.
if (process.env.ALLOW_DEMO_PUBLISH !== '1') {
  console.error('Refusing to publish demo events to public relays.');
  console.error('This creates real Nostr content visible to the whole ecosystem.');
  console.error('If you really mean it: ALLOW_DEMO_PUBLISH=1 node ' + process.argv[1]);
  process.exit(1);
}

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const now = Math.floor(Date.now() / 1000);
const closesAt = now + 72 * 3600; // 3 days — exact finish time, minute precision

const { sk, pubkey } = loadOrCreateKey('open');

const eventTemplate = {
  kind: 30402,
  created_at: now,
  tags: [
    ['d', 'demo-auction-' + now],
    ['title', 'Demo Auction — Vintage Bitcoin Poster'],
    ['summary', 'Rare 2013 poster from the Berlin Bitcoin Kiez. Cashu escrow only.'],
    ['t', 'auction'],
    ['auction', 'auction'],
    ['price', '1', 'sat'],
    ['buy_now', '21'],
    ['min_wot', '60'],
    ['close', String(closesAt)],
    ['image', 'https://cdn.nostr.build/p/demo-auction-1.jpg'],
  ],
  content: 'Rare 2013 poster from the Berlin Bitcoin Kiez.\n\nCashu escrow only — bids lock real sats via NUT-11 P2PK. Losing bids refund automatically.',
};

const signed = finalizeEvent(eventTemplate, sk);
recordEvent('open', signed.id);
console.log(`Seller pubkey: ${pubkey}`);
console.log(`Event id: ${signed.id}`);
console.log(`Close time: ${new Date(closesAt * 1000).toISOString()}`);

const pool = new SimplePool();
const results = await Promise.any(
  RELAYS.map(async (r) => {
    const ok = await pool.publish(RELAYS, signed);
    return ok;
  })
);
console.log(`Published to at least one relay: ${results}`);

await new Promise((r) => setTimeout(r, 2500));
pool.close(RELAYS);
