import { NRelay1 } from "@nostrify/nostrify";
import type { NostrEvent, NostrFilter, NostrRelayCLOSED, NostrRelayEOSE, NostrRelayEVENT } from "@nostrify/nostrify";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import type { GroupKey } from "@/concord-v2/lib/derive";
import { isNostrId } from "@/lib/nostrId";
import { normalizeRelayUrl } from "@/lib/platform";

export interface ConcordRelayHandle {
  readonly communityId: string;
  readonly relayUrl: string;
  addKeys(keys: readonly GroupKey[]): void;
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
  req(filters: NostrFilter[], opts?: { signal?: AbortSignal }): AsyncIterable<NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED>;
  event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void>;
  onReopen(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface ConcordCapability {
  client(keys: readonly GroupKey[]): {
    _concordScope: string;
    _concordKeySig: string;
    relay(relayUrl: string): ConcordRelayHandle;
  };
}

type RelayLike = Pick<NRelay1, "query" | "req" | "event" | "close" | "socket">;
export type ConcordRelayFactory = (relayUrl: string, auth: (challenge: string) => Promise<NostrEvent>) => RelayLike;

// NRelay1 keeps sockets with active standing subscriptions open. One-shot
// invite/mirror/backfill sessions use its normal idle timeout so they do not
// leave a quiet correlation surface connected indefinitely.
const productionFactory: ConcordRelayFactory = (relayUrl, auth) => new NRelay1(relayUrl, { auth });
/** Matches the longest Concord publish budget; mobile/NIP-42 relays can take
 * several round trips before acknowledging every identity in a large scope. */
const SECONDARY_AUTH_TIMEOUT_MS = 15_000;

function keySignature(keys: readonly GroupKey[]): string {
  return [...new Set(keys.map((key) => key.pk))].sort().join(",");
}

function sessionKey(communityId: string, relayUrl: string, keys: readonly GroupKey[]): string {
  return `${communityId}|${relayUrl}|${keySignature(keys)}`;
}

class Session implements ConcordRelayHandle {
  readonly communityId: string;
  readonly relayUrl: string;
  private readonly keys = new Map<string, GroupKey>();
  private readonly acked = new Set<string>();
  private readonly pending = new Map<string, string>();
  private readonly authWaiters = new Map<string, (accepted: boolean) => void>();
  private readonly reopenListeners = new Set<() => void>();
  private readonly watchedSockets = new WeakSet<object>();
  private relay: RelayLike;
  private challenge?: string;
  private closed = false;

  constructor(communityId: string, relayUrl: string, keys: readonly GroupKey[], factory: ConcordRelayFactory) {
    this.communityId = communityId;
    this.relayUrl = relayUrl;
    this.addKeys(keys);
    this.relay = factory(relayUrl, async (challenge) => this.authenticate(challenge));
    this.watchSocketAssignments();
  }

  addKeys(keys: readonly GroupKey[]): void {
    if (this.closed) throw new Error("Concord relay session is closed.");
    const added: GroupKey[] = [];
    for (const key of keys) {
      if (!isNostrId(key.pk)) throw new Error("Concord stream pubkey must be 32-byte hex.");
      const existing = this.keys.get(key.pk);
      const sameSecret = existing?.sk.every((byte, index) => byte === key.sk[index]);
      const sameConversationKey = existing?.convKey.every((byte, index) => byte === key.convKey[index]);
      if (existing && (!sameSecret || !sameConversationKey)) {
        throw new Error("Conflicting Concord key material for the same stream pubkey.");
      }
      if (!existing) {
        const owned: GroupKey = { pk: key.pk, sk: key.sk.slice(), convKey: key.convKey.slice() };
        this.keys.set(key.pk, owned);
        added.push(owned);
      }
    }
    if (this.challenge && added.length) this.sendLateAuth(added);
  }

  private async authenticate(challenge: string): Promise<NostrEvent> {
    if (this.closed || !challenge.trim()) throw new Error("Concord AUTH challenge is unavailable.");
    this.challenge = challenge;
    this.acked.clear();
    this.pending.clear();
    this.settleAuthWaiters(false);
    const events = this.authEvents(this.keys.values(), challenge);
    if (!events.length) throw new Error("Concord session has no stream identity to authenticate.");
    // Send and settle every secondary identity before returning the final
    // AUTH to NRelay1. NRelay retries a rejected multi-author REQ as soon as
    // the returned AUTH is accepted and permits only one retry per socket;
    // without this barrier that retry can race ahead of secondary identities.
    const accepted = await Promise.all(events.slice(1).map((event) => this.sendRawAuth(event)));
    if (accepted.some((ok) => !ok)) {
      throw new Error("Concord secondary AUTH was rejected or timed out.");
    }
    if (this.closed || this.challenge !== challenge) {
      throw new Error("Concord AUTH challenge was superseded.");
    }
    this.pending.set(events[0].id, events[0].pubkey);
    return events[0];
  }

  private sendLateAuth(keys: readonly GroupKey[]): void {
    if (!this.challenge) return;
    for (const event of this.authEvents(keys, this.challenge)) void this.sendRawAuth(event);
  }

  private authEvents(keys: Iterable<GroupKey>, challenge: string): NostrEvent[] {
    const createdAt = Math.floor(Date.now() / 1000);
    return [...keys].map((key) => finalizeEvent({
      kind: 22242,
      content: "",
      tags: [["relay", this.relayUrl], ["challenge", challenge]],
      created_at: createdAt,
    }, key.sk));
  }

  private sendRawAuth(event: NostrEvent): Promise<boolean> {
    const settled = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.authWaiters.delete(event.id);
        resolve(false);
      }, SECONDARY_AUTH_TIMEOUT_MS);
      this.authWaiters.set(event.id, (accepted) => {
        clearTimeout(timer);
        resolve(accepted);
      });
    });
    try {
      this.pending.set(event.id, event.pubkey);
      this.relay.socket.send(JSON.stringify(["AUTH", event]));
    } catch {
      this.pending.delete(event.id);
      this.authWaiters.get(event.id)?.(false);
      this.authWaiters.delete(event.id);
      // A reconnect gets a fresh challenge and re-authenticates the full set.
    }
    return settled;
  }

  private watchSocketAssignments(): void {
    const relay = this.relay as RelayLike & { socket: RelayLike["socket"] };
    let socket = relay.socket;
    this.watchSocket(socket);
    try {
      Object.defineProperty(relay, "socket", {
        configurable: true,
        enumerable: true,
        get: () => socket,
        set: (next: RelayLike["socket"]) => {
          socket = next;
          this.watchSocket(next);
        },
      });
    } catch {
      // A custom relay may expose a non-configurable stable socket.
    }
  }

  private watchSocket(socket: RelayLike["socket"]): void {
    if (typeof socket !== "object" || socket === null || this.watchedSockets.has(socket)) return;
    this.watchedSockets.add(socket);
    const target = socket as unknown as { addEventListener(type: string, listener: (...args: unknown[]) => void): void };
    try {
      target.addEventListener("open", () => {
        const internals = this.relay as unknown as {
          authRetriedSubs?: Set<string>;
          authRetriedEvents?: Set<string>;
          authPromise?: Promise<void>;
          pendingEvents?: Map<string, NostrEvent>;
        };
        internals.authRetriedSubs?.clear();
        internals.authRetriedEvents?.clear();
        internals.authPromise = undefined;
        this.challenge = undefined;
        this.acked.clear();
        this.pending.clear();
        this.settleAuthWaiters(false);
        for (const event of internals.pendingEvents?.values() ?? []) {
          try {
            this.relay.socket.send(JSON.stringify(["EVENT", event]));
          } catch {
            // Another reconnect will retry the still-pending event.
          }
        }
        for (const listener of this.reopenListeners) listener();
      });
      target.addEventListener("message", (...args: unknown[]) => {
        const data = args.map((arg) => (arg as { data?: unknown } | undefined)?.data).find((value): value is string => typeof value === "string");
        if (!data?.startsWith('["OK"')) return;
        try {
          const [, id, ok] = JSON.parse(data) as [string, string, boolean];
          const pubkey = this.pending.get(id);
          if (!pubkey) return;
          this.pending.delete(id);
          if (ok) this.acked.add(pubkey);
          this.authWaiters.get(id)?.(ok);
          this.authWaiters.delete(id);
        } catch {
          // Ignore malformed/unrelated relay messages.
        }
      });
    } catch {
      // Custom/native relay implementations may not expose DOM listeners.
    }
  }

  private settleAuthWaiters(accepted: boolean): void {
    for (const settle of this.authWaiters.values()) settle(accepted);
    this.authWaiters.clear();
  }

  private assertFilters(filters: NostrFilter[]): void {
    for (const filter of filters) {
      const isConcordWrap = filter.kinds?.some((kind) => kind === 1059 || kind === 21059) ?? false;
      const hasForeignAuthor = filter.authors?.some((author) => !this.keys.has(author)) ?? false;
      if ((isConcordWrap && !filter.authors?.length) || hasForeignAuthor) {
        throw new Error(`Cross-scope Concord query blocked for ${this.communityId}.`);
      }
    }
  }

  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]> {
    if (this.closed) throw new Error("Concord relay session is closed.");
    this.assertFilters(filters);
    return this.relay.query(filters, opts);
  }

  req(filters: NostrFilter[], opts?: { signal?: AbortSignal }): AsyncIterable<NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED> {
    if (this.closed) throw new Error("Concord relay session is closed.");
    this.assertFilters(filters);
    return this.relay.req(filters, opts);
  }

  event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void> {
    if (this.closed) throw new Error("Concord relay session is closed.");
    if (!this.keys.has(event.pubkey)) throw new Error(`Cross-scope Concord publish blocked for ${this.communityId}.`);
    return this.relay.event(event, opts);
  }

  onReopen(listener: () => void): () => void {
    this.reopenListeners.add(listener);
    return () => this.reopenListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.challenge = undefined;
    for (const key of this.keys.values()) {
      key.sk.fill(0);
      key.convKey.fill(0);
    }
    this.keys.clear();
    this.acked.clear();
    this.pending.clear();
    this.settleAuthWaiters(false);
    this.reopenListeners.clear();
    await this.relay.close();
  }
}

