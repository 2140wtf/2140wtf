/**
 * Relay storage observation (spec §2.1, review R07).
 * A fresh signed event must be accepted and independently delivered live.
 * A THIRD connection queries it: a verified return shows storage;
 * EOSE without it records only that this sample was not served back.
 * Rejection, missing delivery and transport failure remain inconclusive.
 * No negative query can prove a hostile relay never stores private traffic.
 * Scribe history and shield routing are separate retention/privacy surfaces.
 */

export interface ProbeOptions {
  /** Relay base URL: ws:// or wss:// (the same URL used for the session). */
  relayUrl: string;
  /** WebSocket constructor (browser `WebSocket` or `ws` import in Node). */
  WebSocketCtor: typeof WebSocket;
  /** Optional fetch impl for the NIP-11 document (http(s) URL derived from relayUrl). */
  fetchFn?: typeof fetch;
  /** Overall budget for publish+readback (default 8s). */
  timeoutMs?: number;
  /** Skip the NIP-11 document check (pure wire probe). */
  skipDocument?: boolean;
}

export interface StorageProbeResult {
  /** Wire verdict: did the relay serve the "ephemeral" event back? */
  storesEphemeral: boolean;
  /** True when the probe completed decisively (no timeout/protocol error). */
  conclusive: boolean;
  /** Independent observations; rejection never establishes non-retention. */
  accepted?: boolean;
  liveDelivered: boolean;
  /** NIP-11 storage assertion, when present and parseable (§2.1). */
  advertisedEphemeralKinds?: number[];
  /** NIP-11 doc reachable? */
  documentReachable?: boolean;
  /** Human-readable summary for logs/UI. */
  detail: string;
}

const PROBE_MARKER = 'bao-storage-probe-v1';

function httpUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws/, 'http');
}

