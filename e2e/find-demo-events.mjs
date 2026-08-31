// Query the app relays for kind-30402 auction events and dump
// id / pubkey / created_at / price / buy_now / d-tag for each,
// so we can identify which were published by our demo scripts.
import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const pool = new SimplePool();
const since = Math.floor(Date.now() / 1000) - 90 * 86400;
const events = await await pool.querySync(RELAYS, {
  kinds: [30402],
  '#t': ['auction'],
  since,
  limit: 500,
});

const seen = new Map();
for (const e of events) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  const key = `${e.pubkey}:${get('d')}`;
  const prev = seen.get(key);
  if (!prev || e.created_at > prev.created_at) seen.set(key, e);
}

for (const e of seen.values()) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  console.log(JSON.stringify({
    id: e.id,
    pubkey: e.pubkey,
    created: new Date(e.created_at * 1000).toISOString(),
    title: get('title').slice(0, 50),
    price: get('price'),
    priceUnit: e.tags.find((t) => t[0] === 'price')?.[2] ?? '',
    buyNow: get('buy_now') || get('buy-now'),
    close: get('close'),
    d: get('d'),
  }));
}
console.log(`--- total: ${seen.size} unique auctions ---`);
pool.close(RELAYS);
process.exit(0);
