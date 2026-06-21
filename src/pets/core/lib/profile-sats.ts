/**
 * Profile sats helpers.
 *
 * Provides a small, reusable read-modify-write helper for adding demo (or
 * real) sats to a Blobbonaut profile (kind 11125). It always fetches the
 * freshest profile from the BAO pets relay before updating so concurrent
 * sats changes (missions, actions, poop cleanup, etc.) do not overwrite each
 * other.
 */

import type { NostrEvent, NPool } from '@nostrify/nostrify';

import type { EventTemplate } from '@/hooks/useNostrPublish';
import { fetchFreshPetsEvent } from './fetchFreshPetsEvent';
import {
  KIND_BLOBBONAUT_PROFILE,
  parseBlobbonautEvent,
  updateBlobbonautTags,
} from './pets';

export type PublishEventFn = (template: EventTemplate) => Promise<NostrEvent>;

export interface AddProfileSatsResult {
  event: NostrEvent;
  prevSats: number;
  newSats: number;
}

/**
 * Add `delta` sats to the logged-in user's Blobbonaut profile.
 *
 * - Fetches the latest kind 11125 event from the BAO pets relay.
 * - Falls back to `0` if the profile does not exist yet (actions that require
 *   a profile should validate that before calling this).
 * - Publishes the updated event with only the `sats` tag changed.
 *
 * @returns The published event plus the previous/new sats balances.
 */
export async function addProfileSats(
  nostr: NPool,
  publishEvent: PublishEventFn,
  pubkey: string,
  delta: number,
): Promise<AddProfileSatsResult> {
  const prev = await fetchFreshPetsEvent(nostr, {
    kinds: [KIND_BLOBBONAUT_PROFILE],
    authors: [pubkey],
  });

  const profile = prev ? parseBlobbonautEvent(prev) : undefined;
  const prevSats = profile?.sats ?? 0;
  const newSats = Math.max(0, prevSats + delta);

  const tags = updateBlobbonautTags(prev?.tags ?? [], {
    sats: newSats.toString(),
  });

  const event = await publishEvent({
    kind: KIND_BLOBBONAUT_PROFILE,
    content: prev?.content ?? profile?.content ?? '',
    tags,
    prev: prev ?? undefined,
  });

  return { event, prevSats, newSats };
}
