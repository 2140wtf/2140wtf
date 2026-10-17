import { describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildDmWrap, openDmWrap } from '@/baofund/community/dm.js';
import {
  DM_PAYLOAD_TAG,
  DEFAULT_DM_RELAY_URL,
  DmTransport,
  buildDmPayload,
  dmInboxFilter,
  parseDmPayload,
  publishDmEvent,
  readDmInbox,
  type DmSocketLike,
  type DmWrapEvent,
} from './dmTransport';
import { loadDmRecords, type DmStorageLike } from './dmStore';

const ME_PUB = 'cc'.repeat(32);
const PEER_PUB = 'dd'.repeat(32);

/** Map-backed Storage stub (no jsdom localStorage noise). */
function fakeStorage(): DmStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** One NIP-01 relay shared by every fake socket the factory hands out. */
class FakeRelay {
  readonly url = 'wss://fake.relay';
  events: DmWrapEvent[] = [];
  sockets = new Set<FakeSocket>();
  rejectPublishes = false;
  silentPublishes = false;

  readonly factory = (_url: string): DmSocketLike => {
    const socket = new FakeSocket(this);
    this.sockets.add(socket);
    return socket;
  };

  /** Deliver an event to every live subscriber and retain it for REQ catch-up. */
  deliver(event: DmWrapEvent): void {
    this.events.push(event);
    for (const socket of this.sockets) socket.pushEvent(event);
  }

  onFrame(socket: FakeSocket, frame: unknown[]): void {
    if (frame[0] === 'REQ') {
      const id = String(frame[1]);
      const filter = (frame[2] ?? {}) as { '#p'?: string[]; since?: number; kinds?: number[] };
      socket.reqId = id;
      for (const event of this.events) {
        if (filter.kinds && !filter.kinds.includes(event.kind)) continue;
        if (filter['#p'] && !filter['#p'].includes(event.tags.find((t) => t[0] === 'p')?.[1] ?? '')) continue;
        if (filter.since !== undefined && event.created_at < filter.since) continue;
        socket.pushEvent(event);
      }
      socket.pushFrame(['EOSE', id]);
      return;
    }
    if (frame[0] === 'EVENT') {
      const event = frame[1] as DmWrapEvent;
      if (this.silentPublishes) return;
      if (this.rejectPublishes) {
        socket.pushFrame(['OK', event.id, false, 'blocked: test']);
        return;
      }
      this.events.push(event);
      socket.pushFrame(['OK', event.id, true, '']);
      return;
    }
    if (frame[0] === 'CLOSE') socket.closed = true;
  }
}

class FakeSocket implements DmSocketLike {
  readyState = 0;
  reqId: string | null = null;
  closed = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;

  constructor(private readonly relay: FakeRelay) {
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    if (this.closed) throw new Error('socket closed');
    this.relay.onFrame(this, JSON.parse(data) as unknown[]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  pushFrame(frame: unknown[]): void {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify(frame) });
  }

  pushEvent(event: DmWrapEvent): void {
    if (this.reqId) this.pushFrame(['EVENT', this.reqId, event]);
  }

  /** Simulate a relay-side drop (fires the handler the transport retries on). */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1));
}

function nowSec(): number {
  return 1_700_000_000;
}

