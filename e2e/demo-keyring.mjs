// Shared keyring for the demo publisher scripts.
//
// Demo seller keys are persisted to e2e/.demo-keys.json (gitignored) so the
// events they publish can be deleted later with NIP-09. The old behavior —
// a fresh throwaway key each run — made demo events permanently undeletable,
// which is why the 21,000-sat demos are still on the public relays.
//
// Usage from a publisher script:
//   import { loadOrCreateKey, recordEvent, nsecEncode } from './demo-keyring.mjs';
//   const { sk, pubkey } = loadOrCreateKey('open');   // named demo identity
//   ... publish ...
//   recordEvent('open', eventId);                      // remember for deletion
//
// Delete everything published by an identity:
//   node e2e/delete-demo-auctions.mjs open
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

const KEYRING_PATH = join(dirname(fileURLToPath(import.meta.url)), '.demo-keys.json');

function loadKeyring() {
  if (existsSync(KEYRING_PATH)) {
    try {
      return JSON.parse(readFileSync(KEYRING_PATH, 'utf8'));
    } catch {
      // Corrupt keyring: start fresh rather than crash a publish run.
    }
  }
  return {};
}

function saveKeyring(keyring) {
  writeFileSync(KEYRING_PATH, JSON.stringify(keyring, null, 2) + '\n', { mode: 0o600 });
}

/**
 * Load the named demo identity, creating it on first use. The same name
 * always returns the same keypair, so replacements (NIP-33) and deletions
 * (NIP-09) stay possible for everything published under that name.
 */
export function loadOrCreateKey(name) {
  const keyring = loadKeyring();
  if (!keyring[name]) {
    keyring[name] = { nsec: nip19.nsecEncode(generateSecretKey()), events: [] };
    saveKeyring(keyring);
  }
  const entry = keyring[name];
  const sk = nip19.decode(entry.nsec).data;
  return { sk, pubkey: getPublicKey(sk) };
}

/** Record a published event id under the named identity for later deletion. */
export function recordEvent(name, eventId) {
  const keyring = loadKeyring();
  if (!keyring[name]) return;
  if (!keyring[name].events.includes(eventId)) {
    keyring[name].events.push(eventId);
    saveKeyring(keyring);
  }
}

/** All event ids published by the named identity. */
export function getRecordedEvents(name) {
  return loadKeyring()[name]?.events ?? [];
}

/** Delete the named identity's events via NIP-09, using its own key. */
export async function deleteIdentityEvents(name, relays) {
  const { SimplePool } = await import('nostr-tools');
  const { sk } = loadOrCreateKey(name);
  const eventIds = getRecordedEvents(name);
  if (eventIds.length === 0) {
    console.log(`No recorded events for identity "${name}".`);
    return;
  }
  const pool = new SimplePool();
  const del = finalizeEvent(
    {
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: eventIds.map((id) => ['e', id]),
      content: `Removing ${name} demo listings`,
    },
    sk,
  );
  const pub = pool.publish(relays, del);
  const results = await Promise.allSettled(Object.values(pub));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`Deletion for "${name}" accepted by ${ok}/${relays.length} relays (${eventIds.length} events).`);
  pool.close(relays);
}

import { finalizeEvent } from 'nostr-tools';
