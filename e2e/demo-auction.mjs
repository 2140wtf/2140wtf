// Publish a demo auction (kind 30402 with `auction` tag) to the app's relays
// so the Auctions tab isn't empty during review. Run with:
//   node e2e/demo-auction.mjs
//
// Generates an ephemeral seller keypair and publishes a demo auction. Safe:
// it's a throwaway keypair, so nobody "owns" it afterward.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';

const RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.dreamith.to/',
  'wss://relay.primal.net/',
  'wss://nos.lol/',
];

const sk = generateSecretKey();
const pk = getPublicKey(sk);

const now = Math.floor(Date.now() / 1000);
const closesAt = now + 72 * 3600; // 3 days

const eventTemplate = {
  kind: 30402,
  created_at: now,
  tags: [
    ['d', 'demo-auction-0830'],
    ['title', 'Demo Auction — Vintage Bitcoin Poster'],
    ['auction', 'auction'],
    ['price', '21000', 'sats'],
    ['buy_now', '210000'],
    ['summary', 'Demo auction for review: vintage-style Bitcoin poster, A2 print.'],
    ['image', 'https://cdn.nostr.build/i/demo-auction-1.jpg'],
    ['t', 'auction'],
    ['t', 'art'],
    ['published_at', String(now)],
    ['alt', 'Auction: Demo Vintage Bitcoin Poster'],
  ],
  content:
    'Demo auction for review: vintage-style Bitcoin poster, A2 print. ' +
    'Bids lock real Cashu sats in 2-of-3 escrow (bidder, seller, operator). ' +
    'Highest bid wins at close; losing bids refund.',
  };

const signed = finalizeEvent(eventTemplate, sk);
console.log(`Publishing demo auction from ephemeral pubkey ${pk}`);
console.log(`Close time: ${new Date(closesAt * 1000).toISOString()}`);

const pool = new SimplePool();
await Promise.all(
  RELAYS.map(async (url) => {
    try {
      await pool.publish([url], signed);
      console.log(`published to ${url}`);
    } catch (err) {
      console.warn(`publish to ${url} failed:`, err?.message ?? err);
    }
  }),
);
console.log('Published to', RELAYS.length, 'relays');
pool.close(RELAYS);
process.exit(0);
