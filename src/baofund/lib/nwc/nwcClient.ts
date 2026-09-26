/**
 * nwcClient - a minimal NIP-47 (Nostr Wallet Connect) client.
 *
 * Host-agnostic on purpose: the WebSocket transport is injectable, so the
 * same module runs in the app (one connection per identity, stored wherever
 * the host keeps secrets) and in the static court page (inlined bundle,
 * browser storage). Nothing here touches storage, DOM or window.
 *
 * Supports NIP-44 v2 payload encryption with the legacy NIP-04 as fallback;
 * the wallet's kind-13194 info event picks the version when advertised, and
 * responses self-heal to whichever scheme actually decrypts.
 *
 * Methods used by the BAO zaps: get_info, get_balance, pay_invoice,
 * lookup_invoice. Spec: https://github.com/nostr-protocol/nips/blob/master/47.md
 */

import { finalizeEvent, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import {
  getConversationKey,
  encrypt as nip44EncryptRaw,
  decrypt as nip44DecryptRaw,
} from 'nostr-tools/nip44';
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04';
import { hexToBytes } from '@noble/hashes/utils.js';

export interface NwcConnection {
  /** Wallet service pubkey (hex). */
  walletPubkey: string;
  /** Relay URLs from the connection string, in order. */
  relays: string[];
  /** Client secret (hex) - a bearer credential for this connection. */
  secret: string;
}

/** The slice of the WebSocket API this client needs (injectable for tests). */
export interface NwcSocket {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}

export type NwcSocketFactory = (url: string) => NwcSocket;

export interface NwcClientOptions {
  /** `nostr+walletconnect://` string, or an already parsed connection. */
  connection: string | NwcConnection;
  /** Transport override. Defaults to the platform WebSocket. */
  socketFactory?: NwcSocketFactory;
  /** Per-request timeout (ms). Default 30s. */
  timeoutMs?: number;
  /** How long to wait for the wallet's kind-13194 info at connect (ms). */
  infoTimeoutMs?: number;
}

export interface NwcWalletInfo {
  alias: string | null;
  methods: string[];
  encryptions: string[];
}

export class NwcError extends Error {
  readonly code: string | null;
  constructor(message: string, code?: string | null) {
    super(message);
    this.name = 'NwcError';
    this.code = code ?? null;
  }
}

const KIND_REQUEST = 23194;
const KIND_RESPONSE = 23195;
const KIND_INFO = 13194;

function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse and validate a `nostr+walletconnect://` connection string. */
export function parseNwcUrl(url: string): NwcConnection {
  const trimmed = (url || '').trim();
  if (!trimmed.startsWith('nostr+walletconnect://')) {
    throw new NwcError('Connection string must start with nostr+walletconnect://');
  }
  // Parsed locally: nostr-tools does not export a nip47 subpath in the
  // pinned version, and the format is a plain URL:
  //   nostr+walletconnect://<wallet-pubkey-hex>?relay=<wss>&secret=<hex>
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new NwcError('Invalid NWC connection string');
  }
  const walletPubkey = (parsedUrl.hostname || parsedUrl.pathname.replace(/^\/+/, '')).toLowerCase();
  const relays = parsedUrl.searchParams.getAll('relay').filter((r) => r.length > 0);
  const secret = (parsedUrl.searchParams.get('secret') ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new NwcError('NWC connection string has no valid wallet pubkey.');
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new NwcError('NWC connection string has no valid secret.');
  }
  if (relays.length === 0) {
    throw new NwcError('NWC connection string has no relay.');
  }
  return { walletPubkey, relays, secret };
}