describe('dmTransport — payload contract', () => {
  it('round-trips the strict text-DM payload shape', () => {
    expect(parseDmPayload(buildDmPayload('hi'))).toEqual({ text: 'hi' });
    expect(buildDmPayload('hi').t).toBe(DM_PAYLOAD_TAG);
    for (const hostile of [
      null,
      'text',
      { v: 1, t: DM_PAYLOAD_TAG, text: '   ' },
      { v: 2, t: DM_PAYLOAD_TAG, text: 'hi' },
      { v: 1, t: 'bao-call-v1', op: 'offer' },
      { v: 1, t: DM_PAYLOAD_TAG, text: 'x'.repeat(4001) },
      { v: 1, t: DM_PAYLOAD_TAG },
    ]) {
      expect(parseDmPayload(hostile)).toBeNull();
    }
    // Unknown extra fields are dropped, never echoed.
    const parsed = parseDmPayload({ v: 1, t: DM_PAYLOAD_TAG, text: 'hi', evil: '__proto__' });
    expect(parsed).toEqual({ text: 'hi' });
    expect(Object.keys(parsed as object)).toEqual(['text']);
  });

  it('builds the inbox filter the relay lane requires', () => {
    expect(dmInboxFilter(ME_PUB, 123)).toEqual({ kinds: [1059], '#p': [ME_PUB], since: 123, limit: 500 });
    expect(dmInboxFilter(ME_PUB.toUpperCase())['#p']).toEqual([ME_PUB]);
    expect(DEFAULT_DM_RELAY_URL).toBe('wss://relay.bao.fund');
  });
});

describe('dmTransport — send', () => {
  it('publishes a relay-accepted wrap and records the outgoing message', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const incoming = vi.fn();
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec, onIncoming: incoming });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    const peerPub = getPublicKey(peerSecret);
    transport.start(mePub, meSecret);

    const record = await transport.send(peerPub, '  hello peer  ');
    expect(record).toMatchObject({ peer: peerPub, direction: 'out', text: 'hello peer', createdAt: nowSec() });
    expect(relay.events).toHaveLength(1);
    const wrap = relay.events[0] as DmWrapEvent & { kind: number; tags: string[][]; content: string };
    expect(wrap.kind).toBe(1059);
    // The relay write policy: EXACTLY one valid NIP-40 expiration tag.
    expect(wrap.tags.filter((t) => t[0] === 'expiration')).toHaveLength(1);
    expect(Number(wrap.tags.find((t) => t[0] === 'expiration')?.[1])).toBeGreaterThan(1_700_000_000);
    expect(wrap.tags.find((t) => t[0] === '-')).toBeTruthy();
    expect(wrap.tags.find((t) => t[0] === 'p')?.[1]).toBe(peerPub);
    // The recipient can actually open it - that is the lane contract.
    const envelope = openDmWrap(wrap, peerSecret);
    expect(envelope?.from).toBe(mePub);
    expect(envelope?.payload).toEqual({ v: 1, t: DM_PAYLOAD_TAG, text: 'hello peer' });
    expect(loadDmRecords(mePub, storage)).toHaveLength(1);
    expect(incoming).toHaveBeenCalledTimes(1);
    transport.stop();
  });

  it('refuses bad recipients/texts and never appends on publish failure', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec });
    transport.start(ME_PUB, generateSecretKey());

    await expect(transport.send('not-hex', 'hi')).rejects.toThrow(/64-hex/);
    await expect(transport.send(PEER_PUB, '   ')).rejects.toThrow(/empty/);
    await expect(transport.send(PEER_PUB, 'x'.repeat(4001))).rejects.toThrow(/exceeds/);
    expect(relay.events).toHaveLength(0);

    relay.rejectPublishes = true;
    await expect(transport.send(PEER_PUB, 'hi')).rejects.toThrow(/rejected/);
    expect(loadDmRecords(ME_PUB, storage)).toHaveLength(0);

    relay.rejectPublishes = false;
    relay.silentPublishes = true;
    const slow = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec, publishTimeoutMs: 5 });
    slow.start(ME_PUB, generateSecretKey());
    await expect(slow.send(PEER_PUB, 'hi')).rejects.toThrow(/timeout/);
    expect(loadDmRecords(ME_PUB, storage)).toHaveLength(0);
    slow.stop();
    transport.stop();

    await expect(publishDmEvent({ id: 'ab'.repeat(32) } as DmWrapEvent, { relayUrl: relay.url, socketFactory: relay.factory, timeoutMs: 5 })).rejects.toThrow(/timeout/);
  });

  it('rejects send before start', async () => {
    const transport = new DmTransport({ storage: fakeStorage() });
    await expect(transport.send(PEER_PUB, 'hi')).rejects.toThrow(/not started/);
    expect(() => transport.start('nope', generateSecretKey())).toThrow(/64-hex/);
    expect(() => transport.start(ME_PUB, new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe('dmTransport — receive', () => {
  it('decrypts only addressed text DMs, dedupes by wrap id, and ignores hostile payloads', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const incoming = vi.fn();
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec, onIncoming: incoming });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    const peerPub = getPublicKey(peerSecret);
    const otherSecret = generateSecretKey();
    transport.start(mePub, meSecret);
    await flush();

    const textWrap = buildDmWrap(buildDmPayload('from peer'), mePub, peerSecret) as DmWrapEvent;
    relay.deliver(textWrap);
    await flush();
    const records = loadDmRecords(mePub, storage);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: textWrap.id, peer: peerPub, direction: 'in', text: 'from peer' });
    expect(incoming).toHaveBeenCalledTimes(1);

    // Relay replay (reconnect / resubscribe) is idempotent.
    relay.deliver(textWrap);
    await flush();
    expect(loadDmRecords(mePub, storage)).toHaveLength(1);
    expect(incoming).toHaveBeenCalledTimes(1);

    // A wrap for someone else never decrypts - fail closed.
    const foreign = buildDmWrap(buildDmPayload('not yours'), PEER_PUB, otherSecret) as DmWrapEvent;
    relay.deliver(foreign);
    // A call-signaling payload rides the same lane and must NOT render as text.
    const callSignal = buildDmWrap({ v: 1, t: 'bao-call-v1', op: 'offer', callId: 'ab'.repeat(16), iat: 1, exp: 2, rn: '' }, mePub, peerSecret) as DmWrapEvent;
    relay.deliver(callSignal);
    // Garbage / malformed payload JSON is ignored too.
    const garbage = buildDmWrap('just a string', mePub, peerSecret) as DmWrapEvent;
    relay.deliver(garbage);
    await flush();
    expect(loadDmRecords(mePub, storage)).toHaveLength(1);
    expect(incoming).toHaveBeenCalledTimes(1);
    transport.stop();
  });

  it('catch-up: on start it reads the stored backlog from the fake relay', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    relay.deliver(buildDmWrap(buildDmPayload('missed while closed'), mePub, peerSecret) as DmWrapEvent);
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec });
    transport.start(mePub, meSecret);
    await flush();
    expect(loadDmRecords(mePub, storage).map((r) => r.text)).toEqual(['missed while closed']);
    transport.stop();
  });
});

