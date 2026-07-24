/**
 * Plane sweeps — the ONE fetch/decrypt/cursor discipline for a community's
 * kind-1059 planes (control, guestbook), shared by the per-community hooks
 * and the global background sweep.
 *
 * - AUTH-GATED: holds every REQ until the scopes' stream keys are
 *   NIP-42-registered and (on a challenged socket) their AUTHs are ACKED by
 *   the relay, with a hard cap so a key that never registers can't stall
 *   sync. The ack is the relay's own `OK` — no settle-timer guesswork.
 * - BATCHED: same-relay scopes coalesce into one REQ (one filter per scope,
 *   each with its own cursor and limit — per-filter isolation prevents the
 *   issue-#19 since-skip).
 * - SINGLE-FLIGHT: overlapping sweeps of the same scope join the in-flight
 *   fetch instead of re-paying the full history.
 *
 * Two completeness modes, chosen per plane:
 *
 * - COMPLETE (Control): correctness-critical and compaction-bounded, so every
 *   sweep re-fetches the WHOLE plane — no `since`, paging past the relay's
 *   per-filter limit. A forward cursor here silently starves the fold: the
 *   cursor key outlives a leave/ban/rejoin and the held-epoch set it was
 *   minted under, so any edition below the high-water mark that was never
 *   ingested (an unban published while the client was out, a compaction
 *   re-wrap under a newly-held epoch) stays invisible forever — the client
 *   then folds a STALE banlist/roster and mis-renders membership. Repeat
 *   sweeps stay cheap: a persisted seen-wrap memo skips the re-decrypt (the
 *   folds re-read the opened-event store), and `onFresh` fires only for wraps
 *   not yet processed.
 * - FORWARD (Guestbook): append-mostly and unbounded, so it keeps the
 *   persisted `since` cursor — but the cursor scope is keyed by the newest
 *   held epoch, so an epoch advance (rejoin, rekey adoption) re-baselines
 *   with one full backfill instead of trusting a cursor minted under a
 *   different read scope.
 */

import { controlGroups } from "@/concord-v2/lib/control";
import { guestbookGroups } from "@/concord-v2/lib/guestbook";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import { readStreamCursor, updateStreamCursor, writeOpened } from "@/concord-v2/lib/rumorStore";
import { isStreamPubkey, streamAuthsSettled } from "@/concord-v2/lib/streamAuth";
import { openWrap, type OpenedEvent } from "@/concord-v2/lib/stream";
import type { GroupKey } from "@/concord-v2/lib/derive";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { readFolded, writeFolded } from "@/lib/foldedCache";
import { beginSyncTask } from "@/lib/syncActivity";
import { logSync, sinceMs } from "@/lib/syncLog";

import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

/** Minimal relay-capable Nostr client the sweeps need (batcher-backed). */
interface NostrLike {
  relay(url: string): {
    query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
  };
}

/** Auth gate timing (test seam via {@link _configureAuthWaitForTests}). */
const authWait = {
  /** Hard cap so a key that never registers/acks can't stall sync. */
  maxWaitMs: 8_000,
};

/** Test seam: shrink (or zero) the auth gate so sweeps run immediately. */
export function _configureAuthWaitForTests(cfg: Partial<typeof authWait>): void {
  Object.assign(authWait, cfg);
}

/**
 * Resolve once every group is registered AND its AUTH is acked on `url` (or
 * the relay never challenged — then there's nothing to wait for), or the cap
 * expires. Ack state comes from the relay's own `OK` replies (streamAuth).
 */
async function whenAuthReady(url: string, groupsOf: () => GroupKey[]): Promise<void> {
  const deadline = Date.now() + authWait.maxWaitMs;
  for (;;) {
    const pks = groupsOf().map((g) => g.pk);
    const registered = pks.every((pk) => isStreamPubkey(pk));
    if ((registered && streamAuthsSettled(url, pks)) || Date.now() >= deadline) return;
    await new Promise((r) => setTimeout(r, Math.max(1, Math.min(50, deadline - Date.now()))));
  }
}