interface PendingRequest {
  id: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: NwcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NwcClient {
  readonly connection: NwcConnection;
  readonly clientPubkey: string;

  private readonly socketFactory: NwcSocketFactory;
  private readonly timeoutMs: number;
  private readonly infoTimeoutMs: number;
  private readonly secretKey: Uint8Array;
  private readonly subId = `nwc-${randomHex(6)}`;
  private readonly infoSubId = `nwc-info-${randomHex(6)}`;

  private socket: NwcSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private encryption: 'nip44' | 'nip04' = 'nip44';
  private info: NwcWalletInfo | null = null;
  private infoWaiters: Array<() => void> = [];

  constructor(options: NwcClientOptions) {
    this.connection = typeof options.connection === 'string'
      ? parseNwcUrl(options.connection)
      : options.connection;
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as NwcSocket);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.infoTimeoutMs = options.infoTimeoutMs ?? 2_500;
    this.secretKey = hexToBytes(this.connection.secret);
    this.clientPubkey = getPublicKey(this.secretKey);
  }

  get isConnected(): boolean {
    return this.socket !== null;
  }

  /** Payload encryption currently in use for this connection. */
  get encryptionVersion(): 'nip44' | 'nip04' {
    return this.encryption;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    if (!this.connectPromise) {
      this.connectPromise = this.doConnect().finally(() => { this.connectPromise = null; });
    }
    return this.connectPromise;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new NwcError('NWC connection closed'));
    }
    this.pending.clear();
  }

  /** Wallet info from the kind-13194 event (or a get_info request when absent). */
  async getInfo(): Promise<NwcWalletInfo> {
    if (this.info) return this.info;
    await this.connect();
    const result = await this.request('get_info');
    const info: NwcWalletInfo = {
      alias: typeof result.alias === 'string' ? result.alias : null,
      methods: Array.isArray(result.methods) ? result.methods.filter((m): m is string => typeof m === 'string') : [],
      encryptions: Array.isArray(result.encryptions) ? result.encryptions.filter((m): m is string => typeof m === 'string') : [],
    };
    this.info = info;
    return info;
  }

  /** msats, or null when the wallet does not expose get_balance. */
  async getBalance(): Promise<number | null> {
    try {
      const result = await this.request('get_balance');
      const msats = Number(result.balance);
      return Number.isFinite(msats) ? msats : null;
    } catch (e) {
      if (e instanceof NwcError && isUnsupported(e)) return null;
      throw e;
    }
  }

  async payInvoice(invoice: string): Promise<{ preimage: string }> {
    const result = await this.request('pay_invoice', { invoice });
    const preimage = typeof result.preimage === 'string' ? result.preimage : '';
    return { preimage };
  }

  async lookupInvoice(params: { payment_hash?: string; invoice?: string }): Promise<Record<string, unknown>> {
    return this.request('lookup_invoice', params);
  }

  /** Send a raw NIP-47 method and resolve with its `result` object. */
  async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await this.connect();
    if (!this.info) await this.waitForInfo();
    const socket = this.socket;
    if (!socket) throw new NwcError('NWC not connected');

    const content = this.encryptPayload(JSON.stringify({ method, params }));
    const event = finalizeEvent(
      {
        kind: KIND_REQUEST,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.connection.walletPubkey]],
        content,
      },
      this.secretKey,
    );

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(event.id);
        reject(new NwcError(`NWC ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(event.id, { id: event.id, resolve, reject, timer });
    });
    socket.send(JSON.stringify(['EVENT', event]));
    return promise;
  }

  private async doConnect(): Promise<void> {
    let lastError: NwcError | null = null;
    for (const url of this.connection.relays) {
      try {
        const socket = await this.openSocket(url);
        socket.onmessage = (ev) => this.handleMessage(ev.data);
        socket.onclose = () => this.handleDisconnect(socket);
        socket.onerror = () => undefined;
        this.socket = socket;
        socket.send(JSON.stringify([
          'REQ',
          this.subId,
          { kinds: [KIND_RESPONSE], authors: [this.connection.walletPubkey], '#p': [this.clientPubkey] },
        ]));
        socket.send(JSON.stringify([
          'REQ',
          this.infoSubId,
          { kinds: [KIND_INFO], authors: [this.connection.walletPubkey], limit: 1 },
        ]));
        await this.waitForInfo();
        return;
      } catch (e) {
        lastError = e instanceof NwcError ? e : new NwcError('Could not reach the wallet relay');
      }
    }
    throw lastError ?? new NwcError('No usable relay in the NWC connection string');
  }

  private openSocket(url: string): Promise<NwcSocket> {
    return new Promise((resolve, reject) => {
      let socket: NwcSocket;
      try {
        socket = this.socketFactory(url);
      } catch {
        reject(new NwcError('Could not open the wallet relay connection'));
        return;
      }
      const timer = setTimeout(() => reject(new NwcError('Wallet relay connection timed out')), this.timeoutMs);
      socket.onopen = () => { clearTimeout(timer); resolve(socket); };
      socket.onerror = () => { clearTimeout(timer); reject(new NwcError('Wallet relay connection failed')); };
    });
  }

  private waitForInfo(): Promise<void> {
    if (this.info) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.infoWaiters = this.infoWaiters.filter((w) => w !== done);
        resolve();
      }, this.infoTimeoutMs);
      this.infoWaiters.push(done);
    });
  }

  private handleMessage(raw: unknown): void {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg[0] !== 'EVENT') return;
    const subId = msg[1];
    const event = msg[2] as NostrEvent | undefined;
    if (!event || typeof event !== 'object') return;

    if (subId === this.infoSubId) {
      if (event.kind !== KIND_INFO) return;
      const methods = typeof event.content === 'string' ? event.content.split(/\s+/).filter(Boolean) : [];
      const encTag = event.tags.find((t) => t[0] === 'encryption');
      const encryptions = encTag ? encTag.slice(1).filter(Boolean) : [];
      this.info = { alias: null, methods, encryptions };
      if (!encryptions.includes('nip44_v2') && encryptions.includes('nip04')) {
        this.encryption = 'nip04';
      }
      this.flushInfoWaiters();
      return;
    }

    if (subId !== this.subId) return;
    if (event.kind !== KIND_RESPONSE) return;

    let payload: { error?: { code?: string; message?: string } | null; result?: Record<string, unknown> | null };
    try {
      payload = this.decryptPayload(event.content);
    } catch {
      return;
    }
    const eTag = event.tags.find((t) => t[0] === 'e');
    const requestId = eTag?.[1];
    const pending = (requestId && this.pending.get(requestId))
      ?? (this.pending.size === 1 ? [...this.pending.values()][0] : undefined);
    if (!pending) return;
    this.pending.delete(pending.id);
    clearTimeout(pending.timer);
    if (payload.error) {
      pending.reject(new NwcError(payload.error.message || 'Wallet returned an error', payload.error.code));
    } else {
      pending.resolve(payload.result ?? {});
    }
  }

  private flushInfoWaiters(): void {
    const waiters = this.infoWaiters;
    this.infoWaiters = [];
    for (const w of waiters) w();
  }

  private handleDisconnect(socket: NwcSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new NwcError('Wallet relay connection closed'));
    }
    this.pending.clear();
  }

  private encryptPayload(plaintext: string): string {
    if (this.encryption === 'nip44') {
      return nip44EncryptRaw(plaintext, getConversationKey(this.secretKey, this.connection.walletPubkey));
    }
    return nip04Encrypt(this.secretKey, this.connection.walletPubkey, plaintext);
  }

  /** Decrypt with the negotiated scheme, self-healing to the other one. */
  private decryptPayload(payload: string): ReturnType<typeof JSON.parse> {
    const order: Array<'nip44' | 'nip04'> = this.encryption === 'nip44'
      ? ['nip44', 'nip04']
      : ['nip04', 'nip44'];
    let lastError: unknown = null;
    for (const enc of order) {
      try {
        const plain = enc === 'nip44'
          ? nip44DecryptRaw(payload, getConversationKey(this.secretKey, this.connection.walletPubkey))
          : nip04Decrypt(this.secretKey, this.connection.walletPubkey, payload);
        this.encryption = enc;
        return JSON.parse(plain);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('NWC payload could not be decrypted');
  }
}

function isUnsupported(err: NwcError): boolean {
  const code = (err.code ?? '').toLowerCase();
  if (code.includes('not_implemented') || code.includes('unsupported') || code.includes('method_not_found')) return true;
  return /not\s*implemented|unsupported|not\s*supported/i.test(err.message);
}

