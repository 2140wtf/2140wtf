/**
 * dmTransport - the relay client for the NIP-17 text-DM lane on
 * `wss://relay.bao.fund` (ADR-dm-calls phase 1).
 *
 *   sendDm:    buildDmWrap(payload, peer, secret) -> kind-1059 EVENT
 *              (the @bao/community builder carries the exactly-one NIP-40
 *              expiration the relay write policy requires)
 *   receive:   NIP-01 REQ `{kinds:[1059], '#p':[me]}` -> openDmWrap(wrap, me)
 *
 * Fail-closed rules:
 *   - a wrap that fails to decrypt / verify / address-us is IGNORED (null);
 *   - a payload that is not the text-DM shape (e.g. the call-signaling rider
 *     on the same lane) is ignored, never rendered as text;
 *   - an incoming wrap is appended to the per-identity store by OUTER WRAP ID,
 *     so relay replays and reconnects are idempotent;
 *   - message content is never logged.
 *
 * The transport is deliberately transport-shape agnostic: it drives a minimal
 * socket surface via an injectable factory, so tests run against a fake relay
 * and the agent kit drives the same logic from node (global WebSocket).
 */

import {
  buildDmWrap,
  openDmWrap,
  DEFAULT_DM_TTL_SEC,
} from '@/baofund/community/dm.js';
import { GIFT_WRAP_KIND } from '@/baofund/community/kinds.js';
import { IDENTITY_HEX } from '../lib/activeIdentity';
import {
  DM_MAX_TEXT,
  appendDmRecord,
  defaultDmStorage,
  type DmRecord,
  type DmStorageLike,
} from './dmStore';

/** Text-DM payload tag. Payloads on the lane: `{v:1, t:'bao-dm-v1', text}`.
 *  Any other payload (e.g. the `bao-call-v1` signaling rider) is not a text
 *  DM and is ignored by this client. */
export const DM_PAYLOAD_TAG = 'bao-dm-v1';

/** The relay the lane lives on - the fund's own relay (owner decision
 *  2026-09-09: one app = one relay). The browser app prefers
 *  `baoRelayUrl()` (VITE_BAO_RELAY_URL override); the agent kit uses this
 *  default. */
export const DEFAULT_DM_RELAY_URL = 'wss://relay.bao.fund';

/** Bound for one inbox read (the store bound; catch-up is idempotent). */
export const DM_INBOX_LIMIT = 500;

/** Envelope metadata handed to the raw lane-payload sink. */
export interface DmLaneEnvelopeMeta {
  /** Outer kind-1059 event id - the relay-visible dedupe/ack handle. */
  wrapId: string;
  /** Sender identity pubkey (lowercase 64-hex), verified by the wrap chain. */
  from: string;
  /** Rumor created_at (the real send time). */
  createdAt: number;
}

/** Nostr event shape (structural) - matches @bao/community's NostrEvent. */
export interface DmWrapEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export function buildDmPayload(text: string): { v: 1; t: typeof DM_PAYLOAD_TAG; text: string } {
  return { v: 1, t: DM_PAYLOAD_TAG, text };
}

/** Strict parse of a lane payload: only the text-DM shape survives; unknown
 *  extra fields are dropped (the parsed object is the only source rendered
 *  downstream). */
export function parseDmPayload(payload: unknown): { text: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (p.v !== 1 || p.t !== DM_PAYLOAD_TAG) return null;
  if (typeof p.text !== 'string' || p.text.trim().length === 0 || p.text.length > DM_MAX_TEXT) return null;
  return { text: p.text };
}

/** Minimal socket surface both browser WebSocket and node's global WebSocket
 *  satisfy; tests inject a fake. */
export interface DmSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}

export type DmSocketFactory = (url: string) => DmSocketLike;

function defaultSocketFactory(url: string): DmSocketLike {
  return new WebSocket(url) as unknown as DmSocketLike;
}

