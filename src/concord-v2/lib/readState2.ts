/**
 * Concord V2 per-channel read state.
 *
 * We track, per (user, community, channel), the unix-SECONDS `created_at` of
 * the newest message the user has seen. This lives in the shared Concord
 * IndexedDB KV cache (`armada-concord-cache`, via {@link foldedCache}) — the
 * same device-local store the folded community/roster caches use — NOT in the
 * NIP-29 localStorage read-state map. V2 unread is computed purely from what's
 * already in the local rumor cache (see `useConcord2Unread`): no relay query is
 * made just to light a badge, so the read state only needs to be a local
 * timestamp per channel.
 *
 * Keyed per user so switching accounts on one device keeps read state separate.
 */

import { readFolded, writeFolded } from "@/lib/foldedCache";

/** A per-channel last-read map: channelIdHex → newest-seen unix SECONDS. */
export type Concord2ReadMap = Record<string, number>;

/** KV key for one user's V2 read state. */
function readStateKey(userPubkey: string): string {
  return `concord2-read:${userPubkey}`;
}

/** Load the whole per-user read map (empty on miss / no IndexedDB). */
export async function loadConcord2ReadState(userPubkey: string): Promise<Concord2ReadMap> {
  const map = await readFolded<Concord2ReadMap>(readStateKey(userPubkey));
  return map ?? {};
}

/**
 * Mark a channel read up to `timestamp` (unix SECONDS). Monotonic: never rewinds
 * a channel to an older stamp. Returns the updated map (the same reference if
 * nothing changed) so callers can update in-memory state without a re-read.
 */
export async function markConcord2Read(
  userPubkey: string,
  channelIdHex: string,
  timestamp: number,
): Promise<Concord2ReadMap> {
  const map = await loadConcord2ReadState(userPubkey);
  if ((map[channelIdHex] ?? 0) >= timestamp) return map;
  const next = { ...map, [channelIdHex]: timestamp };
  await writeFolded(readStateKey(userPubkey), next);
  return next;
}
