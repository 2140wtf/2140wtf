import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const TARGETS = [
  ['9b13ea0167b1cf6842665474d57093890e53772b01de480028201272a3897cf0', '5e2c959b7eca98eecd4e354256ffe2727694234ea525bdb8ad5ea8d2510d1bff', 'demo-auction-1788121693'],
  ['4f3a3293615015d970008fc20075c66606b5182ac4997e54b3d6ba664566fe1c', '48766d4f32e019adb376ff0a933245bd770002603ee7afcd5e50926cc5412893', 'demo-auction-1788120927'],
  ['bc279cca215f0aa3a0cc25a8bc44c7f192192ce8e5e82f3268d3bc09fc87bf81', '6102e3c262d76277af83e01d5462c07f8c0425862bfc4baac118879b64ff68ec', 'demo-auction-1788119927'],
  ['77ff9751f948e6a083a28924e7f0c5d5a197014ef6e330809516fa5a8927aabd', '5d39bfc73db5303540e8f27ab532677766a8c4f36548b6881adc1918583730d2', 'demo-auction-1788119863'],
];
const RELAYS = ['wss://relay.ditto.pub','wss://relay.dreamith.to','wss://relay.primal.net','wss://nos.lol'];
const sk = generateSecretKey();

for (const relay of RELAYS) {
  const pool = new SimplePool();
  const del = finalizeEvent({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: TARGETS.flatMap(([id, pubkey, d]) => [['e', id], ['a', `30402:${pubkey}:${d}`]]),
    content: 'Removing demo/test listings published by throwaway test keys',
  }, sk);
  try {
    await pool.publish([relay], del);
  } catch {}
  pool.close([relay]);
}

// Verify per relay
for (const relay of RELAYS) {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync([relay], { kinds: [30402], '#t': ['auction'], limit: 100 });
    const ids = new Set(events.map(e => e.id));
    const remaining = TARGETS.filter(([id]) => ids.has(id)).length;
    console.log(`${relay}: ${TARGETS.length - remaining}/${TARGETS.length} deleted, ${remaining} remain`);
  } catch (e) {
    console.log(`${relay}: query failed`);
  }
  pool.close([relay]);
}
process.exit(0);
