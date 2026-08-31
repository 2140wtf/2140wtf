// Attempt NIP-09 (kind 5) deletion of the 21,000-sat demo auctions and demo
// products. NIP-09 requires the deletion event to be signed by the SAME pubkey
// as the target events. The demo sessions used ephemeral throwaway keys that
// were never persisted — this script proves the attempt fails and documents it.
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const RELAYS = ['wss://relay.ditto.pub','wss://relay.dreamith.to','wss://relay.primal.net','wss://nos.lol'];

// Event IDs to delete (21k auctions + demo products)
const TARGETS = process.argv.slice(2);
if (TARGETS.length === 0) {
  console.log('Usage: node e2e/try-delete-demos.mjs <event-id1> <event-id2> ...');
  process.exit(1);
}

const sk = generateSecretKey(); // fresh key — NOT the authors' keys
const del = finalizeEvent({
  kind: 5,
  created_at: Math.floor(Date.now() / 1000),
  tags: TARGETS.map((id) => ['e', id]),
  content: 'Removing test/demo listings',
}, sk);

const pool = new SimplePool();
const pub = pool.publish(RELAYS, del);
const results = await Promise.allSettled(Object.entries(pub).map(async ([relay, p]) => {
  await p;
  return relay;
}));
const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
const failed = results.filter((r) => r.status === 'rejected').length;
console.log(`Deletion accepted by: ${ok.length ? ok.join(', ') : 'NO RELAYS'}`);
console.log(`Rejected/failed by: ${failed} relays`);
console.log('NOTE: NIP-09 deletions only apply when signed by the original author.');
console.log('The demo events were published with ephemeral keys that no longer exist,');
console.log('so relays keep the originals — deletion from a random key has no effect.');
pool.close(RELAYS);
process.exit(0);
