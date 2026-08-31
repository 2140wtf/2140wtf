// Kill the orphaned 21,000-sat demo auctions the only way that actually
// works without the original keys: NIP-33 parameterized replacement.
//
// Each demo auction is a kind-30402 PARAMETERIZED-REPLACEABLE event
// addressed by `30402:<pubkey>:<d-tag>`. Anyone who can publish to the
// relay CANNOT replace another author's event (pubkey is part of the
// address) — BUT the demo events were all published by OUR OWN ephemeral
// keys... which are gone.
//
// The working alternative: NIP-09 deletions are honored by most relays
// even when the deletion event is OLDER-proof? No. The real mechanism
// that works here: many relays (strfry-based: ditto, primal, nos.lol)
// honor kind-5 deletions for kind-30402 when the deletion carries the
// `a` tag pointing at the address — but still only from the author.
//
// The genuinely working approach without the author key: publish a
// kind-5 deletion AND ALSO re-publish the SAME address (same pubkey is
// impossible) — so the remaining lever is relay-side: most public
// relays expose a DELETE via the NIP-99 `status` tag replacement ONLY
// for the author.
//
// Conclusion: without the author keys the events cannot be removed from
// relays that enforce authorship. This script tries the one remaining
// protocol lever — NIP-09 with both `e` (id) and `a` (address) tags from
// a fresh key — and reports which relays (if any) honor it. Some relays
// with lax deletion policies (e.g. `anyone_can_delete` configs) do.
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const RELAYS = ['wss://relay.ditto.pub','wss://relay.dreamith.to','wss://relay.primal.net','wss://nos.lol'];

// The 5 orphaned 21,000-sat demo auctions: [eventId, pubkey, dTag]
const TARGETS = [
  ['9b13ea0167b1cf6842665474d57093890e53772b01de480028201272a3897cf0', '5e2c959b7eca98eecd4e354256ffe2727694234ea525bdb8ad5ea8d2510d1bff', 'demo-auction-1788121693'],
  ['4f3a3293615015d970008fc20075c66606b5182ac4997e54b3d6ba664566fe1c', '48766d4f32e019adb376ff0a933245bd770002603ee7afcd5e50926cc5412893', 'demo-auction-1788120927'],
  ['bc279cca215f0aa3a0cc25a8bc44c7f192192ce8e5e82f3268d3bc09fc87bf81', '6102e3c262d76277af83e01d5462c07f8c0425862bfc4baac118879b64ff68ec', 'demo-auction-1788119927'],
  ['77ff9751f948e6a083a28924e7f0c5d5a197014ef6e330809516fa5a8927aabd', '5d39bfc73db5303540e8f27ab532677766a8c4f36548b6881adc1918583730d2', 'demo-auction-1788119863'],
  ['aa0226f3a869f16bc4a0cec54abedd7d67dc3236b306176c0ff3a75b544445bd', 'a99c83bf3b025a31cf60ede4d3e6f6fabcc864027453616b1a5dfaf7b9acfdeb', 'demo-auction-1788115029'],
];

const sk = generateSecretKey();
const del = finalizeEvent({
  kind: 5,
  created_at: Math.floor(Date.now() / 1000),
  tags: TARGETS.flatMap(([id, pubkey, d]) => [['e', id], ['a', `30402:${pubkey}:${d}`]]),
  content: 'Removing demo/test listings (published by throwaway test keys)',
}, sk);

const pool = new SimplePool();
const pub = pool.publish(RELAYS, del);
const results = await Promise.allSettled(Object.entries(pub).map(async ([relay, p]) => {
  await p;
  return relay;
}));
const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
console.log(`Deletion (e + a tags) accepted by: ${ok.length ? ok.join(', ') : 'no relays'}`);

// Verify: re-query and count what's still live
await new Promise(r => setTimeout(r, 2000));
const since = Math.floor(Date.now() / 1000) - 90 * 86400;
const events = await pool.querySync(RELAYS, { kinds: [30402], '#t': ['auction'], since, limit: 500 });
const stillThere = new Set(events.map(e => e.id));
const remaining = TARGETS.filter(([id]) => stillThere.has(id)).length;
console.log(`\nVerification: ${TARGETS.length - remaining}/${TARGETS.length} target events gone from relays.`);
console.log(remaining === 0 ? 'SUCCESS — all targets removed.' : `${remaining} events remain (relay enforces author-only deletion).`);
pool.close(RELAYS);
process.exit(0);
