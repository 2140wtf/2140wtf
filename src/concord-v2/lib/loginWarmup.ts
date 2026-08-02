/**
 * Post-login Concord V2 warm-up — the work that makes a fresh device's
 * communities REAL before the SyncGate lifts (the Signal pattern: never drop
 * the user into a wall of empty rooms).
 *
 * Fetching the Community List alone (what the gate used to do) yields rail
 * icons but hollow communities: channels come from the control plane and
 * messages from per-channel backfills that previously only ran once you
 * navigated into a room. This module runs that catch-up eagerly, in order:
 *
 *   1. rehydrate each live membership entry into a runtime community;
 *   2. sweep every community's control + guestbook planes through its own
 *      stream-only relay sessions;
 *   3. fold the control plane and PERSIST the fold snapshot, so channel lists
 *      and community names paint instantly when the app shows through;
 *   4. pull + decrypt the newest page of every channel into the rumor store,
 *      reporting per-channel progress to the caller (the gate's x/y line) and
 *      on the sync-activity signal (the in-chat bar takes over if the gate's
 *      time budget expires before the warm-up finishes).
 *
 * Everything is best-effort: a dead relay or an undecryptable channel skips,
 * never throws. The normal runtime paths (plane sweeps, channel backfills)
 * re-cover anything missed here — cursors only advance on their reads.
 */

import { channelsView } from "@/concord-v2/lib/community";
import { rehydrateCommunity, type CommunityListEntry } from "@/concord-v2/lib/communityList";
import { controlGroups, foldControlState, openControlEditions } from "@/concord-v2/lib/control";
import { guestbookGroups } from "@/concord-v2/lib/guestbook";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";
import { openChatBatch } from "@/concord-v2/lib/chat";
import { sweepControl, sweepGuestbook } from "@/concord-v2/lib/planeSync";
import { queryByStreams, writeRumors } from "@/concord-v2/lib/rumorStore";
import { ConcordTransport, concordTransport, type ConcordCapability } from "@/concord-v2/lib/concordTransport";
import type { GroupKey } from "@/concord-v2/lib/derive";
import { controlFoldKey } from "@/concord-v2/hooks/useControlPlane2";
import { writeFolded } from "@/lib/foldedCache";
import { beginSyncTask } from "@/lib/syncActivity";
import { logSync } from "@/lib/syncLog";
import { emitWireScopes } from "@/wire/bus";

import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";
import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

/** Minimal relay-capable Nostr client the warm-up needs (batcher-backed). */
interface NostrLike {
  _concordScope: string;
  _concordKeySig: string;
  relay(url: string): {
    query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
  };
}

type WarmupTransport = Pick<ConcordTransport, "capability" | "generation">;

/** Bind the narrow plane/backfill client to exactly one community. */
function scopedClient(capability: ConcordCapability, keys: readonly GroupKey[]): NostrLike {
  return capability.client(keys);
}

/**
 * Safety bound on channels decrypted at login, NOT a working limit. Channel
 * pulls are batched (one REQ per relay covering many channels), so warming a
 * whole membership is cheap — this only stops a pathological list from
 * spending the login on decrypt work. Anything past it heals via the normal
 * on-open backfill.
 */
const MAX_WARMUP_CHANNELS = 200;
/**
 * Channel filters per batched REQ. Relays commonly cap filters-per-REQ
 * around 10-20; chunking keeps each REQ well under that while still
 * collapsing a whole community's channels into a couple of round-trips.
 */
const FILTERS_PER_REQ = 10;
/** Newest-page size per channel per relay (mirrors the channel backfill page). */
const WARMUP_PAGE = 50;
/** Per-REQ network budget. */
const CHANNEL_TIMEOUT_MS = 8_000;

export interface WarmupResult {
  /** Communities rehydrated and swept. */
  communities: number;
  /** Channels whose newest page was pulled. */
  channels: number;
  /** Rumors decrypted into the store across all channels. */
  messages: number;
}

/**
 * Warm every live community for a freshly logged-in device. Reports
 * per-channel progress via `onProgress(done, total)`. Best-effort throughout;
 * respects `signal` for the channel pulls (plane sweeps share one batched REQ
 * per relay and run to completion on their own budget).
 */
