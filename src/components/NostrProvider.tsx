import React, { useEffect, useMemo, useRef } from 'react';
import { NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { verifyEvent } from 'nostr-tools';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin, type NLoginType } from '@nostrify/react/login';
import type { NostrSigner } from '@nostrify/types';
import { useAppContext } from '@/hooks/useAppContext';
import { getEffectiveRelays, APP_SEARCH_RELAYS, ZAPSTORE_RELAY } from '@/lib/appRelays';
import { AppPool } from '@/lib/AppPool';
import { NIndexedDB } from '@nostrify/indexeddb';
import { NostrStorageContext } from '@/contexts/NostrStorageContext';
import { EventStoreContext, type EventStoreContextType } from '@/contexts/EventStoreContext';
import { emitRelayReopened } from '@/lib/relayReopen';
import { normalizeRelayUrl } from '@/lib/platform';
import { logSync } from '@/lib/syncLog';
import {
  _resetStreamAuthRegistry,
  noteAuthResult,
  noteRelayChallenged,
  noteStreamAuthSent,
  onStreamAuthStale,
  onStreamKeysAdded,
  resetRelayAuth,
  signStreamAuths,
  signStreamAuthsChunked,
  streamPubkeysForRelay,
} from '@/concord-v2/lib/streamAuth';
import { warmRumorStore } from '@/concord-v2/lib/rumorStore';
import { warmInviteInbox } from '@/concord-v2/lib/inviteInbox';

/**
 * IndexedDB database name for the events cache.
 *
 * `@nostrify/indexeddb` installs its own schema at version 1, while the old
 * in-tree `NIndexedDB` used the `ditto-events` database at version 2. Opening
 * an existing database at a *lower* version throws, which the package catches
 * and degrades to a permanent no-op. To avoid that, the package-backed cache
 * lives under a fresh name; the old `ditto-events` database is a disposable
 * cache (everything re-fetches from relays) and is deleted on startup.
 */
const EVENTS_DB_NAME = 'nostr';

/**
 * Per-relay cooldown between signing NEW NIP-42 challenges. A burst of retried
 * REQs (each re-challenged) arrives within milliseconds, so a short window
 * collapses the flood onto one bunker sign while still letting a genuine
 * reconnect re-authenticate quickly. (Challenges are nonces, so we never reuse a
 * signature across challenges — we just refuse the extra ones during the window.)
 */
const AUTH_MIN_INTERVAL_MS = 5_000;

/**
 * Head start the user signer gets on a NIP-42 challenge before NRelay1's
 * awaited AUTH falls back to a locally-signed stream key. Local/extension
 * signers answer in well under this; only a genuinely slow NIP-46 bunker
 * round-trip exceeds it (and its AUTH is then delivered out-of-band).
 */
const USER_AUTH_HEADSTART_MS = 1_200;

/**
 * Extended window the user signer gets after losing the head-start race,
 * before NRelay1's awaited AUTH is answered with a stream key. NRelay1 grants
 * each sub exactly ONE auth-retry per socket and fires it the moment the auth
 * promise resolves — answering with a stream key while the user signer is
 * merely slow (a healthy but latent NIP-46 bunker) retries user-identity-gated
 * subs under the stream identity, the relay re-rejects them, and they die
 * until the next reconnect. Waiting out a slow-but-alive bunker keeps those
 * subs alive; the stream-key answer is reserved for a bunker that is truly
 * not answering (where user-gated subs could never authenticate anyway).
 */
const USER_AUTH_EXTENDED_MS = 15_000;

/**
 * NIP-59 gift-wrap kinds (Concord V2 wraps + ephemeral variant). See
 * `wire/ingest.ts` WRAP_KINDS.
 */
const WRAP_KINDS = new Set([1059, 21059]);

/**
 * Skip Schnorr signature verification for gift-wraps, verify everything else.
 *
 * A 1059/21059 wrap's outer signature is cryptographically meaningless to the
 * client: NIP-59 wraps are signed either by a single-use ephemeral key (direct
 * invites) or, in Concord V2, by a group-shared *derived* stream key that every
 * member can sign with. Neither establishes a sender identity. Authenticity and
 * integrity of the payload come from NIP-44 (authenticated encryption) plus the
 * inner seal's signature check (`stream.ts` `verifyEvent(seal)`) and the
 * `rumor.pubkey === seal.pubkey` + rumor-id-hash bindings — all re-checked in
 * the decrypt path regardless of the outer sig. Verifying the wrap here is pure
 * redundant work, and wraps are the highest-volume kind on the auth'd stream
 * relays, so skipping the Schnorr verify for just these kinds is a real ingest
 * win. Every other kind (NIP-29 group events, DMs, profiles, …) still relies on
 * its outer signature for identity, so those keep full verification.
 */