export class ConcordTransport {
  private readonly sessions = new Map<string, Session>();
  private readonly communityGenerations = new Map<string, number>();
  private readonly capabilityGenerations = new Map<string, number>();
  private accountGeneration = 0;
  private accountPubkey?: string;

  constructor(private readonly factory: ConcordRelayFactory = productionFactory) {}

  relay(communityId: string, relayUrl: string, keys: readonly GroupKey[]): ConcordRelayHandle {
    if (!isNostrId(communityId)) throw new Error("Concord community id must be 32-byte hex.");
    const normalized = normalizeRelayUrl(relayUrl);
    if (!normalized) throw new Error("Concord relay URL is invalid.");
    const key = sessionKey(communityId, normalized, keys);
    let session = this.sessions.get(key);
    if (!session) {
      session = new Session(communityId, normalized, keys, this.factory);
      this.sessions.set(key, session);
    } else {
      session.addKeys(keys);
    }
    return session;
  }

  /** Capture a revocable community boundary before starting async work. */
  capability(communityId: string): ConcordCapability {
    const accountGeneration = this.accountGeneration;
    const communityGeneration = this.communityGenerations.get(communityId) ?? 0;
    return {
      client: (keys: readonly GroupKey[]) => {
        const signature = keySignature(keys);
        const capabilityId = `${communityId}|${signature}`;
        const capabilityGeneration = this.capabilityGenerations.get(capabilityId) ?? 0;
        return {
          _concordScope: communityId,
          _concordKeySig: signature,
          relay: (relayUrl: string) => {
            if (
              accountGeneration !== this.accountGeneration ||
              communityGeneration !== (this.communityGenerations.get(communityId) ?? 0) ||
              capabilityGeneration !== (this.capabilityGenerations.get(capabilityId) ?? 0)
            ) {
              throw new Error("Concord transport capability has been revoked.");
            }
            return this.relay(communityId, relayUrl, keys);
          },
        };
      },
    };
  }

