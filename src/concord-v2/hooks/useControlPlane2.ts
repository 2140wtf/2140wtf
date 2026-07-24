import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useDeferredFold } from "@/concord-v2/hooks/useDeferredFold2";
import {
  controlGroups,
  currentControlGroup,
  foldControlState,
  isDissolvedOpened,
  openControlEditions,
  sealEdition,
  type EntityHead,
  type FoldedControl,
} from "@/concord-v2/lib/control";
import { channelsView } from "@/concord-v2/lib/community";
import { bytesToHex, dissolvedGroupKey, grantLocator, hex32 } from "@/concord-v2/lib/derive";
import type { AuthorityCitation } from "@/concord-v2/lib/edition";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import { openPlaneWraps, mergeOpened, sweepControl } from "@/concord-v2/lib/planeSync";
import { queryByStreams, writeOpened } from "@/concord-v2/lib/rumorStore";
import { openWrap, type OpenedEvent, type Rumor, type StreamSigner } from "@/concord-v2/lib/stream";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";
import { logSync } from "@/lib/syncLog";
import { onWireScopes } from "@/wire/bus";

import type { NostrEvent } from "@nostrify/nostrify";

/**
 * The persisted control-fold snapshot key for a community (see
 * {@link useDeferredFold}). Shared with the notification-subscription builder,
 * which reads the cached fold without mounting a per-community hook.
 */
export const controlFoldKey = (idHex: string) => `concord2-fold:${idHex}`;

/**
 * Fetch the community's Control Plane. Wraps are decrypted once into the
 * opened-event store; this query reads back from it with no decrypt. A
 * persisted `since` cursor means editions already seen are never refetched.
 * `active` gates the network fetch, not the local read.
 *
 * NETWORK OWNERSHIP: this hook holds no standing sockets and runs no poll.
 * Live control editions arrive through the wire's standing `c2ctl`
 * subscription (see wire/spec.ts + wire/ingest.ts), which decrypts them into
 * the opened-event store and rings `c2ctl:<idHex>`; the seed effect below
 * re-reads on that bus. The slow catch-up for communities you haven't opened is
 * the global {@link syncControlPlane} sweep (ControlPlaneSync). The only
 * network this hook itself issues is a SINGLE on-open catch-up sweep (shared,
 * single-flight, cursor-gated via {@link sweepControl}) so navigating into a
 * community surfaces anything the live sub missed while offline. The query's
 * `queryFn` is a pure store read — it exists so react-query invalidation (e.g.
 * after publishing an edition) re-folds from the store.
 */