/**
 * Wait until `url` has ACKED the AUTHs for every group — but only if the relay
 * actually challenged this socket (an unchallenged relay isn't auth-gating, or
 * its lazy challenge will be triggered by the REQ itself and covered by the
 * pool's auth-retry). Same cap/test seam as the sweep gate.
 *
 * This is the gate for NON-sweep reads (channel backfills, the login warm-up's
 * newest-page pulls): a kind-1059 REQ racing NIP-42 gets CLOSED by the relay
 * and reads back as a clean empty page — which is how a fresh login used to
 * "complete" with zero messages and drop the user into hollow rooms.
 */
export async function whenAuthSettled(url: string, groupsOf: () => GroupKey[]): Promise<void> {
  const deadline = Date.now() + authWait.maxWaitMs;
  for (;;) {
    if (streamAuthsSettled(url, groupsOf().map((g) => g.pk)) || Date.now() >= deadline) return;
    await new Promise((r) => setTimeout(r, Math.max(1, Math.min(50, deadline - Date.now()))));
  }
}

/** One community-plane on one relay: a filter + its persisted cursor. */
export interface PlaneScope {
  /** The scope key: single-flight identity, and (forward mode) the persisted cursor key. */
  scope: string;
  /** The stream keys whose addresses this plane's wraps are authored by. */
  groups: GroupKey[];
  /**
   * COMPLETE mode (see the module docstring): every sweep re-fetches the whole
   * plane instead of trusting a forward cursor. Reserved for planes that are
   * both correctness-critical and compaction-bounded (Control).
   */
  complete?: boolean;
  /** Called with this scope's decrypted events once they're committed. */
  onFresh?: (fresh: OpenedEvent[]) => void;
  /**
   * COMPLETE mode only: fired when the pager hit its budget and left older
   * events unfetched this round. A Refounding must abort on this — compacting
   * a truncated plane drops the unfetched entities from the new epoch.
   */
  onTruncated?: () => void;
}

/**
 * One community's Control Plane on one relay. COMPLETE: the fold that hangs
 * off this plane (roster, banlist, channels, registries) must never run on a
 * silently-truncated edition set — see the module docstring.
 */
export function controlScope(
  community: CommunityV2,
  relayUrl: string,
  onFresh?: (fresh: OpenedEvent[]) => void,
): PlaneScope {
  return {
    scope: `control:${community.idHex}|${relayUrl}`,
    groups: controlGroups(community),
    complete: true,
    onFresh,
  };
}

/**
 * One community's Guestbook Plane on one relay. FORWARD-cursored, but the
 * cursor scope is keyed by the newest held epoch: a rejoin or rekey adoption
 * changes what the member can read, so the first sweep at the new epoch is a
 * full backfill — a cursor minted under the old read scope must never gate it.
 */
export function guestbookScope(
  community: CommunityV2,
  relayUrl: string,
  onFresh?: (fresh: OpenedEvent[]) => void,
): PlaneScope {
  return {
    scope: `guestbook:${community.idHex}@${community.rootEpoch}|${relayUrl}`,
    groups: guestbookGroups(community),
    onFresh,
  };
}

/** Merge opened-event sets by rumor id (a partial round must not drop editions). */
export function mergeOpened(...sets: OpenedEvent[][]): OpenedEvent[] {
  const byId = new Map<string, OpenedEvent>();
  for (const set of sets) for (const e of set) byId.set(e.rumorId, e);
  return [...byId.values()];
}

/** Decrypt raw plane wraps under the held groups into opened events. */
export function openPlaneWraps(wraps: NostrEvent[], groups: GroupKey[]): OpenedEvent[] {
  const byPk = new Map(groups.map((g) => [g.pk, g]));
  const out: OpenedEvent[] = [];
  for (const wrap of wraps) {
    const group = byPk.get(wrap.pubkey);
    if (!group) continue;
    try {
      out.push(openWrap(wrap, group));
    } catch {
      // not ours / malformed
    }
  }
  return out;
}