describe('dmTransport — one-shot inbox read (agent verb primitive)', () => {
  it('returns decrypted text DMs within since, sorted and deduped', async () => {
    const relay = new FakeRelay();
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    const peerPub = getPublicKey(peerSecret);
    // `since` filters the OUTER (forward-jittered, +60 s) created_at, so the
    // two fixtures sit > 60 s apart to make the narrowing deterministic.
    const first = buildDmWrap(buildDmPayload('one'), mePub, peerSecret, { clock: { nowSec: () => 1_700_000_000 } }) as DmWrapEvent;
    const second = buildDmWrap(buildDmPayload('two'), mePub, peerSecret, { clock: { nowSec: () => 1_700_000_500 } }) as DmWrapEvent;
    relay.deliver(first);
    relay.deliver(first); // duplicate id
    relay.deliver(second);
    relay.deliver(buildDmWrap({ v: 1, t: 'bao-call-v1' }, mePub, peerSecret) as DmWrapEvent); // not a text DM
    const otherSecret = generateSecretKey();
    relay.deliver(buildDmWrap(buildDmPayload('foreign'), getPublicKey(otherSecret), peerSecret) as DmWrapEvent);

    const inbox = await readDmInbox({ relayUrl: relay.url, pubkey: mePub, secretKey: meSecret, socketFactory: relay.factory, timeoutMs: 500 });
    expect(inbox.messages.map((m) => m.text)).toEqual(['one', 'two']);
    expect(inbox.messages[0]).toMatchObject({ from: peerPub, createdAt: 1_700_000_000 });
    expect(inbox.cursor).toBe(1_700_000_500);

    const narrowed = await readDmInbox({ relayUrl: relay.url, pubkey: mePub, secretKey: meSecret, since: 1_700_000_200, socketFactory: relay.factory, timeoutMs: 500 });
    expect(narrowed.messages.map((m) => m.text)).toEqual(['two']);
    expect(narrowed.cursor).toBe(1_700_000_500);

    const empty = await readDmInbox({ relayUrl: relay.url, pubkey: mePub, secretKey: meSecret, since: 1_700_001_000, socketFactory: relay.factory, timeoutMs: 500 });
    expect(empty.messages).toEqual([]);
    expect(empty.cursor).toBe(1_700_001_000);
  });

  it('rejects when the relay never answers (bounded timeout)', async () => {
    const relay = new FakeRelay();
    relay.onFrame = () => {
      /* swallow every frame: no EOSE, ever */
    };
    await expect(readDmInbox({ relayUrl: relay.url, pubkey: ME_PUB, secretKey: generateSecretKey(), socketFactory: relay.factory, timeoutMs: 5 }))
      .rejects.toThrow(/timeout/);
  });
});

