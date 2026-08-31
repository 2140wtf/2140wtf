// Publish a WoT-gated demo auction (min_wot=99) to the app's relays so the
// bid gate can be verified in the browser. Run with:
//   node e2e/demo-auction-gated.mjs
//
// Ephemeral seller keypair — throwaway, nobody owns it afterward.
// min_wot=99 means only a bidder scoring >= 99 from the seller's perspective
// may bid; any fresh account scores 0, so the gate must show the gentle
// block message and disable the confirm button.
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const now = Math.floor(Date.now() / 1000);
const closesAt = now + 7 * 24 * 3600; // 7 days — the long-running demo

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

const eventTemplate = {
  kind: 30402,
  created_at: now,
  tags: [
    ['d', 'demo-auction-gated-' + now],
    ['title', 'Demo Auction — WoT Gated (min 99)'],
    ['summary', 'Gate demo: only bidders with WoT score >= 99 (from seller view) may bid.'],
    ['t', 'auction'],
    ['auction', 'auction'],
    ['price', '1', 'sat'],
    ['min_wot', '99'],
    ['close', String(closesAt)],
    ['image', 'https://cdn.nostr.build/p/demo-auction-gated.jpg'],
  ],
  content: 'WoT-gated demo auction.\n\nBids require a minimum Web of Trust score of 99. Cashu escrow only — bids lock real sats via NUT-11 P2PK.',
};

const signed = finalizeEvent(eventTemplate, sk);
console.log(`Seller pubkey: ${pubkey}`);
console.log(`Event id: ${signed.id}`);
console.log(`Close time: ${new Date(closesAt * 1000).toISOString()}`);

const pool = new SimplePool();
const pub = pool.publish(RELAYS, signed);
const ok = await Promise.any(Object.values(pub).map((p) => p.then(() => true, () => Promise.reject(new Error('rejected')))));
console.log(`Published to at least one relay: ${ok}`);
await new Promise((r) => setTimeout(r, 2500));
pool.close(RELAYS);