/** Max unbroken main-thread time (ms) spent decrypting before yielding
 *  (mirrors chat.ts's DECODE_SLICE_MS — see the rationale there). */
const PLANE_DECODE_SLICE_MS = 5;

/**
 * Time-sliced {@link openPlaneWraps}: the same decrypt, but yields the event
 * loop whenever a slice has run past {@link PLANE_DECODE_SLICE_MS}. Each wrap
 * costs a NIP-44 open + Schnorr verify (+ a second NIP-44 open for encrypted
 * seals) — all synchronous noble crypto — so decoding a whole plane in one
 * unbroken loop freezes the UI for the duration on a phone.
 */
export async function openPlaneWrapsChunked(wraps: NostrEvent[], groups: GroupKey[]): Promise<OpenedEvent[]> {
  const byPk = new Map(groups.map((g) => [g.pk, g]));
  const out: OpenedEvent[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < wraps.length; i++) {
    const group = byPk.get(wraps[i].pubkey);
    if (group) {
      try {
        out.push(openWrap(wraps[i], group));
      } catch {
        // not ours / malformed
      }
    }
    if (i + 1 < wraps.length && performance.now() - sliceStart >= PLANE_DECODE_SLICE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
  return out;
}

/** Paging knobs (test seam via {@link _configureSweepPagingForTests}). */
const paging = {
  /** Per-filter page size, shared by the batch REQ and the complete-mode pager. */
  pageLimit: 500,
  /** Complete-mode paging cap — far beyond any real (compacted) control plane. */
  maxPages: 8,
};

/** Test seam: shrink the page size so the pager is exercisable with few events. */
export function _configureSweepPagingForTests(cfg: Partial<typeof paging>): void {
  Object.assign(paging, cfg);
}

/**
 * Wrap ids a COMPLETE scope has already processed (decrypted or judged
 * garbage). Full-plane sweeps re-receive the same wraps every round — the
 * memo keeps repeat sweeps decrypt-free and `onFresh` quiet. Ids are global
 * (a wrap id is content-addressed), so the same wrap arriving from a second
 * relay is also deduped. Insertion-ordered, half-evicted at the cap.
 *
 * PERSISTED (foldedCache): an id is only noted after its decrypted rumor is
 * durably in the opened-event store (or it failed to decrypt under a held key
 * — permanent garbage, since every wrap here matched a held group's address),
 * and the folds re-read the store, so a cold launch can skip re-decrypting
 * the whole plane. A session-only memo made every relaunch re-pay the full
 * NIP-44+Schnorr pass over thousands of control wraps — the main-thread stall
 * on startup. Wiped with the rest of `2140-concord-cache` on logout; an
 * evicted or lost id merely re-decrypts once.
 */
const seenCompleteWraps = new Set<string>();
const SEEN_WRAPS_CAP = 16_384;
const SEEN_WRAPS_KEY = "plane-seen-wraps";
/** Debounce for the persisted-memo write, so a sweep burst is one write. */
const SEEN_WRAPS_PERSIST_MS = 1_000;

let seenWrapsLoaded: Promise<void> | undefined;
let seenWrapsPersistTimer: ReturnType<typeof setTimeout> | undefined;

/** Union the persisted memo into the session set (once per session). */
function loadSeenWraps(): Promise<void> {
  seenWrapsLoaded ??= readFolded<string[]>(SEEN_WRAPS_KEY)
    .then((ids) => {
      if (ids) for (const id of ids) seenCompleteWraps.add(id);
    })
    .catch(() => undefined);
  return seenWrapsLoaded;
}

function schedulePersistSeenWraps(): void {
  if (seenWrapsPersistTimer !== undefined) return;
  seenWrapsPersistTimer = setTimeout(() => {
    seenWrapsPersistTimer = undefined;
    void writeFolded(SEEN_WRAPS_KEY, [...seenCompleteWraps]);
  }, SEEN_WRAPS_PERSIST_MS);
}

/**
 * Mark wrap ids as processed. Call only once their rumors are durably in the
 * opened-event store (or they failed under a held key). Shared with the
 * wire's control-wrap ingest path, so a wrap decrypted by either transport is
 * never re-decrypted by the other.
 */
export function notePlaneWrapsSeen(ids: string[]): void {
  const before = seenCompleteWraps.size;
  for (const id of ids) seenCompleteWraps.add(id);
  if (seenCompleteWraps.size > SEEN_WRAPS_CAP) {
    let toDrop = seenCompleteWraps.size - SEEN_WRAPS_CAP / 2;
    for (const id of seenCompleteWraps) {
      if (toDrop-- <= 0) break;
      seenCompleteWraps.delete(id);
    }
  }
  if (seenCompleteWraps.size !== before) schedulePersistSeenWraps();
}

/** The subset of `wraps` not yet processed (loads the persisted memo first). */
export async function unseenPlaneWraps(wraps: NostrEvent[]): Promise<NostrEvent[]> {
  await loadSeenWraps();
  return wraps.filter((w) => !seenCompleteWraps.has(w.id));
}

/** Test seam: forget which wraps have been processed (session + persisted). */
export function _resetPlaneSweepMemoForTests(): void {
  seenCompleteWraps.clear();
  if (seenWrapsPersistTimer !== undefined) {
    clearTimeout(seenWrapsPersistTimer);
    seenWrapsPersistTimer = undefined;
  }
  seenWrapsLoaded = Promise.resolve();
  void writeFolded(SEEN_WRAPS_KEY, []);
}

/**
 * Scope keys whose most recent COMPLETE sweep left events behind (pager cap).
 * Kept module-level so a caller that JOINED an in-flight sweep can still read
 * the verdict after awaiting it — the joiner's own callbacks never fire.
 */
const truncatedScopes = new Set<string>();

/** Whether any relay's last control sweep for this community was truncated. */
export function controlSweepTruncated(community: CommunityV2): boolean {
  return community.relays.some((url) => truncatedScopes.has(`control:${community.idHex}|${url}`));
}

/**
 * Page a COMPLETE scope past the relay's per-filter limit: `until` the oldest
 * wrap seen so far, until a short page says the relay is exhausted. `until` is
 * inclusive, so pages overlap by design (dedupe by id) — the overlap is what
 * steps over a same-second boundary instead of skipping it.
 */
async function fetchCompleteScope(
  nostr: NostrLike,
  url: string,
  filter: NostrFilter,
  first: NostrEvent[],
  onTruncated?: () => void,
): Promise<NostrEvent[]> {
  const byId = new Map(first.map((e) => [e.id, e] as const));
  let lastBatch = first;
  for (let hops = 0; lastBatch.length >= paging.pageLimit; hops++) {
    if (hops >= paging.maxPages) {
      // No silent caps: a plane this deep exceeds the pager's budget.
      logSync("sweep", `complete-scope pager hit ${paging.maxPages} pages on ${url} — older events left behind this round`);
      onTruncated?.();
      break;
    }
    const until = Math.min(...[...byId.values()].map((e) => e.created_at));
    const older = await nostr.relay(url).query([{ ...filter, until }], {
      signal: AbortSignal.timeout(15_000),
    });
    const fresh = older.filter((e) => !byId.has(e.id));
    for (const e of fresh) byId.set(e.id, e);
    // A full page of pure overlap is a same-second wall thicker than the
    // limit — no `until` can get past it, so stop rather than spin.
    if (fresh.length === 0) break;
    lastBatch = older;
  }
  return [...byId.values()];
}

/**
 * Run one relay's batch: one filter per scope (cursor-gated for forward
 * scopes, whole-plane for complete ones), ONE query, demuxed by wrap author.
 * Retries once on failure (cursors stay put so the next sweep re-asks). Not
 * abortable by callers — the REQ is shared.
 */
async function runScopes(
  nostr: NostrLike,
  url: string,
  scopes: PlaneScope[],
): Promise<Map<string, OpenedEvent[]>> {
  // The persisted seen-wrap memo must be in the session set before the
  // complete-scope narrowing below, or a cold launch re-decrypts everything.
  await loadSeenWraps();
  const cursors = await Promise.all(
    scopes.map((s) => (s.complete ? undefined : readStreamCursor(s.scope))),
  );
  const filters: NostrFilter[] = scopes.map((s, i) => ({
    kinds: [KIND_WRAP],
    authors: s.groups.map((g) => g.pk),
    limit: paging.pageLimit,
    ...(cursors[i]?.newest ? { since: cursors[i]!.newest } : {}),
  }));
  const out = new Map<string, OpenedEvent[]>(scopes.map((s) => [s.scope, []]));

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const events = await nostr.relay(url).query(filters, {
        signal: AbortSignal.timeout(15_000),
      });

      // Demux by wrap author: every scope's stream addresses are distinct.
      const scopeByPk = new Map<string, number>();
      scopes.forEach((s, i) => s.groups.forEach((g) => scopeByPk.set(g.pk, i)));
      const perScope: NostrEvent[][] = scopes.map(() => []);
      for (const ev of events) {
        const i = scopeByPk.get(ev.pubkey);
        if (i !== undefined) perScope[i].push(ev);
      }

      // A complete scope whose first page filled up may have older history
      // behind the limit — page it in before deciding what's fresh.
      for (const [i, s] of scopes.entries()) {
        if (!s.complete) continue;
        truncatedScopes.delete(s.scope);
        if (perScope[i].length >= paging.pageLimit) {
          perScope[i] = await fetchCompleteScope(nostr, url, filters[i], perScope[i], () => {
            truncatedScopes.add(s.scope);
            s.onTruncated?.();
          });
        }
      }

      // Decrypt everything new (time-sliced — a cold plane is thousands of
      // synchronous EC ops), then ONE store write and parallel cursor
      // advances. A complete scope narrows to wraps not yet processed (the
      // persisted memo); a forward scope's `since` already did that narrowing.
      const freshPerScope: OpenedEvent[][] = [];
      for (const [i, s] of scopes.entries()) {
        freshPerScope.push(
          await openPlaneWrapsChunked(
            s.complete ? perScope[i].filter((w) => !seenCompleteWraps.has(w.id)) : perScope[i],
            s.groups,
          ),
        );
      }
      const allFresh = freshPerScope.flat();
      if (allFresh.length > 0) await writeOpened(allFresh);
      await Promise.all(
        scopes.map((s, i) => {
          const mine = perScope[i];
          logSync(
            "sweep",
            `${s.scope} → ${mine.length} event(s), ${freshPerScope[i].length} new in ${sinceMs(started)} (${s.complete ? "full" : `since=${cursors[i]?.newest ?? "∅"}`}, authors×${s.groups.length})`,
          );
          if (s.complete) {
            // Only the memo advances — every sweep re-asks for the whole
            // plane, so nothing received can ever become unreachable.
            notePlaneWrapsSeen(mine.map((w) => w.id));
            return undefined;
          }
          if (mine.length === 0) return undefined;
          return updateStreamCursor(s.scope, { newest: Math.max(...mine.map((e) => e.created_at)) });
        }),
      );
      for (const [i, s] of scopes.entries()) {
        const fresh = freshPerScope[i];
        if (fresh.length === 0) continue;
        out.set(s.scope, fresh);
        s.onFresh?.(fresh);
      }
      return out;
    } catch (err) {
      logSync(
        "sweep",
        `${url} sweep FAILED in ${sinceMs(started)} (${scopes.length} scope(s), attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt >= 2) break;
      // Pause, then re-check the auth gate before the retry: a first round
      // lost to a lazy NIP-42 challenge (REQ → CLOSED auth-required → AUTHs
      // sent) passes once the relay has acked the stream AUTHs.
      await new Promise((r) => setTimeout(r, 250));
      await whenAuthReady(url, () => scopes.flatMap((s) => s.groups));
    }
  }
  return out;
}

/** In-flight sweeps by cursor scope (see the single-flight docstring). */
const inflight = new Map<string, Promise<OpenedEvent[]>>();

/** Extra enrollment time for an OPEN gate, so same-render callers coalesce. */
const BATCH_WINDOW_MS = 50;

/** A per-relay batch collecting scopes until the auth gate opens. */
interface RelayBatch {
  scopes: PlaneScope[];
  closed: boolean;
  promise: Promise<Map<string, OpenedEvent[]>>;
}
const batches = new Map<string, RelayBatch>();

/** Build and register a fresh batch; its promise resolves after the auth gate. */
function newBatch(nostr: NostrLike, url: string): RelayBatch {
  const b: RelayBatch = { scopes: [], closed: false, promise: Promise.resolve(new Map()) };
  b.promise = (async () => {
    // The whole batch lifetime — enrollment window, NIP-42 auth gate, the REQ
    // itself — counts as sync activity (the auth hold alone can be seconds).
    const task = beginSyncTask("community updates");
    try {
      await new Promise((r) => setTimeout(r, BATCH_WINDOW_MS));
      await whenAuthReady(url, () => b.scopes.flatMap((s) => s.groups));
      b.closed = true;
      if (batches.get(url) === b) batches.delete(url);
      return await runScopes(nostr, url, b.scopes);
    } finally {
      task.end();
    }
  })();
  batches.set(url, b);
  return b;
}

/** Enroll one scope into the relay's open batch (creating one if needed). */
function enqueue(nostr: NostrLike, url: string, scope: PlaneScope): Promise<OpenedEvent[]> {
  const batch = batches.get(url);
  const b = batch && !batch.closed ? batch : newBatch(nostr, url);
  b.scopes.push(scope);
  const one = b.promise.then((m) => m.get(scope.scope) ?? []);
  inflight.set(scope.scope, one);
  void one.finally(() => {
    if (inflight.get(scope.scope) === one) inflight.delete(scope.scope);
  });
  return one;
}

/**
 * Sweep a set of scopes on ONE relay. Scopes already in flight (any caller)
 * are JOINED, not re-fetched — the joiner still gets the scope's fresh events
 * and its own `onFresh`. New scopes enroll in the relay's open batch behind
 * the auth gate and leave as one REQ (see module docstring).
 */
export async function sweepRelayScopes(
  nostr: NostrLike,
  url: string,
  scopes: PlaneScope[],
): Promise<Map<string, OpenedEvent[]>> {
  const results = scopes.map((s) => {
    const existing = inflight.get(s.scope);
    if (existing) {
      return existing.then((fresh) => {
        if (fresh.length > 0) s.onFresh?.(fresh);
        return [s.scope, fresh] as const;
      });
    }
    return enqueue(nostr, url, s).then((fresh) => [s.scope, fresh] as const);
  });
  return new Map(await Promise.all(results));
}

/** Sweep one community's plane across its relays; union deduped by rumor id. */
async function sweepCommunityPlane(
  nostr: NostrLike,
  community: CommunityV2,
  scopeOf: typeof controlScope,
  opts?: { onFresh?: (fresh: OpenedEvent[]) => void },
): Promise<OpenedEvent[]> {
  const results = await Promise.all(
    community.relays.map((url) => sweepRelayScopes(nostr, url, [scopeOf(community, url, opts?.onFresh)])),
  );
  return mergeOpened(...results.map((m) => [...m.values()].flat()));
}

/** Sweep one community's Control Plane (editions across held epochs). */
export function sweepControl(
  nostr: NostrLike,
  community: CommunityV2,
  opts?: { onFresh?: (fresh: OpenedEvent[]) => void },
): Promise<OpenedEvent[]> {
  return sweepCommunityPlane(nostr, community, controlScope, opts);
}

/** Sweep one community's Guestbook Plane (membership motions). */
export function sweepGuestbook(
  nostr: NostrLike,
  community: CommunityV2,
  opts?: { onFresh?: (fresh: OpenedEvent[]) => void },
): Promise<OpenedEvent[]> {
  return sweepCommunityPlane(nostr, community, guestbookScope, opts);
}