describe('dmTransport — raw lane sink + sendPayload (call signaling)', () => {
  it('fires onLanePayload for text DMs AND call-signaling payloads, with envelope metadata', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const seen: Array<{ payload: unknown; from: string; wrapId: string }> = [];
    const transport = new DmTransport({
      relayUrl: relay.url,
      socketFactory: relay.factory,
      storage,
      nowSec,
      onLanePayload: (payload, envelope) => seen.push({ payload, from: envelope.from, wrapId: envelope.wrapId }),
    });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    const peerPub = getPublicKey(peerSecret);
    transport.start(mePub, meSecret);
    await flush();

    const textWrap = buildDmWrap(buildDmPayload('hi'), mePub, peerSecret) as DmWrapEvent;
    relay.deliver(textWrap);
    const signalPayload = { v: 1, t: 'bao-call-v1', op: 'offer', callId: 'ab'.repeat(16), iat: 1, exp: 999, rn: '', epk: 'cd'.repeat(32), nonce: 'ef'.repeat(16) };
    const signalWrap = buildDmWrap(signalPayload, mePub, peerSecret) as DmWrapEvent;
    relay.deliver(signalWrap);
    await flush();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ from: peerPub, wrapId: textWrap.id });
    // The RAW payload survives intact (epk/nonce included) - the call layer
    // reads the extras that parseCallSignal drops.
    expect(seen[1].payload).toEqual(signalPayload);
    expect(seen[1].wrapId).toBe(signalWrap.id);
    // The text record was still appended exactly once (text wraps only).
    expect(loadDmRecords(mePub, storage)).toHaveLength(1);

    // A throwing sink never breaks the text path.
    const loud = new DmTransport({
      relayUrl: relay.url,
      socketFactory: relay.factory,
      storage: fakeStorage(),
      nowSec,
      onLanePayload: () => {
        throw new Error('sink bug');
      },
    });
    const me2 = generateSecretKey();
    loud.start(getPublicKey(me2), me2);
    await flush();
    relay.deliver(buildDmWrap(buildDmPayload('still handled'), getPublicKey(me2), peerSecret) as DmWrapEvent);
    await flush();
    loud.stop();
    transport.stop();
  });

  it('sendPayload publishes a wrapped signal, never touches the text store, returns the wrap id', async () => {
    const relay = new FakeRelay();
    const storage = fakeStorage();
    const incoming = vi.fn();
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec, onIncoming: incoming });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    const peerSecret = generateSecretKey();
    const peerPub = getPublicKey(peerSecret);
    transport.start(mePub, meSecret);
    await flush();

    const payload = { v: 1, t: 'bao-call-v1', op: 'end', callId: 'ab'.repeat(16), iat: 1, exp: 999, rn: '' };
    const wrapId = await transport.sendPayload(peerPub, payload);
    expect(relay.events).toHaveLength(1);
    const wrap = relay.events[0] as DmWrapEvent;
    expect(wrap.id).toBe(wrapId);
    expect(wrap.tags.find((t) => t[0] === 'p')?.[1]).toBe(peerPub);
    const envelope = openDmWrap(wrap, peerSecret);
    expect(envelope?.payload).toEqual(payload);
    // No text record, no text-incoming event.
    expect(loadDmRecords(mePub, storage)).toHaveLength(0);
    expect(incoming).not.toHaveBeenCalled();

    // Fail closed on bad input / before start.
    await expect(transport.sendPayload('not-hex', payload)).rejects.toThrow(/64-hex/);
    await expect(transport.sendPayload(peerPub, 'text')).rejects.toThrow(/object/);
    await expect(transport.sendPayload(peerPub, null)).rejects.toThrow(/object/);
    const stopped = new DmTransport({ storage: fakeStorage() });
    await expect(stopped.sendPayload(PEER_PUB, payload)).rejects.toThrow(/not started/);
    transport.stop();
  });

  it('self-addressed wraps (multi-device self-copies) decrypt and reach the sink', async () => {
    const relay = new FakeRelay();
    const seen: Array<{ from: string }> = [];
    const transport = new DmTransport({
      relayUrl: relay.url,
      socketFactory: relay.factory,
      storage: fakeStorage(),
      nowSec,
      onLanePayload: (_payload, envelope) => seen.push({ from: envelope.from }),
    });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    transport.start(mePub, meSecret);
    await flush();
    const selfCopy = { v: 1, t: 'bao-call-v1', op: 'accept', callId: 'ab'.repeat(16), iat: 1, exp: 999, rn: '' };
    relay.deliver(buildDmWrap(selfCopy, mePub, meSecret) as DmWrapEvent);
    await flush();
    expect(seen).toEqual([{ from: mePub }]);
    transport.stop();
  });
});

