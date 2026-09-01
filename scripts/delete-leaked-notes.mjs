#!/usr/bin/env node
/**
 * Delete leaked trollbox notes (NIP-09 kind-5) from the public relays they
 * were published to.
 *
 * The Fal Live TV trollbox once posted plaintext kind-1 #fallive notes to
 * public relays. Only the AUTHOR's key can sign a deletion, so this script
 * must be run by the account owner on their own machine:
 *
 *   NSEC=<your-nsec> node scripts/delete-leaked-notes.mjs --yes <note-id> [...]
 *
 * The nsec is read from the environment and never written anywhere. The
 * `--yes` flag is required so an accidental run is impossible. Relays that
 * honor NIP-09 will hide the notes (relay-dependent; deletion is
 * best-effort — some relays may not propagate it).
 */
import { SimplePool, finalizeEvent } from 'nostr-tools';

const RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.primal.net',
  'wss://relay.dreamith.to',
  'wss://offchain.pub',
  'wss://relay.snort.social',
  'wss://bitcoiner.social',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.jcloud.es',
];

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.error('Refusing: pass --yes to confirm (this signs real kind-5 deletions to public relays).');
  process.exit(1);
}
const ids = args.filter((a) => a !== '--yes');
if (ids.length === 0) {
  console.error('Usage: NSEC=<nsec> node scripts/delete-leaked-notes.mjs --yes <note-id> [...]');
  process.exit(1);
}
if (!process.env.NSEC) {
  console.error('Set NSEC (your account secret key) in the environment — it is read in-process only.');
  process.exit(1);
}

const sk = (await import('nostr-tools')).nip19.decode(process.env.NSEC).data;
const pool = new SimplePool();

for (const id of ids) {
  const del = finalizeEvent(
    { kind: 5, content: '', created_at: Math.floor(Date.now() / 1000), tags: [['e', id]] },
    sk,
  );
  try {
    const results = await pool.publish(RELAYS, del);
    const settled = await Promise.allSettled(results);
    const ok = settled.filter((r) => r.status === 'fulfilled').length;
    console.log(`deleted ${id.slice(0, 12)} → ${ok}/${RELAYS.length} relays confirmed`);
  } catch (e) {
    console.error(`failed ${id.slice(0, 12)}:`, String(e).slice(0, 160));
  }
}
pool.close(RELAYS);
console.log('done.');
