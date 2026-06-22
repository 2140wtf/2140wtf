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
  createStorageTags,
  type StorageItem,
} from './pets';

export type PublishEventFn = (template: EventTemplate) => Promise<NostrEvent>;

export interface AddProfileSatsResult {
  event: NostrEvent;
  prevSats: number;
  newSats: number;
}

export interface ConsumeStorageItemResult {
  event: NostrEvent;
  prevStorage: StorageItem[];
  newStorage: StorageItem[];
  consumed: boolean;
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

/**
 * Consume one unit of `itemId` from the user's storage.
 *
 * - Fetches the latest kind 11125 event from the BAO pets relay.
 * - Returns `consumed: false` if the item is not in storage or quantity is 0.
 * - Publishes the updated storage tags.
 */
export async function consumeStorageItem(
  nostr: NPool,
  publishEvent: PublishEventFn,
  pubkey: string,
  itemId: string,
): Promise<ConsumeStorageItemResult> {
  const prev = await fetchFreshPetsEvent(nostr, {
    kinds: [KIND_BLOBBONAUT_PROFILE],
    authors: [pubkey],
  });

  const profile = prev ? parseBlobbonautEvent(prev) : undefined;
  const prevStorage = profile?.storage ?? [];
  const existingIndex = prevStorage.findIndex((s) => s.itemId === itemId);

  if (existingIndex < 0 || prevStorage[existingIndex].quantity <= 0) {
    return { event: prev ?? profile?.event ?? ({} as NostrEvent), prevStorage, newStorage: prevStorage, consumed: false };
  }

  const newStorage = prevStorage.map((s, i) =>
    i === existingIndex ? { ...s, quantity: s.quantity - 1 } : s,
  ).filter((s) => s.quantity > 0);

  const storageValues = createStorageTags(newStorage).map((tag) => tag[1]);
  const tags = updateBlobbonautTags(prev?.tags ?? [], {
    storage: storageValues,
  });

  const event = await publishEvent({
    kind: KIND_BLOBBONAUT_PROFILE,
    content: prev?.content ?? profile?.content ?? '',
    tags,
    prev: prev ?? undefined,
  });

  return { event, prevStorage, newStorage, consumed: true };
}