  /** Create a generation-bound least-authority client. Once the account or
   * community is revoked, this capability can neither reuse nor recreate a
   * relay session with stale key material. */
  client(communityId: string, keys: readonly GroupKey[]) {
    return this.capability(communityId).client(keys);
  }

  closeCapability(communityId: string, keys: readonly GroupKey[]): void {
    const signature = keySignature(keys);
    const capabilityId = `${communityId}|${signature}`;
    this.capabilityGenerations.set(capabilityId, (this.capabilityGenerations.get(capabilityId) ?? 0) + 1);
    for (const [key, session] of this.sessions) {
      if (session.communityId !== communityId || !key.endsWith(`|${signature}`)) continue;
      this.sessions.delete(key);
      void session.close();
    }
  }

  resetAccount(pubkey?: string): void {
    if (this.accountPubkey === pubkey) return;
    this.accountPubkey = pubkey;
    this.accountGeneration++;
    this.communityGenerations.clear();
    this.capabilityGenerations.clear();
    const old = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of old) void session.close();
  }

  closeCommunity(communityId: string): void {
    this.communityGenerations.set(communityId, (this.communityGenerations.get(communityId) ?? 0) + 1);
    for (const [key, session] of this.sessions) {
      if (session.communityId !== communityId) continue;
      this.sessions.delete(key);
      void session.close();
    }
  }

  close(): void {
    const old = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of old) void session.close();
  }

  generation(): number { return this.accountGeneration; }
}

export const concordTransport = new ConcordTransport();

/** One-shot, user-identity-unlinked reader for public/pre-membership
 * coordinates. Every relay gets a fresh random NIP-42 identity and no
 * user/community key. Network metadata remains observable by the relay. */
export function ephemeralRelayClient() {
  const relays = new Map<string, { relay: NRelay1; sk: Uint8Array }>();
  let closed = false;
  return {
    relay(relayUrl: string) {
      if (closed) throw new Error("Ephemeral relay client is closed.");
      const normalized = normalizeRelayUrl(relayUrl);
      if (!normalized) throw new Error("Relay URL is invalid.");
      let entry = relays.get(normalized);
      if (!entry) {
        const sk = generateSecretKey();
        const relay = new NRelay1(normalized, {
          auth: async (challenge) => {
            if (closed || !challenge.trim()) throw new Error("Ephemeral AUTH challenge is unavailable.");
            return finalizeEvent({
              kind: 22242,
              content: "",
              tags: [["relay", normalized], ["challenge", challenge]],
              created_at: Math.floor(Date.now() / 1000),
            }, sk);
          },
        });
        entry = { relay, sk };
        relays.set(normalized, entry);
      }
      return entry.relay;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const { relay, sk } of relays.values()) {
        sk.fill(0);
        void relay.close();
      }
      relays.clear();
    },
  };
}

/** Adapter for transport-neutral fold/backfill helpers. It has no global query
 * or publish method, so callers cannot silently fall back to app relays. */
export function concordClient(communityId: string, keys: readonly GroupKey[]) {
  return concordTransport.client(communityId, keys);
}
