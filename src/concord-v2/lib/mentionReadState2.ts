/**
 * Concord V2 mentions read state.
 *
 * The "@ Mentions" tab surfaces every cached message that p-tags the user
 * across all of a community's channels, as one flat newest-first list. Channel
 * read state ({@link readState2}) is the wrong granularity for it — a mention
 * only cleared once you opened the *channel* it came from, so mentions in busy
 * or muted channels lingered — so mentions get their own last-seen stamp,
 * independent of channel read state.
 *
 * Because the tab is a single flat list (not per-channel rows), one scalar per
 * (user, community) is enough: the unix-SECONDS `created_at` of the newest
 * mention the user has seen. A mention is "new" when it's newer than that
 * stamp; "mark all read" advances the stamp to the newest mention. Stored in
 * the same device-local Concord KV cache the folded caches use (via
 * {@link foldedCache}), keyed per user + community so accounts/communities stay
 * separate. Purely local, like the other V2 read state.
 */

import { readFolded, writeFolded } from "@/lib/foldedCache";

/** KV key for one user's V2 mentions last-seen stamp in one community. */
function mentionReadStateKey(userPubkey: string, communityIdHex: string): string {
  return `concord2-mention-read:${userPubkey}:${communityIdHex}`;
}

/** Load the mentions last-seen stamp (unix SECONDS; 0 on miss / no IndexedDB). */
export async function loadConcord2MentionReadState(
  userPubkey: string,
  communityIdHex: string,
): Promise<number> {
  const at = await readFolded<number>(mentionReadStateKey(userPubkey, communityIdHex));
  return at ?? 0;
}

/**
 * Mark mentions read up to `timestamp` (unix SECONDS). Monotonic: never rewinds
 * to an older stamp. Returns the effective stamp (unchanged if `timestamp` was
 * older) so callers can update in-memory state without a re-read.
 */
export async function markConcord2MentionsRead(
  userPubkey: string,
  communityIdHex: string,
  timestamp: number,
): Promise<number> {
  const at = await loadConcord2MentionReadState(userPubkey, communityIdHex);
  if (at >= timestamp) return at;
  await writeFolded(mentionReadStateKey(userPubkey, communityIdHex), timestamp);
  return timestamp;
}
