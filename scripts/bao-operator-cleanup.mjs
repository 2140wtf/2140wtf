#!/usr/bin/env node
/**
 * Operator cleanup helper for ₿AO relay residue.
 *
 * Deletes kind-1059 Concord wraps and kind-39998 sponsorship records that
 * survived a failed purge/dissolve. The relay's operator-deletion policy
 * honors a kind-5 signed by any BAO_RELAY_OPERATOR_PUBKEYS member for these
 * kinds regardless of the original event author.
 *
 * Usage:
 *   OPERATOR_NSEC=nsec1... node scripts/bao-operator-cleanup.mjs <community-id-hex> [<community-id-hex> ...]
 *
 * The nsec can also be entered interactively (not echoed).
 */

import { createRequire } from 'node:module';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const { nip19, getPublicKey, finalizeEvent } = require('nostr-tools/pure');
const WebSocket = require('ws');

const RELAY = 'wss://relay.bao.network';
const EXPECTED_OPERATOR_PUBKEY =
  'fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function loadSigner() {
  let nsec = process.env.OPERATOR_NSEC?.trim();
  if (!nsec) {
    const answer = await ask('Operator nsec (input hidden): ');
    nsec = answer.trim();
  }
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('Provided key is not an nsec');
  const sk = decoded.data;
  const pubkey = getPublicKey(sk);
  if (pubkey !== EXPECTED_OPERATOR_PUBKEY) {
    throw new Error(
      `Derived pubkey ${pubkey} does not match expected operator ${EXPECTED_OPERATOR_PUBKEY}`,
    );
  }
  return { sk, pubkey };
}

function req(ws, filter) {
  return new Promise((resolve, reject) => {
    const sub = Math.random().toString(36).slice(2);
    const events = [];
    const timer = setTimeout(() => {
      try {
        ws.send(JSON.stringify(['CLOSE', sub]));
      } catch {}
      reject(new Error('REQ timeout'));
    }, 20_000);
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === 'EVENT' && msg[1] === sub) events.push(msg[2]);
      if (msg[0] === 'EOSE' && msg[1] === sub) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        try {
          ws.send(JSON.stringify(['CLOSE', sub]));
        } catch {}
        resolve(events);
      }
      if (msg[0] === 'CLOSED' && msg[1] === sub) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(events);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(['REQ', sub, filter]));
  });
}

function publish(ws, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PUBLISH timeout')), 20_000);
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] !== 'OK') return;
      if (msg[1] !== event.id) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      if (msg[2]) resolve(msg[3] ?? 'accepted');
      else reject(new Error(msg[3] ?? 'relay rejected'));
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify(['EVENT', event]));
  });
}

async function collectTargets(ws, communityIdHex) {
  const targets = [];

  // Latest sponsorship (may be a dissolve-only record with one stream).
  const sponsorships = await req(ws, {
    kinds: [39998],
    authors: [EXPECTED_OPERATOR_PUBKEY],
    '#d': [communityIdHex],
  });
  for (const ev of sponsorships) {
    targets.push({ id: ev.id, kind: ev.kind });
  }

  // Wraps on the stream pubkeys still advertised by the latest sponsorship.
  const streamPks = sponsorships.flatMap((ev) =>
    ev.tags.filter((t) => t[0] === 'stream').map((t) => t[1]),
  );
  const seen = new Set();
  for (const pk of streamPks) {
    if (seen.has(pk)) continue;
    seen.add(pk);
    const wraps = await req(ws, { kinds: [1059], authors: [pk], limit: 500 });
    for (const w of wraps) targets.push({ id: w.id, kind: w.kind });
  }

  return targets;
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Usage: OPERATOR_NSEC=nsec1... node scripts/bao-operator-cleanup.mjs <community-id-hex> ...');
    process.exit(1);
  }

  const { sk, pubkey } = await loadSigner();
  console.log(`Operator pubkey: ${pubkey.slice(0, 16)}...`);

  const ws = new WebSocket(RELAY, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  try {
    for (const id of ids) {
      console.log(`\n=== ${id.slice(0, 16)}... ===`);
      const targets = await collectTargets(ws, id);
      console.log(`targets: ${targets.length}`);
      if (targets.length === 0) continue;

      // One kind-5 per 100 targets to stay under tag limits.
      for (let i = 0; i < targets.length; i += 100) {
        const batch = targets.slice(i, i + 100);
        const tags = batch.flatMap((t) => [
          ['e', t.id],
          ['k', String(t.kind)],
        ]);
        const deletion = finalizeEvent(
          {
            kind: 5,
            content: '',
            tags,
            created_at: Math.floor(Date.now() / 1000),
          },
          sk,
        );
        try {
          const reason = await publish(ws, deletion);
          console.log(`  batch ${i / 100 + 1}: ${reason}`);
        } catch (err) {
          console.error(`  batch ${i / 100 + 1} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  } finally {
    ws.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
