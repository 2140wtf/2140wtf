/**
 * Concord V2 per-thread read state.
 *
 * The "@ Threads" tab surfaces threads the user has participated in (authored
 * the root or a reply) and lights up those with replies newer than the user
 * has seen. Channel read state ({@link readState2}) is too coarse for this —
 * reading a channel would silence every thread in it — so threads get their
 * own last-seen map, keyed by the thread ROOT rumor id.
 *
 * We track, per (user, thread-root), the unix-SECONDS `created_at` of the
 * newest reply the user has seen (advanced when they open the thread panel).
 * Stored in the same device-local Concord KV cache the folded caches use (via
 * {@link foldedCache}), keyed per user so switching accounts stays separate.
 * Purely local: thread-unread is derived from the local rumor cache, so this
 * only needs to be a timestamp per thread.
 */

import { readFolded, writeFolded } from "@/lib/foldedCache";

/** A per-thread last-read map: thread-root rumor id → newest-seen unix SECONDS. */
export type Concord2ThreadReadMap = Record<string, number>;

/** KV key for one user's V2 thread read state. */
function threadReadStateKey(userPubkey: string): string {
  return `concord2-thread-read:${userPubkey}`;
}

/** Load the whole per-user thread read map (empty on miss / no IndexedDB). */
export async function loadConcord2ThreadReadState(
  userPubkey: string,
): Promise<Concord2ThreadReadMap> {
  const map = await readFolded<Concord2ThreadReadMap>(threadReadStateKey(userPubkey));
  return map ?? {};
}

/**
 * Mark a thread read up to `timestamp` (unix SECONDS). Monotonic: never rewinds
 * a thread to an older stamp. Returns the updated map (the same reference if
 * nothing changed) so callers can update in-memory state without a re-read.
 */
export async function markConcord2ThreadRead(
  userPubkey: string,
  rootId: string,
  timestamp: number,
): Promise<Concord2ThreadReadMap> {
  const map = await loadConcord2ThreadReadState(userPubkey);
  if ((map[rootId] ?? 0) >= timestamp) return map;
  const next = { ...map, [rootId]: timestamp };
  await writeFolded(threadReadStateKey(userPubkey), next);
  return next;
}

/**
 * Mark many threads read in one write — the "mark all as read" batch (issue
 * #53). Each `[rootId, timestamp]` is applied monotonically (never rewinds a
 * thread to an older stamp); one KV write instead of N debounced ones. Returns
 * the updated map (same reference if nothing advanced).
 */
export async function markConcord2ThreadsRead(
  userPubkey: string,
  entries: Iterable<readonly [string, number]>,
): Promise<Concord2ThreadReadMap> {
  const map = await loadConcord2ThreadReadState(userPubkey);
  let next: Concord2ThreadReadMap | undefined;
  for (const [rootId, timestamp] of entries) {
    if (timestamp <= 0 || (map[rootId] ?? 0) >= timestamp) continue;
    next ??= { ...map };
    next[rootId] = timestamp;
  }
  if (!next) return map;
  await writeFolded(threadReadStateKey(userPubkey), next);
  return next;
}
