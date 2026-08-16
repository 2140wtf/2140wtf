// @vitest-environment node
/**
 * Local-relay publish regression test.
 *
 * Verifies the app's actual publish path (sign via the app's nsec signer,
 * publish through the same NPool/NRelay1 APIs `useNostrPublish` uses)
 * against a real in-process Nostr relay on 127.0.0.1. The relay answers
 * EVENT with an immediate OK, so any hang or rejection in the publish
 * pipeline — signing, connection, message framing, pool routing, or the
 * AbortSignal budget — fails deterministically here, without touching
 * external relays.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AddressInfo, WebSocketServer, type WebSocket } from 'ws';
import { NPool, NRelay1, type NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey } from 'nostr-tools';

import { NSecSignerBtc } from '@/lib/bitcoin-signers';

let wss: WebSocketServer;
let port = 0;
const received: NostrEvent[] = [];

async function startRelay(): Promise<number> {
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) return;
      const [type, ...rest] = msg;
      if (type === 'EVENT') {
        received.push(rest[0] as NostrEvent);
        socket.send(JSON.stringify(['OK', (rest[0] as NostrEvent).id, true, 'accepted by local test relay']));
      } else if (type === 'REQ') {
        socket.send(JSON.stringify(['EOSE', rest[0]]));
      }
    });
  });
  return new Promise((resolve) => wss.once('listening', () => resolve((wss.address() as AddressInfo).port)));
}

function localUrl(portNumber: number): string {
  return `ws://127.0.0.1:${portNumber}`;
}

describe('nostr publish against a local relay', () => {
  beforeAll(async () => {
    port = await startRelay();
  });

  afterAll(() => {
    wss?.close();
  });

  test('NRelay1.event publishes a signed kind-1 and the relay stores it', async () => {
    const sk = generateSecretKey();
    const signer = new NSecSignerBtc(sk);
    const event = await signer.signEvent({
      kind: 1,
      content: 'local-relay publish regression test',
      tags: [['client', '2140.wtf']],
      created_at: Math.floor(Date.now() / 1000),
    });

    const relay = new NRelay1(localUrl(port));
    await relay.event(event, { signal: AbortSignal.timeout(10_000) });

    expect(received.some((ev) => ev.id === event.id)).toBe(true);
    relay.close();
  }, 20_000);

  test('NPool.event (useNostrPublish path) resolves on the first relay OK', async () => {
    const sk = generateSecretKey();
    const signer = new NSecSignerBtc(sk);
    const event = await signer.signEvent({
      kind: 1,
      content: 'local-relay pool publish regression test',
      tags: [['client', '2140.wtf']],
      created_at: Math.floor(Date.now() / 1000),
    });

    // Mirrors the app's NostrProvider pool + useNostrPublish call site,
    // including the 30s AbortSignal budget from the publish hook.
    const pool = new NPool({
      open: (url) => new NRelay1(url),
      eventRouter: () => [localUrl(port)],
      reqRouter: () => new Map([[localUrl(port), []]]),
    });

    await pool.event(event, { signal: AbortSignal.timeout(30_000) });

    expect(received.some((ev) => ev.id === event.id)).toBe(true);
  }, 40_000);
});