/** Fetch and parse the relay's NIP-11 document (best-effort). */
export async function fetchRelayDocument(
  relayUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(httpUrl(relayUrl), {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the §2.1 storage assertion from a NIP-11 document, if any. */
export function advertisedEphemeralKinds(doc: Record<string, unknown> | null): number[] | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const storage = doc['storage'];
  if (!storage || typeof storage !== 'object') return undefined;
  const kinds = (storage as Record<string, unknown>)['ephemeralKinds'];
  if (!Array.isArray(kinds)) return undefined;
  return kinds.filter((k): k is number => typeof k === 'number' && Number.isSafeInteger(k) && k >= 0 && k <= 65535);
}

/**
 * Run the storage probe. NEVER publishes anything but the self-tagged probe
 * event, and the event content is inert (the marker string only).
 */
export async function probeRelayStorage(opts: ProbeOptions): Promise<StorageProbeResult> {
  const { relayUrl, WebSocketCtor, timeoutMs = 8_000 } = opts;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Probe timeout must be between 0 and 60000 ms');
  const url = new URL(relayUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Probe requires a WebSocket URL without credentials');

  // 1. NIP-11 document (best-effort, independent of the wire probe).
  let doc: Record<string, unknown> | null = null;
  let advertised: number[] | undefined;
  if (!opts.skipDocument) {
    const fetchFn = opts.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
    if (fetchFn) {
      doc = await fetchRelayDocument(relayUrl, fetchFn);
      advertised = advertisedEphemeralKinds(doc);
    }
  }

  // 2. Wire probe: publish a kind-21045 and try to read it back.
  const verdict = await wireProbe(relayUrl, WebSocketCtor, timeoutMs);
  let detail: string;
  if (!verdict.conclusive) {
    detail = `probe inconclusive (${verdict.error ?? 'timeout'}) - treat the relay as storing`;
  } else if (verdict.servedBack) {
    detail = `relay STORES kind-21045 (served back by id) - ephemeral claim NOT honored on the wire`;
  } else {
    detail = `relay delivered live but did NOT serve the probe to a fresh reader - no retention observed in this sample`;
  }

  const result: StorageProbeResult = {
    storesEphemeral: verdict.conclusive ? verdict.servedBack : true, // fail-closed
    conclusive: verdict.conclusive,
    accepted: verdict.accepted,
    liveDelivered: verdict.liveDelivered,
    detail,
  };
  if (advertised !== undefined) result.advertisedEphemeralKinds = advertised;
  if (doc !== null) result.documentReachable = true;
  return result;
}

interface WireVerdict {
  conclusive: boolean;
  servedBack: boolean;
  accepted?: boolean;
  liveDelivered: boolean;
  error?: string;
}

/** Independent live subscriber and fresh reader distinguish delivery from
 * persistence. Rejection, missing live delivery and protocol errors remain
 * unknown. Even a completed negative read cannot prove a relay never stores. */
async function wireProbe(relayUrl: string, WebSocketCtor: typeof WebSocket, timeoutMs: number): Promise<WireVerdict> {
  const { buildProbeEvent, isProbeEvent } = await probeEventModule();
  const ev = buildProbeEvent(PROBE_MARKER);
  return new Promise(resolve => {
    const sockets: WebSocket[] = [];
    let settled = false;
    let accepted: boolean | undefined;
    let liveDelivered = false;
    let servedBack = false;
    let writerOpen = false;
    let observerReady = false;
    let published = false;
    let readerStarted = false;
    let writer: WebSocket;
    const finish = (conclusive: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const socket of sockets) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch { /* already closed */ }
      }
      resolve({ conclusive, servedBack, accepted, liveDelivered, error });
    };
    const timer = setTimeout(() => finish(false, 'timeout or missing live delivery'), timeoutMs);
    const send = (socket: WebSocket, message: unknown[]) => {
      if (settled) return;
      try { socket.send(JSON.stringify(message)); } catch { finish(false, 'send failed'); }
    };
    const connect = (onOpen: (socket: WebSocket) => void, onMessage: (message: unknown[]) => void) => {
      const socket = new WebSocketCtor(relayUrl);
      sockets.push(socket);
      socket.onopen = () => { if (!settled) onOpen(socket); };
      socket.onmessage = event => {
        if (settled) return;
        let message: unknown;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (Array.isArray(message)) onMessage(message);
      };
      socket.onerror = () => finish(false, 'websocket error');
      socket.onclose = () => finish(false, 'connection closed mid-probe');
      return socket;
    };
    const publish = () => {
      if (published || !writerOpen || !observerReady || settled) return;
      published = true;
      send(writer, ['EVENT', ev]);
    };
    const readFresh = () => {
      if (readerStarted || !accepted || !liveDelivered || settled) return;
      readerStarted = true;
      try {
        connect(socket => send(socket, ['REQ', 'probe-read', { ids: [ev.id], authors: [ev.pubkey] }]), message => {
          if (message[0] === 'EVENT' && message[1] === 'probe-read') {
            if (isProbeEvent(message[2], ev.id)) {
              servedBack = true;
              finish(true); // Positive evidence does not need EOSE.
            } else if ((message[2] as { id?: string })?.id === ev.id) finish(false, 'invalid signed readback');
          } else if (message[0] === 'EOSE' && message[1] === 'probe-read') finish(true);
          else if (message[0] === 'CLOSED' && message[1] === 'probe-read') finish(false, 'read subscription rejected');
        });
      } catch { finish(false, 'fresh-reader connection failed'); }
    };
    try {
      writer = connect(() => { writerOpen = true; publish(); }, message => {
        if (message[0] !== 'OK' || message[1] !== ev.id || !published || accepted !== undefined) return;
        if (typeof message[2] !== 'boolean') return finish(false, 'malformed publish acknowledgement');
        accepted = message[2];
        if (!accepted) return finish(false, 'publish rejected; storage behavior unproven');
        readFresh();
      });
      connect(socket => send(socket, ['REQ', 'probe-live', { kinds: [21045], ids: [ev.id], authors: [ev.pubkey] }]), message => {
        if (message[0] === 'EOSE' && message[1] === 'probe-live') { observerReady = true; publish(); }
        else if (message[0] === 'EVENT' && message[1] === 'probe-live' && published && isProbeEvent(message[2], ev.id)) {
          liveDelivered = true;
          readFresh();
        } else if (message[0] === 'CLOSED' && message[1] === 'probe-live') finish(false, 'live subscription rejected');
      });
    } catch { finish(false, 'connection failed'); }
  });
}

// ─── Probe event builder ────────────────────────────────────────────────────
// Lazy dynamic import so browser bundles only pull nostr-tools when probing.
let probeEventModulePromise: Promise<{ buildProbeEvent: (marker: string) => ProbeEvent; isProbeEvent: (value: unknown, id: string) => boolean }> | null = null;

interface ProbeEvent {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

function probeEventModule() {
  probeEventModulePromise ??= (async () => {
    const pure = await import('nostr-tools/pure');
    return {
      isProbeEvent: (value: unknown, id: string): boolean => {
        try {
          const event = value as ProbeEvent;
          return event?.id === id && pure.verifyEvent(event);
        } catch { return false; }
      },
      buildProbeEvent: (marker: string): ProbeEvent => {
        const sk = pure.generateSecretKey();
        const ev = pure.finalizeEvent(
          {
            kind: 21045,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['probe', marker]],
            content: marker,
          },
          sk,
        );
        return ev as unknown as ProbeEvent;
      },
    };
  })();
  return probeEventModulePromise;
}
