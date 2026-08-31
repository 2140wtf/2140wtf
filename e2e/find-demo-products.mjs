// Find kind-30402 NIP-99 product listings (no auction tag) from the demo
// sessions — the "products" spamming the Merchants listings feed.
import { SimplePool } from 'nostr-tools';

const RELAYS = ['wss://relay.ditto.pub','wss://relay.dreamith.to','wss://relay.primal.net','wss://nos.lol'];
const pool = new SimplePool();
const since = Math.floor(Date.now() / 1000) - 14 * 86400;
const events = await pool.querySync(RELAYS, { kinds: [30402], since, limit: 500 });

const seen = new Map();
for (const e of events) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  const key = `${e.pubkey}:${get('d')}`;
  const prev = seen.get(key);
  if (!prev || e.created_at > prev.created_at) seen.set(key, e);
}

const demoKeys = [];
for (const e of seen.values()) {
  const get = (k) => e.tags.find((t) => t[0] === k)?.[1] ?? '';
  const isAuction = get('auction') === 'auction';
  const title = get('title');
  // Demo products: published by our test sessions (titles/summary match the demo patterns)
  const demoish = /demo|test|poster|bnpl|bao/i.test(title) || /demo/i.test(get('summary')) || /demo/i.test(e.content.slice(0, 120));
  if (!isAuction && demoish) {
    demoKeys.push({ id: e.id, pubkey: e.pubkey, d: get('d'), title: title.slice(0, 60), created: new Date(e.created_at*1000).toISOString(), price: get('price') });
    console.log(JSON.stringify(demoKeys[demoKeys.length-1]));
  }
}
console.log(`--- ${demoKeys.length} demo-ish product listings ---`);
pool.close(RELAYS);
process.exit(0);