export function dmInboxFilter(pubkey: string, since?: number, limit: number = DM_INBOX_LIMIT): Record<string, unknown> {
  return {
    kinds: [GIFT_WRAP_KIND],
    '#p': [pubkey.toLowerCase()],
    ...(since !== undefined ? { since } : {}),
    limit,
  };
}

export interface DmInboxMessage {
  id: string;
  from: string;
  text: string;
  createdAt: number;
}

/**
 * One-shot inbox read (agent verbs; also the transport's catch-up primitive):
 * REQ the recipient's wraps, decrypt each with openDmWrap, keep only text-DM
 * payloads, dedupe by wrap id, ascending by rumor created_at. Never throws on
 * hostile content; a relay/socket failure rejects.
 */
export async function readDmInbox(query: {
  relayUrl: string;
  pubkey: string;
  secretKey: Uint8Array;
  since?: number;
  /** Return at most this many messages (newest kept); 1..500, default 100. */
  limit?: number;
  timeoutMs?: number;
  socketFactory?: DmSocketFactory;
}): Promise<{ messages: DmInboxMessage[]; cursor: number }> {
  const socket = (query.socketFactory ?? defaultSocketFactory)(query.relayUrl);
  const timeoutMs = query.timeoutMs ?? 8_000;
  const limit = Math.min(DM_INBOX_LIMIT, Math.max(1, Number.isSafeInteger(query.limit) ? (query.limit as number) : 100));
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('dm inbox timeout'))), timeoutMs);
    const found = new Map<string, DmInboxMessage>();
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(['REQ', 'bao-dm-inbox', dmInboxFilter(query.pubkey, query.since, limit)]));
      } catch {
        finish(() => reject(new Error('dm inbox send failed')));
      }
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as unknown[];
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === 'bao-dm-inbox' && msg[2]) {
          const envelope = openDmWrap(msg[2] as DmWrapEvent, query.secretKey);
          const parsed = envelope ? parseDmPayload(envelope.payload) : null;
          if (!envelope || !parsed) return;
          if (!found.has(envelope.wrapId)) {
            found.set(envelope.wrapId, {
              id: envelope.wrapId,
              from: envelope.from.toLowerCase(),
              text: parsed.text,
              createdAt: envelope.createdAt,
            });
          }
        }
        if (msg[0] === 'EOSE' && msg[1] === 'bao-dm-inbox') {
          const messages = [...found.values()]
            .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
            .slice(-limit);
          finish(() => resolve({ messages, cursor: messages.length > 0 ? messages[messages.length - 1].createdAt : query.since ?? 0 }));
        }
      } catch {
        /* malformed frame - ignored (fail closed) */
      }
    };
    socket.onerror = () => finish(() => reject(new Error('dm inbox relay error')));
  });
}

/**
 * Publish one signed kind-1059 wrap and wait for the relay OK. Rejects on
 * timeout/rejection; never logs the event.
 */
export async function publishDmEvent(
  event: DmWrapEvent,
  opts: { relayUrl: string; timeoutMs?: number; socketFactory?: DmSocketFactory },
): Promise<void> {
  const socket = (opts.socketFactory ?? defaultSocketFactory)(opts.relayUrl);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('dm publish timeout'))), timeoutMs);
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(['EVENT', event]));
      } catch {
        finish(() => reject(new Error('dm publish send failed')));
      }
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as unknown[];
        if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
        if (msg[2] === true) finish(() => resolve());
        else finish(() => reject(new Error('dm publish rejected by relay')));
      } catch {
        /* malformed frame - keep waiting for the OK / timeout */
      }
    };
    socket.onerror = () => finish(() => reject(new Error('dm publish relay error')));
  });
}

export type DmConnectionState = 'connecting' | 'live' | 'retrying' | 'stopped';

