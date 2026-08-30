// Publish a demo auction (kind 30402 with `auction` tag) to the app's relays
// so the Auctions tab isn't empty during review. Run with:
//   node e2e/demo-auction.mjs
//
// Generates an ephemeral seller keypair and publishes a demo auction. Safe:
// it's a throwaway keypair, so nobody "owns" it afterward.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const now = Math.floor(Date.now() / 1000);
const closesAt = now + 72 * 3600; // 3 days — exact finish time, minute precision

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

const eventTemplate = {
  kind: 30402,
  created_at: now,
  tags: [
    ['d', 'demo-auction-' + now],
    ['title', 'Demo Auction — Vintage Bitcoin Poster'],
    ['summary', 'Rare 2013 poster from the Berlin Bitcoin Kiez. Cashu escrow only.'],
    ['t', 'marketplace'],
    ['auction', ''],
    ['price', '21000', 'sat'],
    ['buy-now', '210000', 'sat'],
    ['close', String(closesAt)],
    ['image', 'https://cdn.nostr.build/p/demo-auction-1.jpg'],
  ],
  content: 'Rare 2013 poster from the Berlin Bitcoin Kiez.\n\nCashu escrow only — bids lock real sats via NUT-11 P2PK. Losing bids refund automatically.',
};

const signed = finalizeEvent(eventTemplate, sk);
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
