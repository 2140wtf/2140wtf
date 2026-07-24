import { App as CapacitorApp } from "@capacitor/app";
import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { useCommunityList2 } from "@/concord-v2/hooks/useCommunityList2";
import { controlFoldKey } from "@/concord-v2/hooks/useControlPlane2";
import { openChatBatch } from "@/concord-v2/lib/chat";
import { channelsView } from "@/concord-v2/lib/community";
import { liveEntries, rehydrateCommunity } from "@/concord-v2/lib/communityList";
import { controlGroups } from "@/concord-v2/lib/control";
import { openPlaneWrapsChunked } from "@/concord-v2/lib/planeSync";
import { ackPendingWraps, peekPendingWraps, writeOpened, writeRumors } from "@/concord-v2/lib/rumorStore";
import { registerStreamKeys, streamAuthGeneration } from "@/concord-v2/lib/streamAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEventStore } from "@/hooks/useEventStore";
import { readFolded } from "@/lib/foldedCache";
import { BaoNotification, isNativeRuntime } from "@/lib/nativeNotifications";
import { onRelayReopened } from "@/lib/relayReopen";
import { logSync } from "@/lib/syncLog";
import { emitWireScopes } from "@/wire/bus";
import { ingestWireEvents } from "@/wire/ingest";
import { buildWireSpec, stampRoundSince, type WireSpec } from "@/wire/spec";

import type { FoldedControl } from "@/concord-v2/lib/control";
import type { GroupKey } from "@/concord-v2/lib/derive";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "@nostrify/nostrify";

/**
 * Floor for a relay's `since` when we have no cursor yet (fresh device): a
 * short overlap window; deeper history arrives via hydration pulls.
 */
const FRESH_LOOKBACK_SECONDS = 5 * 60;
/**
 * Ceiling for how far back a persisted cursor may reach: a device off for a
 * month resumes at a week, not the epoch. Older history backfills on demand.
 */
const MAX_CURSOR_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Overlap subtracted from a resumed cursor (clock skew / borderline events). */
const CURSOR_OVERLAP_SECONDS = 60;
/**
 * Watchdog on a fresh REQ round: a healthy relay answers with SOMETHING
 * almost immediately (events, or at least EOSE — even an auth-gated relay
 * settles its NIP-42 handshake well inside this). A round that has yielded
 * NOTHING by the deadline is presumed swallowed (a REQ held behind a wedged
 * AUTH exchange, a half-open socket) and is aborted so the loop re-issues it
 * — without this, the `for await` blocks forever and the wire silently dies
 * until an app relaunch (the "I log in and nothing is here" wedge).
 */
const SILENT_REQ_TIMEOUT_MS = 30_000;
/**
 * Rotation ceiling on a QUIET established round: once a round has yielded
 * something, a long silence is usually just a quiet channel — but it is
 * indistinguishable from a subscription that silently died (a relay that
 * dropped its sub state without CLOSED, a re-issued REQ swallowed by the
 * NIP-42 race on a reconnected socket — see relayReopen.ts for the eager
 * path). So a round silent this long is torn down and re-REQ'd from the
 * cursor. Rotation is lossless (the cursor + overlap replays the boundary)
 * and cheap (one REQ frame; an empty replay on a truly quiet relay), and it
 * bounds "live went deaf" to this window instead of "until app relaunch".
 */
const QUIET_ROTATE_MS = 90_000;
/** How often a round's silence is re-checked against the deadlines above. */
const WATCHDOG_TICK_MS = 5_000;
/**
 * Max events buffered from a round's stored replay (pre-EOSE) before they're
 * flushed through ingest as ONE batch. Awaiting `ingestWireEvents` per event
 * defeats the store's burst batching (see the ingest.ts write-path comment):
 * an N-event catch-up replay becomes N idle-scheduled single-event
 * transactions plus N bus emissions — the post-resume main-thread chug.
 * Batching restores the single-transaction burst write and one bus ring per
 * batch; the cap bounds memory and keeps the cursor advancing. Post-EOSE
 * (live) events still ingest immediately for notification latency.
 */
