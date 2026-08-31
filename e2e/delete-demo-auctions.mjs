// Publish NIP-09 kind-5 deletion events for the 21,000-sat demo auctions.
// Each demo auction was published by an EPHEMERAL throwaway key, so deletion
// must be signed by that same key — which no longer exists. Therefore this
// script instead publishes a *replacement* (NIP-33): the same pubkey:d-tag
// address re-published as an empty/expired auction is impossible without the
// key too.
//
// The only working approach: the demo auctions are parameterized-replaceable
// (kind 30402, NIP-33). Anyone can publish a NEW event to a DIFFERENT d-tag,
// but cannot replace someone else's.
//
// => This script instead deletes the events from the relays that support
//    NIP-09 deletion only by the original author. Since keys are gone, we
//    report what CAN be done and mark the auctions expired via a fresh
//    'status=cancelled' replica is also impossible.
//
// Realistically: relays cannot be forced to delete others' events. The demo
// auctions expire by their `close` tag. This script verifies expiry status
// and reports which have already left the active window.
import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const pool = new SimplePool();
const since = Math.floor(Date.now() / 1000) - 90 * 86400;
const events = await pool.querySync(RELAYS, {
  kinds: [30402],
  '#t': ['auction'],
  since,
  limit: 500,
});

const now = Math.floor(Date.now() / 1000);
const seen = new Map();
for (const e of events) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  const key = `${e.pubkey}:${get('d')}`;
  const prev = seen.get(key);
  if (!prev || e.created_at > prev.created_at) seen.set(key, e);
}

let active = 0;
for (const e of seen.values()) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  const close = Number(get('close'));
  const expired = Number.isFinite(close) && close <= now;
  const price = get('price');
  if (!expired) active++;
  console.log(`${expired ? 'EXPIRED' : 'ACTIVE '} price=${price.padStart(6)} close=${new Date(close * 1000).toISOString()} ${get('title').slice(0, 45)}`);
}
console.log(`--- ${seen.size} total, ${active} still active (not yet past close) ---`);
pool.close(RELAYS);
process.exit(0);
