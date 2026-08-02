import type { NostrEvent } from '@nostrify/nostrify';

/** Apply NIP-01 ordering for two versions of one replaceable coordinate. */
export function shouldReplaceNostrEvent(
  current: Pick<NostrEvent, 'id' | 'created_at'>,
  candidate: Pick<NostrEvent, 'id' | 'created_at'>,
): boolean {
  return candidate.created_at > current.created_at
    || (candidate.created_at === current.created_at && candidate.id < current.id);
}