export async function warmupCommunities2(
  entries: CommunityListEntry[],
  opts: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    /** Injectable transport keeps the warm-up deterministic in unit tests. */
    transport?: WarmupTransport;
  } = {},
): Promise<WarmupResult> {
  const transport = opts.transport ?? concordTransport;
  const communities: CommunityV2[] = [];
  for (const entry of entries) {
    const community = rehydrateCommunity(entry);
    if (community && community.relays.length > 0) communities.push(community);
  }
  const result: WarmupResult = { communities: communities.length, channels: 0, messages: 0 };
  if (communities.length === 0) return result;

  // Account-switch guard: resetAccount closes every old session and advances
  // this generation. Async work from the previous account must never create
  // or widen a session after that boundary.
  const generation = transport.generation();
  const capabilities = new Map(communities.map((community) => [
    community.idHex,
    transport.capability(community.idHex),
  ]));

  // Report on the sync-activity signal too: if the gate's time budget expires
  // before the warm-up finishes, the in-chat status bar carries the rest.
  const task = beginSyncTask("message history");
  try {
    // ── Plane sweeps, isolated by community + relay ────────────────────────
    await Promise.all(
      communities.flatMap((c) => [
        sweepControl(scopedClient(capabilities.get(c.idHex)!, controlGroups(c)), c).catch(() => []),
        sweepGuestbook(scopedClient(capabilities.get(c.idHex)!, guestbookGroups(c)), c).catch(() => []),
      ]),
    );
    if (transport.generation() !== generation) return result;

    // ── Fold + persist snapshots; derive readable channels ──────────────────
    const jobs = new Map<CommunityV2, ChannelV2[]>();
    let totalChannels = 0;
    for (const c of communities) {
      try {
        if (transport.generation() !== generation) return result;
        const stored = await queryByStreams(controlGroups(c).map((g) => g.pk));
        if (transport.generation() !== generation) return result;
        const folded = foldControlState(openControlEditions(stored), c.id, c.owner);
        await writeFolded(controlFoldKey(c.idHex), folded);
        if (transport.generation() !== generation) return result;
        emitWireScopes([`c2ctl:${c.idHex}`]);
        for (const channel of channelsView(c, folded)) {
          if (channel.streams.length === 0) continue;
          if (totalChannels >= MAX_WARMUP_CHANNELS) break;
          if (transport.generation() !== generation) return result;
          const list = jobs.get(c) ?? [];
          list.push(channel);
          jobs.set(c, list);
          totalChannels++;
        }
      } catch (err) {
        logSync("gate", `warmup fold ${c.idHex.slice(0, 8)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── Newest page per channel, BATCHED: one REQ per relay per chunk ───────
    // One filter per channel (its own `authors` + `limit`, NIP-01 per-filter
    // semantics), chunked so a big community is a couple of round-trips per
    // relay instead of one REQ per channel — which is why warming the whole
    // membership doesn't need a tight cap. Results demux by wrap author
    // (every channel's stream addresses are distinct).
    result.channels = totalChannels;
    let done = 0;
    opts.onProgress?.(0, totalChannels);
    const chunkJobs: Array<Promise<void>> = [];
    for (const [community, channels] of jobs) {
      for (let i = 0; i < channels.length; i += FILTERS_PER_REQ) {
        const chunk = channels.slice(i, i + FILTERS_PER_REQ);
        chunkJobs.push(
          (async () => {
            const groupsOf = () => chunk.flatMap((ch) => ch.streams.map((s) => s.group));
            if (transport.generation() !== generation) return;
            const client = scopedClient(capabilities.get(community.idHex)!, groupsOf());
            const filters: NostrFilter[] = chunk.map((ch) => ({
              kinds: [KIND_WRAP],
              authors: ch.streams.map((s) => s.group.pk),
              limit: WARMUP_PAGE,
            }));
            /**
             * Pull one relay's pages for this chunk. NRelay1 handles the
             * stream-only AUTH challenge inside the isolated session. A lazy
             * challenge can still close the first REQ before all stream AUTH
             * frames settle, so an empty/failing first attempt is re-issued
             * with a fresh subscription after a short hold.
             */
            const pull = async (url: string): Promise<NostrEvent[]> => {
              for (let attempt = 1; attempt <= 2; attempt++) {
                if (transport.generation() !== generation) return [];
                try {
                  const events = await client.relay(url).query(filters, {
                    signal: AbortSignal.any([
                      ...(opts.signal ? [opts.signal] : []),
                      AbortSignal.timeout(CHANNEL_TIMEOUT_MS),
                    ]),
                  });
                  if (events.length > 0 || attempt === 2) return events;
                } catch {
                  if (attempt === 2) return [];
                }
                await new Promise((r) => setTimeout(r, 250));
              }
              return [];
            };
            try {
              const wraps = (await Promise.all(community.relays.map(pull))).flat();
              if (transport.generation() !== generation) return;
              // Demux by wrap author (each channel decrypts only its own),
              // deduped across relays by wrap id.
              const channelByPk = new Map<string, ChannelV2>();
              for (const ch of chunk) for (const s of ch.streams) channelByPk.set(s.group.pk, ch);
              const seen = new Set<string>();
              const byChannel = new Map<ChannelV2, NostrEvent[]>();
              for (const wrap of wraps) {
                if (seen.has(wrap.id)) continue;
                seen.add(wrap.id);
                const ch = channelByPk.get(wrap.pubkey);
                if (!ch) continue;
                const list = byChannel.get(ch) ?? [];
                list.push(wrap);
                byChannel.set(ch, list);
              }
              for (const [ch, chWraps] of byChannel) {
                if (transport.generation() !== generation) return;
                const opened = await openChatBatch(chWraps, ch);
                if (transport.generation() !== generation) return;
                if (opened.length > 0) {
                  // writeRumors rings `c2:<channel>` on the wire bus once committed.
                  writeRumors(opened);
                  result.messages += opened.length;
                }
              }
            } catch {
              // Best-effort per chunk — the rooms backfill on open.
            } finally {
              if (transport.generation() === generation) {
                done += chunk.length;
                opts.onProgress?.(done, totalChannels);
                task.update({ detail: `${done}/${totalChannels} channels` });
              }
            }
          })(),
        );
      }
    }
    await Promise.all(chunkJobs);
    logSync(
      "gate",
      `v2 warmup: ${result.communities} community(ies), ${result.channels} channel(s), ${result.messages} rumor(s) decrypted`,
    );
    return result;
  } finally {
    task.end();
  }
}
