import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { _resetStreamAuthRegistry } from '@/concord-v2/lib/streamAuth';
import { warmRumorStore } from '@/concord-v2/lib/rumorStore';
import { warmInviteInbox } from '@/concord-v2/lib/inviteInbox';
import { concordTransport } from '@/concord-v2/lib/concordTransport';

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
  const authChallengeRef = useRef<Map<string, string>>(new Map());

  /**
   * Reset a relay's NIP-42 state on socket reopen: a reconnected socket is a
   * fresh unauthenticated session, but NRelay1 carries stale auth bookkeeping
   * across reconnects. Clearing everything on open makes a reconnect behave
   * like a first connection.
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
      authChallengeRef.current.delete(url);
      for (const key of authInFlightRef.current.keys()) {
        if (key.startsWith(`${url}\n`)) authInFlightRef.current.delete(key);
      }
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
    const attach = (socket: NRelay1['socket']) => {
      try {
        const s = socket as unknown as {
          addEventListener(type: string, listener: (...args: unknown[]) => void): void;
        };
        s.addEventListener('open', onOpen);
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
  // Descendants that acquire Concord capabilities stay unmounted across an
  // account boundary until the parent has revoked the old transport sessions.
  // `null` is the initial not-yet-reset sentinel; `undefined` means logged out.
  const [transportAccount, setTransportAccount] = useState<string | undefined | null>(null);
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

  // Reset both isolated Concord sessions and the dormant legacy stream-auth
  // registry on account switch / logout. No derived key is authenticated on
  // this ordinary application pool.
  const prevPubkeyRef = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (prevPubkeyRef.current !== currentLogin?.pubkey) {
      prevPubkeyRef.current = currentLogin?.pubkey;
      // NIP-42 authorization belongs to a WebSocket, not merely our local
      // caches. Reusing that socket after logout/account switch lets a relay
      // permanently correlate both identities (and their stream keys).
      // Closing forces the next operation onto a fresh authorization set.
      pool.current?.close();
      concordTransport.resetAccount(currentLogin?.pubkey);
      _resetStreamAuthRegistry();
      // The signed user-AUTH cache is identity-bound: without this, a relay
      // re-issuing the identical challenge string after an account switch
      // would be answered with the PREVIOUS account's kind-22242 (the
      // cache-hit path skips the sign-time pubkey validation).
      authCacheRef.current.clear();
      authCooldownRef.current.clear();
      authInFlightRef.current.clear();
      authChallengeRef.current.clear();
      setTransportAccount(currentLogin?.pubkey);
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
        // Normalize once for user-AUTH caches and the relayReopen signal.
        const relayKey = normalizeRelayUrl(relayUrl) ?? url.href;
        const relay: NRelay1 = new NRelay1(url.href, {
          // Gift-wrap (1059/21059) outer signatures are redundant on the client
          // (see verifyEventSkippingWraps); skip them, verify everything else.
          verifyEvent: verifyEventSkippingWraps,
          // NIP-42 for the ordinary app pool is USER-IDENTITY ONLY. Concord
          // derived stream keys authenticate exclusively on the isolated
          // per-community transport; signing one here would let a relay link
          // the user's npub to every sealed community sharing this socket.
          auth: async (challenge: string) => {
            if (!challenge || challenge.trim().length === 0) {
              throw new Error('AUTH failed: relay challenge is empty');
            }
            const expectedRelay = relayKey;
            const challengedSocket = relay.socket;
            authChallengeRef.current.set(expectedRelay, challenge);

            logSync('auth', `NIP-42 challenge from ${expectedRelay} — signing active user`);

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
              if (
                cached &&
                cached.challenge === challenge &&
                cached.event.pubkey === loginRef.current?.pubkey &&
                authChallengeRef.current.get(expectedRelay) === challenge &&
                relay.socket === challengedSocket
              ) {
                return Promise.resolve(cached.event);
              }
              // Challenges are nonces. Collapse only callers asking for the
              // SAME challenge; sharing an in-flight event across distinct
              // challenges would return a correctly-signed but invalid AUTH.
              const inFlightKey = `${expectedRelay}\n${challenge}`;
              const inFlight = authInFlightRef.current.get(inFlightKey);
              if (inFlight) return inFlight;
              const wait = (authCooldownRef.current.get(expectedRelay) ?? 0) - Date.now();
              const signing: Promise<NostrEvent> = (wait > 0
                ? new Promise<void>((resolve) => setTimeout(resolve, wait))
                : Promise.resolve()
              ).then(async () => {
                const liveSigner = signerRef.current;
                if (!liveSigner) {
                  throw new Error('AUTH failed: no signer available (user not logged in)');
                }
                const signed = await liveSigner.signEvent({
                  kind: 22242,
                  content: '',
                  tags: [
                    ['relay', expectedRelay],
                    ['challenge', challenge],
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
                if (challengeTag !== challenge) {
                  throw new Error('AUTH failed: signed challenge tag does not match relay challenge');
                }
                const expectedPubkey = loginRef.current?.pubkey;
                if (!expectedPubkey || signed.pubkey !== expectedPubkey) {
                  throw new Error('AUTH failed: signed pubkey does not match logged-in identity');
                }
                if (
                  authChallengeRef.current.get(expectedRelay) !== challenge ||
                  relay.socket !== challengedSocket
                ) {
                  throw new Error('AUTH failed: relay challenge was superseded');
                }

                authCacheRef.current.set(expectedRelay, { challenge, event: signed, signedAt: Date.now() });
                authCooldownRef.current.set(expectedRelay, Date.now() + AUTH_MIN_INTERVAL_MS);
                return signed;
              }).finally(() => {
                if (authInFlightRef.current.get(inFlightKey) === signing) {
                  authInFlightRef.current.delete(inFlightKey);
                }
              });
              authInFlightRef.current.set(inFlightKey, signing);
              return signing;
            };
            return signUserAuth();
          },
        });
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

  // Provide the AppPool as the `nostr` object. It has the same interface
  // as NPool, so hooks using `useNostr()` get transparent caching and batching.
  // The `as unknown as NPool` cast is safe because AppPool exposes
  // all the same methods hooks use: query, event, req, relay, group, close.
  return (
    <NostrContext.Provider value={{ nostr: (appPool.current ?? pool.current) as unknown as NPool }}>
      <NostrStorageContext.Provider value={eventStore.current ?? null}>
        <EventStoreContext.Provider value={baoEventStore.current}>
          {transportAccount !== null && transportAccount === currentLogin?.pubkey ? children : null}
        </EventStoreContext.Provider>
      </NostrStorageContext.Provider>
    </NostrContext.Provider>
  );
};

export default NostrProvider;