function verifyEventSkippingWraps(event: NostrEvent): boolean {
  if (WRAP_KINDS.has(event.kind)) return true;
  return verifyEvent(event);
}

/** Best-effort deletion of the abandoned legacy events cache database. */
function deleteLegacyEventsDB(): void {
  try {
    indexedDB?.deleteDatabase('ditto-events');
  } catch {
    // Ignore — the legacy database is disposable.
  }
}

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const { logins } = useNostrLogin();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Open the IndexedDB event store once. It's shared two ways: the AppPool
  // writes every relay result into it (cache-first reads elsewhere), and it's
  // provided through NostrStorageContext so hooks can read it directly. Opening
  // it here lets the AppPool and
  // the rest of the app share a single connection. The cache is append-only;
  // it is never automatically pruned.
  //
  // `null` is a sentinel meaning "we already tried and failed"; `undefined`
  // means "not attempted yet". This prevents a render-time retry loop if
  // IndexedDB is blocked or throws on open.
  const eventStore = useRef<NIndexedDB | null | undefined>(undefined);
  if (eventStore.current === undefined) {
    try {
      eventStore.current = new NIndexedDB(EVENTS_DB_NAME);
    } catch {
      // IndexedDB may be unavailable or blocked. Degrade gracefully to a
      // memory-only pool so the rest of the app can still render.
      eventStore.current = null;
    }
    // Warm the Concord V2 rumor cache's IndexedDB connection too, so the first
    // ₿AO channel open reads a hot store instead of paying the cold-open
    // penalty. Same for the V2 direct-invite inbox cache.
    warmRumorStore();
    warmInviteInbox();
  }

  // The ₿AO chat (Concord V2) event-store contract: the SAME NIndexedDB the
  // AppPool caches into, exposed as a Promise so async stores could slot in.
  // The wire's ingest writes plaintext events here; Concord hooks read through
  // it (see contexts/EventStoreContext.ts).
  const baoEventStore = useRef<EventStoreContextType | undefined>(undefined);
  if (baoEventStore.current === undefined) {
    baoEventStore.current = eventStore.current
      ? Promise.resolve(eventStore.current)
      : Promise.reject(new Error('IndexedDB event store unavailable'));
    // Avoid an unhandled-rejection warning on the sentinel: consumers await
      // it inside their own try/catch (or query functions).
    baoEventStore.current.catch(() => undefined);
  }

  // Use refs so the pool always has the latest data
  const effectiveRelays = useRef(getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays));

  // Stable ref to the current user's signer for NIP-42 AUTH.
  // The `open()` callback reads from this ref when a relay sends an AUTH
  // challenge, so it always uses the latest signer without recreating the pool.
  const signerRef = useRef<NostrSigner | undefined>(undefined);
  // Stable ref to the current login so the AUTH callback can validate that the
  // signing identity matches the logged-in pubkey. It is initialized to
  // undefined and populated in the sync effect below because currentLogin is
  // derived later in this component body.
  const loginRef = useRef<NLoginType | undefined>(undefined);

  // Per-relay cache of the most recent signed AUTH event, so a REQ retry that
  // re-triggers the same challenge — or a burst of fresh challenges from a
  // relay that keeps closing our subs — reuses the signature instead of queuing
  // another bunker round-trip.
  const authCacheRef = useRef<Map<string, { challenge: string; event: NostrEvent; signedAt: number }>>(new Map());
  // Per-relay in-flight AUTH sign, so a burst of concurrent challenges for the
  // same relay collapses onto one bunker round-trip instead of N (the cache
  // timestamp is only set AFTER signing, so without this the whole burst slips
  // past the rate-limit check before any of them completes).
  const authInFlightRef = useRef<Map<string, Promise<NostrEvent>>>(new Map());
  // Per-relay cooldown: timestamp until which we refuse to sign a NEW challenge
  // for this relay, so a relay that re-challenges on every retried REQ can't
  // flood the bunker. Set after each successful sign.
  const authCooldownRef = useRef<Map<string, number>>(new Map());

  // Per-relay NIP-42 challenge + auth bookkeeping. Concord V2 authenticates
  // as derived stream keys: a kind-1059 REQ passes an auth-gating relay
  // only once every `authors` entry is authenticated on the socket.
  const openRelaysRef = useRef<Map<string, { relay: NRelay1; challenge?: string }>>(new Map());

  /**
   * Send NIP-42 AUTH frames for the stream pubkeys scoped to this relay.
   * Signing is chunked with event-loop yields; aborts if the socket reopens
   * mid-flight (the challenge is then a dead nonce). Each frame is recorded
   * so the relay's `["OK", id, true]` ack marks the key authenticated
   * (streamAuth ack state — plane sweeps gate on it).
   */
  const sendStreamAuths = async (
    entry: { relay: NRelay1; challenge?: string },
    url: string,
    pubkeys?: string[],
  ) => {
    const challenge = entry.challenge;
    if (!challenge) return;
    for await (const chunk of signStreamAuthsChunked(challenge, url, pubkeys)) {
      if (entry.challenge !== challenge) return; // stale nonce — a fresh challenge will re-cover
      for (const ev of chunk) {
        try {
          entry.relay.socket.send(JSON.stringify(['AUTH', ev]));
          // Record as pending ONLY after the frame actually left the socket.
          // A half-open socket (readyState OPEN, TCP dead) throws or silently
          // drops here; marking it pending first would pin the key unacked
          // forever (its OK never comes), wedging streamAuthsSettled until a
          // socket reopen — which a half-open socket never fires. The next
          // auth-required round re-sends.
          noteStreamAuthSent(url, ev.id, ev.pubkey);
        } catch {
          // socket not open yet / closing — the next auth-required round re-sends.
        }
      }
    }
  };

  /**
   * Reset a relay's NIP-42 state on socket reopen: a reconnected socket is a
   * fresh unauthenticated session, but NRelay1 carries stale auth bookkeeping
   * across reconnects. Clearing everything on open makes a reconnect behave
   * like a first connection. Also watches incoming `OK` frames to ack the raw
   * stream AUTHs we send outside NRelay1's own flow.
   *
   * Additionally re-sends NRelay1's PENDING EVENTS on open: NRelay1 re-issues
   * its subscriptions when a socket reconnects but never retransmits an EVENT
   * that is still awaiting its OK. An EVENT written into a half-open socket
   * (backgrounded Android: readyState OPEN, TCP dead) is silently lost, and
   * its `event()` promise burns the full publish timeout — for a NIP-46 login
   * that black-holes the sign request itself, so "send" does nothing for 60s
   * and then fails. Retransmitting on open makes the reconnect lossless
   * (duplicate EVENTs are idempotent — relays dedup by id).
   */
  const watchSocketReopen = (relay: NRelay1, url: string) => {
    const internals = relay as unknown as {
      authRetriedSubs?: Set<string>;
      authRetriedEvents?: Set<string>;
      authPromise?: Promise<void>;
      pendingEvents?: Map<string, NostrEvent>;
      socket: NRelay1['socket'];
    };
    const onOpen = () => {
      internals.authRetriedSubs?.clear();
      internals.authRetriedEvents?.clear();
      internals.authPromise = undefined;
      authCacheRef.current.delete(url);
      authCooldownRef.current.delete(url);
      authInFlightRef.current.delete(url);
      resetRelayAuth(url); // the old session's AUTH acks died with the socket
      const entry = openRelaysRef.current.get(url);
      if (entry) entry.challenge = undefined; // the old socket's nonce is dead
      // Retransmit publishes still awaiting an OK (see docstring). NRelay1
      // removes an event from pendingEvents once its OK arrives, so anything
      // still here either never reached the relay or its OK was lost — both
      // healed by a re-send on the fresh socket.
      const pending = internals.pendingEvents;
      if (pending?.size) {
        logSync('auth', `socket reopened for ${url} — retransmitting ${pending.size} pending EVENT(s)`);
        for (const ev of pending.values()) {
          try {
            relay.socket.send(JSON.stringify(['EVENT', ev]));
          } catch {
            // Socket flapped again — the next reopen retransmits.
          }
        }
      }
      // Tell long-lived consumers (the wire's standing ingestion) that this is
      // a fresh socket session: their re-issued subscriptions may have raced
      // the NIP-42 handshake, so they should re-REQ rather than trust the old
      // round (see relayReopen.ts).
      emitRelayReopened(url);
    };
    // Ack our raw AUTH frames: the relay replies ["OK", <auth event id>, bool].
    // Cheap prefix check first so the wrap firehose isn't double-parsed.
    const onMessage = (...args: unknown[]) => {
      const data = args
        .map((a) => (a as { data?: unknown } | undefined)?.data)
        .find((d): d is string => typeof d === 'string');
      if (!data?.startsWith('["OK"')) return;
      try {
        const [, id, ok] = JSON.parse(data) as [string, string, boolean];
        if (typeof id === 'string') noteAuthResult(url, id, ok === true);
      } catch {
        // not JSON / not ours
      }
    };
    const attach = (socket: NRelay1['socket']) => {
      try {
        const s = socket as unknown as {
          addEventListener(type: string, listener: (...args: unknown[]) => void): void;
        };
        s.addEventListener('open', onOpen);
        s.addEventListener('message', onMessage);
      } catch {
        // No listener support — reconnects fall back to nostrify's behavior.
      }
    };
    // websocket-ts re-emits "open" on reconnect, but NRelay1.wake() REPLACES
    // relay.socket — intercept the assignment so the replacement is watched too.
    let currentSocket = relay.socket;
    attach(currentSocket);
    try {
      Object.defineProperty(relay, 'socket', {
        configurable: true,
        enumerable: true,
        get: () => currentSocket,
        set: (socket: NRelay1['socket']) => {
          currentSocket = socket;
          attach(socket);
        },
      });
    } catch {
      // Non-configurable in some exotic runtime — reconnects of the ORIGINAL
      // socket are still covered by the listener above.
    }
  };

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(() => {
    if (!currentLogin) return undefined;
    try {
      switch (currentLogin.type) {
        case 'nsec':
          return NUser.fromNsecLogin(currentLogin).signer;
        case 'bunker':
          // pool.current is guaranteed to exist here: the pool is created
          // synchronously during the first render (below), and useMemo runs
          // after the render body has executed.
          return NUser.fromBunkerLogin(currentLogin, pool.current!).signer;
        case 'extension':
          return NUser.fromExtensionLogin(currentLogin).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }, [currentLogin]);

  // Keep the refs in sync so the AUTH callback always sees the latest signer
  // and the current logged-in identity.
  useEffect(() => {
    signerRef.current = currentSigner;
    loginRef.current = currentLogin;
  }, [currentSigner, currentLogin]);

  // Reset the Concord V2 stream-auth registry on account switch / logout: the
  // previous account's derived stream keys (and per-relay ack state) must not
  // leak into the new session. The wire re-registers the new account's keys
  // via registerStreamKeys as its membership queries resolve.
  const prevPubkeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevPubkeyRef.current !== currentLogin?.pubkey) {
      prevPubkeyRef.current = currentLogin?.pubkey;
      _resetStreamAuthRegistry();
      // The signed user-AUTH cache is identity-bound: without this, a relay
      // re-issuing the identical challenge string after an account switch
      // would be answered with the PREVIOUS account's kind-22242 (the
      // cache-hit path skips the sign-time pubkey validation).
      authCacheRef.current.clear();
      authCooldownRef.current.clear();
      authInFlightRef.current.clear();
    }
  }, [currentLogin?.pubkey]);

  // Update effective relays ref when config changes. The NPool reads from
  // this ref, so new queries automatically use the updated relay set.
  //
  // We intentionally do NOT invalidate existing queries here. When relays
  // are added (e.g. NIP-65 sync merging user relays with app defaults),
  // existing cached data is still valid — we'll just query more relays on
  // the next natural refetch. Blanket invalidation caused a disruptive
  // full-feed rerender ~3s after page load when NostrSync synced relays.
  useEffect(() => {
    effectiveRelays.current = getEffectiveRelays(config.relayMetadata, config.useAppRelays, config.useUserRelays);
  }, [config.relayMetadata, config.useAppRelays, config.useUserRelays]);

  // Initialize NPool only once
  if (pool.current === undefined) {
    pool.current = new NPool({
      open(relayUrl: string) {
        const url = new URL(relayUrl);
        // Single key form for ALL graft state (auth maps, open-relay registry,
        // stream-auth lookups, the relayReopen signal): the normalized relay
        // URL. `url.href` keeps a trailing slash for root-path relays
        // (`wss://host/`) while the wire's spec and the stream-auth registry
        // key by `normalizeRelayUrl` output (`wss://host`) — keying by href
        // here made every cross-module lookup miss (the socket-reopen bump
        // never fired, the stale-auth self-heal never found its relay).
        const relayKey = normalizeRelayUrl(relayUrl) ?? url.href;
        const relay: NRelay1 = new NRelay1(url.href, {
          // Gift-wrap (1059/21059) outer signatures are redundant on the client
          // (see verifyEventSkippingWraps); skip them, verify everything else.
          verifyEvent: verifyEventSkippingWraps,
          // NIP-42: Respond to relay AUTH challenges. The user's signer answers
          // when it's fast (local nsec / extension, or a healthy bunker); a
          // slow NIP-46 bunker is kept off the critical path by falling back
          // to a locally-signed Concord V2 stream key (see the head-start race
          // below). Stream keys are authenticated on the same challenge, both
          // now and as they register late (onStreamKeysAdded).
          auth: async (challenge: string) => {
            if (!challenge || challenge.trim().length === 0) {
              throw new Error('AUTH failed: relay challenge is empty');
            }
            const expectedRelay = relayKey;

            // Remember the challenge so newly-registered Concord V2 stream keys
            // can be authenticated on this same connection later, and
            // authenticate the streams we already hold right now (the stream
            // signatures are local, so they don't wait on the user signer).
            const entry = openRelaysRef.current.get(expectedRelay) ?? { relay };
            entry.challenge = challenge;
            openRelaysRef.current.set(expectedRelay, entry);
            noteRelayChallenged(expectedRelay);
            const streamPks = streamPubkeysForRelay(expectedRelay);
            logSync(
              'auth',
              `NIP-42 challenge from ${expectedRelay} — signing user + ${streamPks.length} stream key(s)`,
            );
            void sendStreamAuths(entry, expectedRelay);

            /**
             * Sign the user's kind-22242 for this relay, guarded against a
             * slow/remote NIP-46 bunker: reuse a cached signature when the
             * relay re-issues the IDENTICAL challenge (challenges are
             * single-use nonces, so never across a fresh one); collapse a
             * concurrent burst onto one in-flight sign; and rate-limit per
             * relay — within the window, DELAY the sign until the window ends
             * rather than refusing it (NRelay1's doAuth swallows a rejection
             * and each sub/publish gets ONE auth-retry per socket, so a
             * dropped challenge could kill a gated sub until reconnect). A
             * delayed sign uses the relay's LATEST challenge at fire time.
             */
            const signUserAuth = (): Promise<NostrEvent> => {
              const signer = signerRef.current;
              if (!signer) {
                return Promise.reject(new Error('AUTH failed: no signer available (user not logged in)'));
              }
              const cached = authCacheRef.current.get(expectedRelay);
              // The cached event is identity-bound: an account switch clears
              // the cache (see the pubkey-change effect), but guard here too
              // so a stale entry can never authenticate a socket as the
              // previous account even if the clear is somehow bypassed.
              if (cached && cached.challenge === challenge && cached.event.pubkey === loginRef.current?.pubkey) {
                return Promise.resolve(cached.event);
              }
              const inFlight = authInFlightRef.current.get(expectedRelay);
              if (inFlight) return inFlight;
              const wait = (authCooldownRef.current.get(expectedRelay) ?? 0) - Date.now();
              const signing = (wait > 0
                ? new Promise<void>((resolve) => setTimeout(resolve, wait))
                : Promise.resolve()
              ).then(async () => {
                const current = openRelaysRef.current.get(expectedRelay)?.challenge ?? challenge;
                const liveSigner = signerRef.current;
                if (!liveSigner) {
                  throw new Error('AUTH failed: no signer available (user not logged in)');
                }
                const signed = await liveSigner.signEvent({
                  kind: 22242,
                  content: '',
                  tags: [
                    ['relay', expectedRelay],
                    ['challenge', current],
                  ],
                  created_at: Math.floor(Date.now() / 1000),
                });

                // Validate the signed event before trusting it (a compromised
                // or misconfigured signer must not silently authenticate us
                // to the wrong relay or as the wrong identity).
                const relayTag = signed.tags.find(([name]) => name === 'relay')?.[1];
                if (relayTag !== expectedRelay) {
                  throw new Error('AUTH failed: signed relay tag does not match connected relay');
                }
                const challengeTag = signed.tags.find(([name]) => name === 'challenge')?.[1];
                if (!challengeTag || challengeTag.trim().length === 0) {
                  throw new Error('AUTH failed: signed challenge tag is empty');
                }
                const expectedPubkey = loginRef.current?.pubkey;
                if (expectedPubkey && signed.pubkey !== expectedPubkey) {
                  throw new Error('AUTH failed: signed pubkey does not match logged-in identity');
                }

                authCacheRef.current.set(expectedRelay, { challenge: current, event: signed, signedAt: Date.now() });
                authCooldownRef.current.set(expectedRelay, Date.now() + AUTH_MIN_INTERVAL_MS);
                return signed;
              }).finally(() => {
                authInFlightRef.current.delete(expectedRelay);
              });
              authInFlightRef.current.set(expectedRelay, signing);
              return signing;
            };

            const userSign = signUserAuth();
            userSign.catch(() => undefined); // the stream path below may abandon it
            if (streamPks.length === 0) {
              // No stream keys scoped here: the USER identity is what's being
              // authenticated — nothing else can satisfy the gate, so the
              // signer round-trip is unavoidable.
              return userSign;
            }

            // Keep the bunker OFF the reconnect critical path: NRelay1 holds
            // every auth-retried sub/publish behind this promise, and for a
            // NIP-46 login the sign is a relay round-trip that may itself be
            // traveling over the socket that just reconnected. Give the user
            // sign a short head start; if it hasn't answered, keep waiting out
            // the extended window before falling back to a locally-signed
            // STREAM-key 22242 — NRelay1 grants each sub ONE auth-retry per
            // socket and fires it the moment this promise resolves, so an
            // early stream-key answer retries user-identity-gated subs under
            // the stream identity and the relay deletes them (see
            // USER_AUTH_EXTENDED_MS). The user's AUTH is still delivered
            // out-of-band whenever the bunker responds (the relay accepts AUTH
            // frames for the socket's whole lifetime and its authed set only
            // grows).
            const fast = await Promise.race([
              userSign.then((ev) => ev, () => undefined),
              new Promise<undefined>((r) => setTimeout(() => r(undefined), USER_AUTH_HEADSTART_MS)),
            ]);
            if (fast) return fast;
            const extended = await Promise.race([
              userSign.then((ev) => ev, () => undefined),
              new Promise<undefined>((r) => setTimeout(() => r(undefined), USER_AUTH_EXTENDED_MS)),
            ]);
            if (extended) return extended;
            void userSign.then((ev) => {
              // Identity guard: the sign may resolve after an account switch
              // or into the logged-out gap — delivering it would authenticate
              // this socket as the PREVIOUS account for the socket's lifetime
              // (the relay's authed set only grows, and no fresh challenge is
              // issued for the new account to correct it).
              if (!loginRef.current?.pubkey || ev.pubkey !== loginRef.current.pubkey) return;
              const live = openRelaysRef.current.get(expectedRelay);
              try {
                live?.relay.socket.send(JSON.stringify(['AUTH', ev]));
              } catch {
                // Socket flapped — the next challenge re-signs.
              }
            }).catch(() => undefined);
            logSync('auth', `user sign is slow for ${expectedRelay} — answering the challenge with a stream key, user AUTH to follow`);
            const [streamEv] = signStreamAuths(challenge, expectedRelay, [streamPks[0]]);
            return streamEv;
          },
        });
        const existing = openRelaysRef.current.get(relayKey);
        openRelaysRef.current.set(relayKey, { relay, challenge: existing?.challenge });
        watchSocketReopen(relay, relayKey);
        return relay;
      },
      reqRouter(filters: NostrFilter[]): Map<URL['href'], NostrFilter[]> {
        const routes = new Map<string, NostrFilter[]>();

        // Search queries must go to search relays
        if (filters.some((f) => "search" in f)) {
          return new Map(APP_SEARCH_RELAYS.map(url => [url, filters]));
        }

        // Route to all read relays
        const readRelays = effectiveRelays.current.relays
          .filter(r => r.read)
          .map(r => r.url);

        // Include zapstore relay for kind 32267 (apps), 30063 (releases), and 3063 (assets)
        const ZAPSTORE_KINDS = [32267, 30063, 3063];
        if (filters.every((f) => f?.kinds?.every((k) => ZAPSTORE_KINDS.includes(k)))) {
          return new Map([ZAPSTORE_RELAY, ...readRelays].map(url => [url, filters]));
        }

        for (const url of readRelays) {
          routes.set(url, filters);
        }

        return routes;
      },
      eventRouter(_event: NostrEvent) {
        // Get write relays from effective relays
        const writeRelays = effectiveRelays.current.relays
          .filter(r => r.write)
          .map(r => r.url);

        const allRelays = new Set<string>(writeRelays);

        return [...allRelays];
      },
      // Resolve queries quickly once any relay sends EOSE, instead of
      // waiting for every relay to finish.
      eoseTimeout: 300,
    });
  }

  // Wrap the pool in our app-specific AppPool. It has the same interface as
  // NPool but layers on local caching and transparent request batching:
  // `.query()` calls are intercepted to automatically combine batchable filter
  // patterns (profiles, events by ID, reactions, d-tag lookups) into single
  // REQs, and results are mirrored into the local cache. All other methods pass
  // through directly to the underlying pool.
  const appPool = useRef<AppPool | undefined>(undefined);
  if (appPool.current === undefined && pool.current !== undefined) {
    appPool.current = new AppPool(pool.current, eventStore.current || undefined);
  }

  // Keep the AppPool's notion of "who is logged in" current. It uses this to
  // decide which events are worth caching: everything from a logged-in account,
  // plus replaceable events from people those accounts follow.
  useEffect(() => {
    appPool.current?.setLoggedInPubkeys(logins.map((l) => l.pubkey));
  }, [logins]);

  // Cleanup: Close all relay connections when the provider unmounts
  useEffect(() => {
    return () => {
      if (pool.current) {
        pool.current.close();
      }
    };
  }, []);

  // Drop the abandoned legacy events cache database (replaced by the
  // package-backed store under a new name). Best-effort, runs once.
  useEffect(() => {
    deleteLegacyEventsDB();
  }, []);

  // When Concord V2 registers new stream keys, authenticate them on
  // already-open sockets right away. The relay's challenge stays valid for
  // the socket's lifetime and its authenticated-pubkey set only grows, so a
  // late key just signs the stored challenge and sends another AUTH frame —
  // the relay acks it and subsequent REQs for that author pass.
  useEffect(() => {
    return onStreamKeysAdded((added) => {
      for (const [url, entry] of openRelaysRef.current) {
        if (!entry.challenge) continue;
        const scoped = new Set(streamPubkeysForRelay(url));
        const pks = added.filter((pk) => scoped.has(pk));
        if (pks.length === 0) continue;
        logSync('auth', `authenticating ${pks.length} late stream key(s) on ${url}`);
        void sendStreamAuths(entry, url, pks);
      }
    });
    // Reads only refs; stable for the provider's lifetime.
  }, []);

  // Self-heal a wedged NIP-42 auth: streamAuthsSettled fires this when a relay
  // was challenged but some stream key stayed unacked past the stale window (a
  // dropped AUTH frame, a lost OK, an ack that raced the listener attach). The
  // old code could only recover via a socket reopen — which a half-open socket
  // never fires — so sync stayed dead until an app restart. Re-sign and re-send
  // the relay's stream AUTHs on the LIVE socket; the relay's challenge is valid
  // for the socket's lifetime, so a fresh AUTH frame still authenticates.
  useEffect(() => {
    return onStreamAuthStale((url) => {
      const entry = openRelaysRef.current.get(url);
      if (!entry?.challenge) return;
      logSync('auth', `stream auth went stale for ${url} — re-sending AUTH frames`);
      void sendStreamAuths(entry, url);
    });
    // Reads only refs; stable for the provider's lifetime.
  }, []);

  // Provide the AppPool as the `nostr` object. It has the same interface
  // as NPool, so hooks using `useNostr()` get transparent caching and batching.
  // The `as unknown as NPool` cast is safe because AppPool exposes
  // all the same methods hooks use: query, event, req, relay, group, close.
  return (
    <NostrContext.Provider value={{ nostr: (appPool.current ?? pool.current) as unknown as NPool }}>
      <NostrStorageContext.Provider value={eventStore.current ?? null}>
        <EventStoreContext.Provider value={baoEventStore.current}>
          {children}
        </EventStoreContext.Provider>
      </NostrStorageContext.Provider>
    </NostrContext.Provider>
  );
};

export default NostrProvider;
