// Delete demo auctions published by the demo publishers, via NIP-09.
//
// Usage:
//   node e2e/delete-demo-auctions.mjs            # delete all identities
//   node e2e/delete-demo-auctions.mjs open gated # delete specific identities
//
// Works because the demo publishers persist their seller keys in
// e2e/.demo-keys.json (gitignored) and record every published event id.
// The historical 21,000-sat demos were made before this keyring existed —
// their keys are gone and they can only be filtered client-side or left
// to expire.
import { loadOrCreateKey, getRecordedEvents } from './demo-keyring.mjs';
import { finalizeEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const identities = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['open', 'gated'];
const pool = new SimplePool();
let totalDeleted = 0;

for (const name of identities) {
  const { sk } = loadOrCreateKey(name);
  const eventIds = getRecordedEvents(name);
  if (eventIds.length === 0) {
    console.log(`"${name}": no recorded events, nothing to delete.`);
    continue;
  }
  const del = finalizeEvent(
    {
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventIds.map((id) => ['e', id]),
      content: `Removing ${name} demo listings`,
    },
    sk,
  );
  const pub = pool.publish(RELAYS, del);
  const results = await Promise.allSettled(Object.values(pub));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  totalDeleted += eventIds.length;
  console.log(`"${name}": deletion for ${eventIds.length} event(s) accepted by ${ok}/${RELAYS.length} relays.`);
}

console.log(`\nDone — deletion requests sent for ${totalDeleted} event(s).`);
console.log('Note: NIP-09 only removes events on relays that honor author deletions.');
pool.close(RELAYS);
process.exit(0);