export function useControlEvents2(community: CommunityV2 | undefined, active = true) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const cidHex = community?.idHex ?? null;
  const epochSig = community?.heldRoots.map((r) => r.epoch.toString()).join(",") ?? "";
  const queryKey = ["concord2", "control", cidHex, epochSig] as const;

  // Seed from the opened-event cache (paints rail icons without network).
  // Re-seeds on the `c2ctl:<id>` wire bus when the wire's live subscription (or
  // the background sweep) stores new editions — a rail button with active=false
  // can't be reached by invalidation, so the bus is its only wake-up.
  useEffect(() => {
    if (!community) return;
    let cancelled = false;
    const seed = async (merge: boolean) => {
      if (!merge && (queryClient.getQueryData<OpenedEvent[]>(queryKey)?.length ?? 0) > 0) return;
      const cached = await queryByStreams(controlGroups(community).map((g) => g.pk));
      if (cancelled) return;
      logSync(
        "control",
        `${community.idHex.slice(0, 8)} store seed${merge ? " (bus re-seed)" : ""}: ${cached.length} opened edition(s)`,
      );
      if (cached.length === 0) return;
      queryClient.setQueryData<OpenedEvent[]>(queryKey, (old) =>
        merge ? mergeOpened(old ?? [], cached) : old && old.length > 0 ? old : cached,
      );
    };
    void seed(false);
    const scope = `c2ctl:${community.idHex}`;
    const unsubscribe = onWireScopes((scopes) => {
      if (scopes.has(scope)) void seed(true);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidHex, epochSig, queryClient]);

  // On-open catch-up: when the community becomes active (you navigate into it),
  // run ONE control sweep so an edition published while the live wire sub was
  // down — or since the last 5-min background sweep — surfaces promptly without
  // waiting for the next global tick. This is the shared, single-flight,
  // cursor-gated sweepControl (it coalesces with the background sweep and never
  // re-pays history), NOT a standing socket. Runs once per community-open;
  // liveness thereafter is the wire's `c2ctl` subscription. Freshly-opened
  // events land in the store and wake the seed effect via `c2ctl:<id>`.
  useEffect(() => {
    if (!community || !active) return;
    let cancelled = false;
    void sweepControl(nostr, community, {
      onFresh: (fresh) => {
        if (cancelled || fresh.length === 0) return;
        queryClient.setQueryData<OpenedEvent[]>(queryKey, (old) => mergeOpened(old ?? [], fresh));
      },
    }).catch(() => {
      // Best-effort — the background sweep and live wire sub cover any miss.
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, cidHex, epochSig, active]);

  return useQuery<OpenedEvent[]>({
    queryKey,
    enabled: Boolean(community) && active,
    staleTime: 15_000,
    queryFn: async () => {
      const groups = controlGroups(community!);
      const stored = await queryByStreams(groups.map((g) => g.pk));
      const prev = queryClient.getQueryData<OpenedEvent[]>(queryKey) ?? [];
      return mergeOpened(prev, stored);
    },
  });
}

/**
 * The Control Plane replayed into current state (roster, metadata, channels,
 * banlist, registries). Folded off the render path with a persisted snapshot.
 */
export function useControlFold2(community: CommunityV2 | undefined, active = true) {
  const control = useControlEvents2(community, active);
  const events = control.data;

  // Per-entity high-water floor (CORD-04 §1): the highest version we've ever
  // accepted for each entity, monotonic and never lowered. Feeding it back into
  // the fold makes a tracking client fail closed on a withheld-middle chain —
  // a hostile relay serving only a higher DANGLING edition can't downgrade an
  // entity we already advanced past. EPOCH-primary: a floor from a superseded
  // founding must not out-anchor the new epoch's compacted snapshot, so
  // adopting a rekey (itself continuity-gated) re-baselines the floor — the
  // within-epoch withholding defense is untouched.
  const floorKey = community ? `${community.idHex}@${community.rootEpoch}` : "";
  const floorRef = useRef<{ key: string; heads: Map<string, EntityHead> }>({ key: "", heads: new Map() });
  if (community && floorRef.current.key !== floorKey) {
    floorRef.current = { key: floorKey, heads: new Map() };
  }

  const data = useDeferredFold<FoldedControl>(
    community ? controlFoldKey(community.idHex) : null,
    () => {
      if (!community || !events) return undefined;
      const editions = openControlEditions(events);
      // Once the community has Refounded, editions under the CURRENT epoch's
      // control group fold by version-anchored bootstrap (the compaction
      // snapshot outranks old-root fragments — see headCandidates). A
      // never-rotated community keeps full chain-contiguity semantics.
      const curPk = currentControlGroup(community).pk;
      const snapshotIds =
        community.rootEpoch > 0n
          ? new Set(events.filter((ev) => ev.streamPk === curPk).map((ev) => ev.rumorId))
          : undefined;
      const folded = foldControlState(editions, community.id, community.owner, floorRef.current.heads, snapshotIds);
      // Raise the high-water floor from this fold's accepted heads (upward only).
      for (const [eid, head] of folded.heads) {
        const prior = floorRef.current.heads.get(eid);
        if (!prior || head.version > prior.version) floorRef.current.heads.set(eid, head);
      }
      logSync(
        "fold",
        `${community.idHex.slice(0, 8)}: ${events.length} opened → ${editions.length} edition(s); name=${folded.metadata?.name ?? "∅"} icon=${folded.metadata?.icon ? "yes" : "no"} channels=${folded.channels.size} banned=${folded.banned.size} heads=${folded.heads.size}`,
      );
      return folded;
    },
    [community, events],
  );

  return { ...control, data } as typeof control & { data: FoldedControl | undefined };
}

/** The channels the member can read, assembled from the fold + held keys. */
export function useChannels2(community: CommunityV2 | undefined, active = true): ChannelV2[] {
  const { data: folded } = useControlFold2(community, active);
  return useMemo(() => (community ? channelsView(community, folded) : []), [community, folded]);
}

/**
 * Whether the community has been dissolved by its owner (terminal). Reads the
 * community-id-derived dissolved address — no key, no epoch — so every member
 * past or present resolves the same grave.
 *
 * `active` gates the network poll: the rail doesn't need each community's
 * dissolution status up-front, so it's only checked once you open the community.
 */
export function useDissolved2(community: CommunityV2 | undefined, active = true) {
  const { nostr } = useNostr();

  return useQuery<boolean>({
    queryKey: ["concord2", "dissolved", community?.idHex ?? null],
    enabled: Boolean(community) && active,
    staleTime: 30_000,
    // A dissolution is a rare, terminal event; once stored it's cached forever
    // (the network branch below short-circuits). A slow, foreground-only poll
    // is plenty to notice it.
    refetchInterval: active ? 5 * 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const group = dissolvedGroupKey(community!.id);
      // A dissolution tombstone is terminal and immutable — if we've already
      // stored one, we're done without touching the network.
      const cached = await queryByStreams([group.pk]);
      if (cached.some((o) => isDissolvedOpened(o, community!.owner))) return true;

      const results = await Promise.all(
        community!.relays.map((url) =>
          nostr
            .relay(url)
            .query([{ kinds: [KIND_WRAP], authors: [group.pk], limit: 10 }], {
              signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            })
            .catch(() => [] as NostrEvent[]),
        ),
      );
      const opened = openPlaneWraps(results.flat(), [group]);
      if (opened.length > 0) writeOpened(opened);
      return opened.some((o) => isDissolvedOpened(o, community!.owner));
    },
  });
}

// ── Publishing ───────────────────────────────────────────────────────────────

/**
 * Sign (plaintext seal) + wrap + broadcast one edition to the community relays.
 * `opts.relays` overrides the fan-out set — a relay-list edition must reach
 * BOTH the old and the new relays (the fold that announces a move lives on the
 * relays being moved away from).
 */
export async function publishEdition2(
  nostr: ReturnType<typeof useNostr>["nostr"],
  community: CommunityV2,
  signer: StreamSigner,
  rumor: Rumor,
  opts?: { relays?: string[] },
): Promise<void> {
  const control = currentControlGroup(community);
  const wrap = await sealEdition(rumor, control, signer);
  const urls = opts?.relays ?? community.relays;
  const results = await Promise.allSettled(
    urls.map((url) => nostr.relay(url).event(wrap, { signal: AbortSignal.timeout(8000) })),
  );
  if (!results.some((r) => r.status === "fulfilled")) {
    throw new Error("No relay accepted the change.");
  }
  // Write our own edition to the local opened-event store immediately: the
  // refetch after invalidation unions the store, so the publisher's fold picks
  // the change up even if no relay echoes the wrap back (or the persisted
  // `since` cursor would skip it). Without this, a promote can "succeed" with
  // no visible effect until a full resync.
  try {
    writeOpened([openWrap(wrap, control)]);
  } catch {
    // best-effort — the relay echo remains the fallback
  }
}

/**
 * The authority citation an actor attaches to an action (CORD-04 §5): the
 * exact Grant edition they act under, pinned by coordinate + version + hash.
 * Absent when the owner acts — supreme needs no citation.
 */
export function citationFor(
  community: CommunityV2,
  folded: FoldedControl | undefined,
  actorHex: string,
): AuthorityCitation | undefined {
  if (!folded || actorHex === community.owner) return undefined;
  const eid = grantLocator(community.id, hex32(actorHex));
  const head = folded.heads.get(bytesToHex(eid));
  if (!head) return undefined;
  return { entityId: eid, version: head.version, editionHash: head.hash };
}

/** Invalidate every read that folds from the control plane. */
export function invalidateControl2(queryClient: ReturnType<typeof useQueryClient>, idHex: string): void {
  queryClient.invalidateQueries({ queryKey: ["concord2", "control", idHex] });
}