describe('dmTransport — connection lifecycle', () => {
  it('reconnects with backoff after a relay drop and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const relay = new FakeRelay();
      const storage = fakeStorage();
      const states: string[] = [];
      const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage, nowSec, onState: (s) => states.push(s) });
      transport.start(ME_PUB, generateSecretKey());
      expect(states).toEqual(['connecting']);
      await vi.advanceTimersByTimeAsync(1);
      expect(states).toEqual(['connecting', 'live']);

      // Relay-side drop: the transport schedules a bounded-backoff reconnect.
      const first = [...relay.sockets][0];
      first.drop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(states[states.length - 1]).toBe('live');
      expect(states).toContain('retrying');
      expect(relay.sockets.size).toBe(2);

      transport.stop();
      expect(states[states.length - 1]).toBe('stopped');
      const openAfterStop = [...relay.sockets].filter((s) => !s.closed && s.readyState === 1);
      expect(openAfterStop).toHaveLength(0);
      // No retry can resurrect the subscription after stop().
      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.sockets.size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never logs message content on the send or receive path', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    const relay = new FakeRelay();
    const transport = new DmTransport({ relayUrl: relay.url, socketFactory: relay.factory, storage: fakeStorage(), nowSec });
    const meSecret = generateSecretKey();
    const mePub = getPublicKey(meSecret);
    transport.start(mePub, meSecret);
    await flush();
    await transport.send(PEER_PUB, 'sensitive text');
    relay.deliver(buildDmWrap(buildDmPayload('inbound secret'), mePub, generateSecretKey()) as DmWrapEvent);
    await flush();
    transport.stop();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