export interface DmTransportOptions {
  /** Relay endpoint; defaults to the fund relay. */
  relayUrl?: string;
  socketFactory?: DmSocketFactory;
  /** Per-identity store (localStorage by default; null in node). */
  storage?: DmStorageLike | null;
  /** Inject the clock for tests (defaults to wall clock, seconds). */
  nowSec?: () => number;
  /** NIP-40 TTL for outgoing wraps (default 48 h; min 60 s). */
  ttlSec?: number;
  /** Fired after a NEW incoming record was appended (not on duplicates). */
  onIncoming?: (record: DmRecord) => void;
  /**
   * Raw lane-payload sink: fires for EVERY decryptable, addressed payload
   * (text DMs INCLUDED, and self-addressed wraps) with the envelope
   * metadata. The call layer reads `bao-call-v1` payloads and their raw
   * `epk`/`nonce` extras here (parseCallSignal validates the schema but
   * drops unknown fields by design - see dmCallLane.ts); the text client
   * keeps ignoring anything that is not the text shape. A throwing sink
   * never breaks the transport (errors are swallowed).
   */
  onLanePayload?: (payload: unknown, envelope: DmLaneEnvelopeMeta) => void;
  onState?: (state: DmConnectionState) => void;
  /** Publish acknowledgement budget, ms. */
  publishTimeoutMs?: number;
}

/**
 * Live inbox subscription + send path for the ACTIVE identity. `start`
 * subscribes `#p = pubkey` with reconnect backoff; `stop` tears the socket
 * down. One instance per identity - the hook recreates it on identity change.
 */
export class DmTransport {
  private readonly relayUrl: string;
  private readonly socketFactory: DmSocketFactory;
  private readonly storage: DmStorageLike | null;
  private readonly nowSec: () => number;
  private readonly ttlSec: number;
  private readonly publishTimeoutMs: number;

  private socket: DmSocketLike | null = null;
  private pubkey: string | null = null;
  private secretKey: Uint8Array | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subId = `bao-dm-${Math.random().toString(36).slice(2, 10)}`;

  constructor(private readonly options: DmTransportOptions = {}) {
    this.relayUrl = options.relayUrl ?? DEFAULT_DM_RELAY_URL;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.storage = options.storage === undefined ? defaultDmStorage() : options.storage;
    this.nowSec = options.nowSec ?? (() => Math.floor(Date.now() / 1000));
    this.ttlSec = options.ttlSec ?? DEFAULT_DM_TTL_SEC;
    this.publishTimeoutMs = options.publishTimeoutMs ?? 8_000;
  }