const REPLAY_BATCH_MAX = 200;

function cursorKey(owner: string, relay: string): string {
  // Keyed per account: a relay-only cursor shared across accounts lets
  // account B resume from where account A got to and permanently skip every
  // message in between.
  return `2140:wire-cursor:${owner}:${relay}`;
}

function readCursor(owner: string, relay: string): number | undefined {
  try {
    const raw = localStorage.getItem(cursorKey(owner, relay));
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(owner: string, relay: string, createdAt: number): void {
  try {
    // Clamp against the local clock: an event stamped in the future (a
    // member's skewed clock, a hostile timestamp) must not drag the cursor
    // past `now` — every later REQ would open with `since > now` and the wire
    // would go deaf on this relay (persistently — the cursor is durable)
    // while everyone else's correctly-stamped messages stop matching. The
    // stored value is clamped on READ too, so a legacy poisoned cursor
    // self-heals instead of wedging forever.
    const now = Math.floor(Date.now() / 1000);
    const next = Math.min(createdAt, now);
    const prev = Math.min(readCursor(owner, relay) ?? 0, now);
    if (next > prev) localStorage.setItem(cursorKey(owner, relay), String(next));
  } catch {
    // localStorage unavailable — resume from the fresh lookback next launch.
  }
}

/**
 * Concord V2 channels for EVERY live community in the membership list, with
 * their stream GroupKeys (rehydrated bundle + persisted control-fold snapshot,
 * local reads only). Registers every stream key for NIP-42 stream auth so the
 * wire's kind-1059 REQs pass auth-gating relays. Keeps the full ChannelV2
 * (the wire decrypts; the native service can't).
 */
function useWireConcord2Channels(): Array<{ relays: string[]; channel: ChannelV2; communityIdHex: string }> {
  const { data } = useCommunityList2();
  const entries = useMemo(() => (data ? liveEntries(data.list) : []), [data]);
  const listSig = useMemo(
    () =>
      entries
        .map((e) => `${e.community_id}:${e.current.root_epoch}:${(e.current.channels ?? []).length}`)
        .sort()
        .join(","),
    [entries],
  );

  const query = useQuery<Array<{ relays: string[]; channel: ChannelV2; communityIdHex: string }>>({
    queryKey: ["wire", "concord2-channels", listSig],
    enabled: entries.length > 0,
    staleTime: 30_000,
    // Fold snapshots update out-of-band (community open / control sync) —
    // re-read periodically to pick up new channels and rotated epochs. This is
    // a local (IndexedDB) read, but there's no reason to run it while hidden.
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      // Account-switch guard: the registry is reset synchronously on switch,
      // but this queryFn's IndexedDB reads may resolve AFTER that reset —
      // registering then would re-admit the previous account's stream keys
      // into the new session. Bail if the generation moved under us.
      const generation = streamAuthGeneration();
      const out: Array<{ relays: string[]; channel: ChannelV2; communityIdHex: string }> = [];
      for (const entry of entries) {
        const community = rehydrateCommunity(entry);
        if (!community || community.relays.length === 0) continue;
        const keys: GroupKey[] = [];
        const folded = await readFolded<FoldedControl>(controlFoldKey(community.idHex));
        for (const channel of channelsView(community, folded)) {
          if (channel.streams.length === 0) continue;
          out.push({ relays: community.relays, channel, communityIdHex: community.idHex });
          keys.push(...channel.streams.map((s) => s.group));
        }
        if (streamAuthGeneration() !== generation) return out;
        // Scoped per community, so a relay's NIP-42 challenge only signs the
        // stream keys it actually hosts (see streamAuth.ts).
        registerStreamKeys(keys, community.relays);
      }
      return out;
    },
  });

  return query.data ?? [];
}

/**
 * The Concord V2 CONTROL-plane subscription targets for EVERY live community:
 * per community, its control-stream GroupKeys (across held epochs) and relays.
 * Unlike the channel list, this needs NO fold — control keys derive straight
 * from the rehydrated bundle's held roots — so it's a cheap, stable memo that
 * updates only when membership/epochs change.
 *
 * A standing subscription to these authors is what makes a newly-published
 * channel edition land LIVE for a non-open community, so a member added to a
 * new channel sees it appear in the sidebar without waiting for the slow
 * background control-plane sweep (or for the first message to be posted).
 * Every control stream key is registered for NIP-42 so the wire's kind-1059
 * control REQs pass auth-gating relays.
 */
function useWireConcord2Control(): Array<{ relays: string[]; idHex: string; groups: GroupKey[] }> {
  const { data } = useCommunityList2();
  const entries = useMemo(() => (data ? liveEntries(data.list) : []), [data]);

  return useMemo(() => {
    const out: Array<{ relays: string[]; idHex: string; groups: GroupKey[] }> = [];
    for (const entry of entries) {
      const community = rehydrateCommunity(entry);
      if (!community || community.relays.length === 0) continue;
      const groups = controlGroups(community);
      if (groups.length === 0) continue;
      out.push({ relays: community.relays, idHex: community.idHex, groups });
      // Scoped per community: a relay's NIP-42 challenge only signs the control
      // stream keys it actually hosts (see streamAuth.ts).
      registerStreamKeys(groups, community.relays);
    }
    return out;
  }, [entries]);
}

/**
 * THE funnel. One component owns all standing ingestion:
 *
 *   - builds the wire spec (minimal relays + filters — the same information
 *     the APK's persistent notification service is configured with);
 *   - web: holds ONE subscription per relay through the relay pool (which
 *     handles NIP-42 AUTH — user key + Concord V2 stream keys), resuming from
 *     a persisted per-relay cursor so time offline is replayed;
 *   - APK: bridges the native service's buffered/live events into the same
 *     ingest path;
 *   - drains V2 wraps the native service parked while the WebView was down.
 *
 * Everything lands in IndexedDB (the shared event store / the V2 rumor store)
 * and the wire bus announces which conversations changed. Hooks hydrate from
 * the stores; none of them hold their own sockets.
 *
 * PRUNED SCOPE (phase 1): Armada's WireSync also fed NIP-29 groups, kind-4 /
 * NIP-17 DMs, Concord V1, and Buzz kinds into the spec. This client owns
 * those planes elsewhere (DmInboxContext, NIP-104 group chat), so the wire
 * here carries ONLY the Concord V2 planes.
 */
export function WireSync() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const eventStore = useEventStore();
  const concord2 = useWireConcord2Channels();
  const concord2Control = useWireConcord2Control();

  const spec: WireSpec = useMemo(
    () =>
      buildWireSpec({
        concord2,
        concord2Control,
      }),
    [concord2, concord2Control],
  );

  // The ingest path reads the spec lazily so long-lived subscriptions always
  // decrypt/scope with the latest keys without resubscribing.
  const specRef = useRef(spec);
  specRef.current = spec;
  const sinksRef = useRef({
    eventStore,
    getSpec: () => specRef.current,
    getSelfPubkey: () => user?.pubkey,
  });
  sinksRef.current = {
    eventStore,
    getSpec: () => specRef.current,
    getSelfPubkey: () => user?.pubkey,
  };

  // ── Web sockets: one REQ per relay, resumed from the persisted cursor ─────
  useEffect(() => {
    if (!user || spec.subs.length === 0) return;
    const controller = new AbortController();
    // Cursor namespace for this account (see cursorKey).
    const owner = user.pubkey;

    // Per-relay "restart your round now" hooks: aborts the in-flight round and
    // skips any backoff sleep, so the loop re-REQs immediately. Driven by the
    // socket-reopen signal below.
    const bumps = new Map<string, () => void>();
    const offReopen = onRelayReopened((url) => bumps.get(url)?.());

    // A backgrounded browser tab has its timers throttled and its sockets
    // idled by the engine, so the watchdog's re-REQ (30s/90s) stretches to
    // minutes and a silently-dead subscription isn't noticed until long after
    // the user returns. Kick every relay's round the instant the tab becomes
    // visible again: an immediate re-REQ from the cursor is lossless and
    // drains anything the throttled round missed, so refocus is prompt instead
    // of waiting out a throttled watchdog tick.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const bump of bumps.values()) bump();
    };
    document.addEventListener("visibilitychange", onVisible);

    for (const { relay, filters } of spec.subs) {
      void (async () => {
        // Resubscribe with backoff for the effect's lifetime. NRelay1 keeps
        // the SOCKET alive across drops, but a relay-initiated CLOSED (an
        // auth-gating relay rejecting the REQ before AUTH lands, a policy
        // refusal) terminates the req generator and nothing brings the
        // subscription back until a spec change or app relaunch — on desktop,
        // where there is no native-service funnel, that means no live wire
        // until restart. Each fresh REQ gets a new sub id and with it a fresh
        // auth-retry from the pool, so the wire heals as soon as AUTH lands.
        let backoff = 1_000;
        // Signal-aware, bump-aware sleep: effect cleanup or a socket reopen
        // resolves it early so the retry never lags behind a live socket.
        let wakeSleep: (() => void) | undefined;
        const sleep = (ms: number) =>
          new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(t);
              controller.signal.removeEventListener("abort", finish);
              wakeSleep = undefined;
              resolve();
            };
            const t = setTimeout(finish, ms);
            wakeSleep = finish;
            controller.signal.addEventListener("abort", finish);
          });
        // Routine rotations are silent in the log; only the first round and
        // anomalies (swallowed REQ, reopen restart, early CLOSED) speak.
        let firstRound = true;
        while (!controller.signal.aborted) {
          const started = Date.now();
          // Recompute the resume point each round: the cursor advanced with
          // everything the previous round ingested.
          const now = Math.floor(Date.now() / 1000);
          const cursor = readCursor(owner, relay);
          const floor = now - MAX_CURSOR_AGE_SECONDS;
          const since = Math.max(
            cursor !== undefined ? cursor - CURSOR_OVERLAP_SECONDS : now - FRESH_LOOKBACK_SECONDS,
            cursor !== undefined ? floor : 0,
          );
          // Abortable round, watched for liveness on a recurring tick:
          //   - a round that never yields ANYTHING (no EVENT, no EOSE) inside
          //     SILENT_REQ_TIMEOUT_MS was swallowed — abort and re-REQ;
          //   - an established round silent past QUIET_ROTATE_MS is rotated —
          //     a quiet channel and a silently-dead subscription look
          //     identical from here, and re-REQing from the cursor is
          //     lossless, so never trust one subscription for long;
          //   - a socket reopen bumps the round immediately (see relayReopen).
          const round = new AbortController();
          const roundSignal = AbortSignal.any([controller.signal, round.signal]);
          bumps.set(relay, () => {
            logSync("wire", `${relay}: socket reopened — restarting round`);
            round.abort();
            wakeSleep?.();
          });
          let sawAnything = false;
          // Whether the round's stored replay has finished (EOSE seen): events
          // after it are LIVE arrivals. Ingest uses this to keep replayed
          // events (a wrap filter's since rewinds the NIP-59 backdate window —
          // see stampRoundSince) from re-firing notifications every round.
          let eosed = false;
          let lastMsgAt = started;
          let ingested = 0;
          let rotated = false;
          const watchdog = setInterval(() => {
            const silentFor = Date.now() - lastMsgAt;
            if (!sawAnything && silentFor >= SILENT_REQ_TIMEOUT_MS) {
              logSync("wire", `${relay}: round yielded nothing in ${Math.round(silentFor / 1000)}s — presumed swallowed, re-REQ`);
              round.abort();
            } else if (sawAnything && silentFor >= QUIET_ROTATE_MS) {
              rotated = true;
              round.abort();
            }
          }, WATCHDOG_TICK_MS);
          if (firstRound) {
            logSync("wire", `${relay}: round open (since=${since}, ${filters.length} filter(s))`);
            firstRound = false;
          }
          // Pre-EOSE events are a stored replay — buffer them and flush in
          // batches (see REPLAY_BATCH_MAX); post-EOSE events are live and
          // ingest one-by-one as they arrive.
          let replay: NostrEvent[] = [];
          const flushReplay = async () => {
            if (replay.length === 0) return;
            const batch = replay;
            replay = [];
            await ingestWireEvents(sinksRef.current, batch, { live: false });
            ingested += batch.length;
            writeCursor(owner, relay, Math.max(...batch.map((e) => e.created_at)));
          };
          try {
            try {
              for await (const msg of nostr.relay(relay).req(
                stampRoundSince(filters, since, now),
                { signal: roundSignal },
              )) {
                sawAnything = true;
                lastMsgAt = Date.now();
                if (msg[0] === "EOSE") {
                  await flushReplay();
                  eosed = true;
                }
                if (msg[0] === "EVENT") {
                  backoff = 1_000;
                  const event = msg[2] as NostrEvent;
                  if (eosed) {
                    await ingestWireEvents(sinksRef.current, [event], { live: true });
                    ingested += 1;
                    writeCursor(owner, relay, event.created_at);
                  } else {
                    replay.push(event);
                    if (replay.length >= REPLAY_BATCH_MAX) await flushReplay();
                  }
                }
              }
            } finally {
              // A round torn down mid-replay (watchdog, reopen bump, effect
              // cleanup) still ingests what it already received.
              await flushReplay();
            }
          } catch {
            // Aborted or transport error — handled by the loop condition.
          } finally {
            clearInterval(watchdog);
            // Release the composite roundSignal's grip on the effect
            // controller (a naturally-CLOSED round never aborted its own).
            round.abort();
          }
          if (controller.signal.aborted) break;
          if (!rotated) {
            logSync(
              "wire",
              `${relay}: round ended after ${Math.round((Date.now() - started) / 1000)}s (${ingested} event(s) ingested)`,
            );
          }
          // A session that lived a while earned a prompt retry; a relay
          // slamming the door (CLOSED right away) backs off up to 60s.
          if (Date.now() - started > 60_000) backoff = 1_000;
          await sleep(backoff + Math.floor(Math.random() * 250));
          backoff = Math.min(backoff * 2, 60_000);
        }
      })();
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      offReopen();
      controller.abort();
    };
    // Resubscribe only when the actual subscription set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, user?.pubkey, spec.sig]);

  // ── APK bridge: the persistent service is a funnel into the same ingest ──
  // Phase 1: `BaoNotification` is a stub (see lib/nativeNotifications.ts) —
  // drainEvents resolves empty and addListener rejects (caught below), so the
  // bridge inerts until the native service is ported in a later phase.
  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;

    const ingest = (raw: string[], live: boolean): Promise<void> => {
      const events: NostrEvent[] = [];
      for (const json of raw) {
        try {
          events.push(JSON.parse(json) as NostrEvent);
        } catch {
          // malformed line — skip
        }
      }
      if (events.length > 0 && !cancelled) {
        return ingestWireEvents(sinksRef.current, events, { live });
      }
      return Promise.resolve();
    };

    // Drain what the service received while the WebView was down (open /
    // resume). The service writes events durably into the shared native
    // database; drainEvents pages rows after the persisted cursor, and the
    // cursor is acked only AFTER ingest completes (parked wraps persisted,
    // store writes flushed) so a webview crash mid-page replays instead of
    // losing events. NOT live: the service already notified for these.
    let draining = false;
    const drain = async () => {
      if (draining) return; // resume + mount can overlap; pages are sequential
      draining = true;
      try {
        while (!cancelled) {
          const { events, cursor } = await BaoNotification.drainEvents();
          if (events.length === 0) break;
          await ingest(events, false);
          if (cancelled) break;
          await BaoNotification.ackDrain({ cursor });
        }
      } catch {
        // Bridge unavailable / mid-drain failure — the unacked page replays.
      } finally {
        draining = false;
      }
    };
    void drain();

    let resumeHandle: { remove: () => void } | undefined;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void drain();
    })
      .then((h) => {
        if (cancelled) h.remove();
        else resumeHandle = h;
      })
      .catch(() => undefined);

    let liveHandle: { remove: () => void } | undefined;
    BaoNotification.addListener("relayEvent", ({ event }) => {
      void ingest([event], true);
    })
      .then((h) => {
        if (cancelled) h.remove();
        else liveHandle = h;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      liveHandle?.remove();
      resumeHandle?.remove();
    };
  }, []);

  // ── Parked-wrap drain: decrypt what the service left us, as keys appear ──
  // Covers BOTH chat wraps (→ rumor store, `c2:` scope) and control-plane wraps
  // (→ opened-event store, `c2ctl:` scope). Any wrap the wire can't open at
  // ingest time is parked; this drains them whenever the spec (hence the held
  // key set) changes. This is the single drain for both planes.
  useEffect(() => {
    if (spec.v2ByPk.size === 0 && spec.v2CtlByPk.size === 0) return;
    let cancelled = false;
    // Debounce: spec.sig fires several times during startup as queries resolve
    // (concord2, concord2Control). Without a delay each firing kicks off IDB
    // reads + openChatBatch + IDB writes concurrently, monopolising the main
    // thread before the UI is interactive.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const parked = await peekPendingWraps([...spec.v2ByPk.keys(), ...spec.v2CtlByPk.keys()]);
          if (parked.length === 0 || cancelled) return;
          const scopes = new Set<string>();
          const acked: string[] = [];

          // Chat wraps → rumor store, grouped per owning channel.
          const byChannel = new Map<ChannelV2, NostrEvent[]>();
          // Control wraps → opened-event store, grouped per owning community.
          const ctlByCommunity = new Map<string, { groups: GroupKey[]; wraps: NostrEvent[] }>();
          for (const wrap of parked) {
            const channel = spec.v2ByPk.get(wrap.pubkey);
            if (channel) {
              const list = byChannel.get(channel);
              if (list) list.push(wrap);
              else byChannel.set(channel, [wrap]);
              continue;
            }
            const ctl = spec.v2CtlByPk.get(wrap.pubkey);
            if (ctl) {
              const bucket = ctlByCommunity.get(ctl.idHex);
              if (bucket) bucket.wraps.push(wrap);
              else ctlByCommunity.set(ctl.idHex, { groups: ctl.groups, wraps: [wrap] });
            }
          }

          for (const [channel, wraps] of byChannel) {
            const opened = await openChatBatch(wraps, channel);
            if (opened.length === 0) continue;
            writeRumors(opened);
            scopes.add(`c2:${channel.idHex}`);
            const openedWrapIds = new Set(opened.map((o) => o.wrapId));
            acked.push(...wraps.filter((w) => openedWrapIds.has(w.id)).map((w) => w.id));
          }

          for (const [idHex, { groups, wraps }] of ctlByCommunity) {
            const opened = await openPlaneWrapsChunked(wraps, groups);
            if (opened.length === 0) continue;
            await writeOpened(opened);
            scopes.add(`c2ctl:${idHex}`);
            const openedWrapIds = new Set(opened.map((o) => o.wrapId));
            acked.push(...wraps.filter((w) => openedWrapIds.has(w.id)).map((w) => w.id));
          }

          ackPendingWraps(acked);
          if (scopes.size > 0) emitWireScopes(scopes);
        } catch {
          // Best-effort — wraps stay parked for the next pass.
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.sig]);

  return null;
}