  /** Subscribe as `pubkey` (64-hex) using `secretKey`. Replaces any previous
   *  identity subscription. */
  start(pubkey: string, secretKey: Uint8Array): void {
    this.stop();
    if (!IDENTITY_HEX.test(pubkey)) throw new Error('dm: pubkey must be 64-hex');
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) throw new Error('dm: secret key must be 32 bytes');
    this.pubkey = pubkey.toLowerCase();
    this.secretKey = secretKey;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.attempt = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
    if (this.pubkey) this.options.onState?.('stopped');
  }

  private open(): void {
    if (this.stopped || !this.pubkey) return;
    this.options.onState?.(this.attempt === 0 ? 'connecting' : 'retrying');
    let socket: DmSocketLike;
    try {
      socket = this.socketFactory(this.relayUrl);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      this.attempt = 0;
      this.options.onState?.('live');
      try {
        socket.send(JSON.stringify(['REQ', this.subId, dmInboxFilter(this.pubkey as string)]));
      } catch {
        /* socket died between open and send - onclose retries */
      }
    };
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onerror = () => {
      /* onclose carries the retry */
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.attempt = Math.min(this.attempt + 1, 6);
    this.retryTimer = setTimeout(() => this.open(), Math.min(30_000, 500 * 2 ** this.attempt));
  }

  private handleFrame(data: unknown): void {
    try {
      const msg = JSON.parse(String(data)) as unknown[];
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT' && msg[1] === this.subId && msg[2]) {
        this.handleEvent(msg[2] as DmWrapEvent);
      }
    } catch {
      /* malformed frame - ignored */
    }
  }

  /** Decrypt + append one wrap. Returns the appended record, or null when the
   *  wrap is not ours / not decryptable / not a text DM / already stored. */
  handleEvent(event: DmWrapEvent): DmRecord | null {
    if (!this.pubkey || !this.secretKey) return null;
    const envelope = openDmWrap(event, this.secretKey);
    if (!envelope) return null;
    // Raw lane sink fires for every decryptable addressed payload (text
    // included) BEFORE the text-shape filter - the call layer needs the
    // `bao-call-v1` shapes and, crucially, the raw `epk`/`nonce` extras
    // that parseCallSignal drops. A broken sink is contained.
    try {
      this.options.onLanePayload?.(envelope.payload, {
        wrapId: envelope.wrapId,
        from: envelope.from.toLowerCase(),
        createdAt: envelope.createdAt,
      });
    } catch {
      /* a broken lane sink must never break the text path */
    }
    const parsed = parseDmPayload(envelope.payload);
    if (!parsed) return null;
    const result = appendDmRecord(
      this.pubkey,
      {
        id: envelope.wrapId,
        peer: envelope.from,
        direction: 'in',
        text: parsed.text,
        createdAt: envelope.createdAt,
      },
      this.storage,
    );
    if (result.appended && result.record) {
      this.options.onIncoming?.(result.record);
      return result.record;
    }
    return null;
  }

  /**
   * Build + publish a text DM to `peerPub` and record it locally (direction
   * 'out'). The record is appended only AFTER the relay OK - a failed publish
   * is not shown as sent. Never logs content.
   */
  async send(peerPub: string, text: string): Promise<DmRecord> {
    if (this.stopped || !this.pubkey || !this.secretKey) throw new Error('dm: transport not started');
    const peer = typeof peerPub === 'string' && IDENTITY_HEX.test(peerPub) ? peerPub.toLowerCase() : null;
    if (!peer) throw new Error('dm: recipient must be a 64-hex pubkey');
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) throw new Error('dm: message text is empty');
    if (body.length > DM_MAX_TEXT) throw new Error(`dm: message text exceeds ${DM_MAX_TEXT} chars`);
    const wrap = buildDmWrap(buildDmPayload(body), peer, this.secretKey, { ttlSec: this.ttlSec }) as DmWrapEvent;
    await publishDmEvent(wrap, {
      relayUrl: this.relayUrl,
      timeoutMs: this.publishTimeoutMs,
      socketFactory: this.socketFactory,
    });
    const record: DmRecord = {
      id: wrap.id,
      peer,
      direction: 'out',
      text: body,
      createdAt: this.nowSec(),
    };
    appendDmRecord(this.pubkey, record, this.storage);
    this.options.onIncoming?.(record);
    return record;
  }

  /**
   * Build + publish an ARBITRARY lane payload to `peerPub` (the call-signal
   * path). Unlike `send`, this does NOT touch the text-DM store and does NOT
   * fire `onIncoming` - call signaling is not a text message. Returns the
   * published wrap id (the caller's own self-copy dedupe handle). A failed
   * publish rejects; the caller decides whether the failure is fatal.
   * Content is never logged.
   */
  async sendPayload(peerPub: string, payload: unknown): Promise<string> {
    if (this.stopped || !this.pubkey || !this.secretKey) throw new Error('dm: transport not started');
    const peer = typeof peerPub === 'string' && IDENTITY_HEX.test(peerPub) ? peerPub.toLowerCase() : null;
    if (!peer) throw new Error('dm: recipient must be a 64-hex pubkey');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('dm: payload must be an object');
    const wrap = buildDmWrap(payload, peer, this.secretKey, { ttlSec: this.ttlSec }) as DmWrapEvent;
    await publishDmEvent(wrap, {
      relayUrl: this.relayUrl,
      timeoutMs: this.publishTimeoutMs,
      socketFactory: this.socketFactory,
    });
    return wrap.id;
  }
}
