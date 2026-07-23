/**
 * Profile sats helpers.
 *
 * Provides a small, reusable read-modify-write helper for adding demo (or
 * real) sats to a Nostr pet profile (kind 11125). It always fetches the
 * freshest profile from the user's configured relays before updating so concurrent
 * sats changes (missions, actions, poop cleanup, etc.) do not overwrite each
 * other.
 */

import type { NostrEvent, NPool } from '@nostrify/nostrify';

import type { EventTemplate } from '@/hooks/useNostrPublish';
import { fetchFreshPetsEvent } from './fetchFreshPetsEvent';
import {
  KIND_NOSTR_PET_PROFILE,
  parseNostrPetProfileEvent,
  updateNostrPetProfileTags,
  createStorageTags,
  getNostrPetProfileQueryDValues,
  getCanonicalNostrPetProfileD,
  type StorageItem,
  type NostrPetProfile,
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

/** Default tags for a brand-new Nostr pet profile when no prior event exists. */
function createDefaultProfileTags(pubkey: string): string[][] {
  return [
    ['d', getCanonicalNostrPetProfileD(pubkey)],
    ['b', 'pets:ecosystem:v1'],
  ];
}

export type ProfileUpdateFn = (
  profile: NostrPetProfile | undefined,
  prevTags: string[][],
  prevContent: string,
) =>
  | { tags?: string[][]; content?: string; meta?: Record<string, unknown> }
  | null
  | Promise<{ tags?: string[][]; content?: string; meta?: Record<string, unknown> } | null>;

export interface UpdateNostrPetProfileResult {
  event: NostrEvent;
  profile: NostrPetProfile | undefined;
  meta?: Record<string, unknown>;
}

/**
 * Fetch the freshest kind 11125 profile and apply a serialized update.
 *
 * All callers that read the profile, compute a delta, and publish an update
 * should go through this helper. It serializes per pubkey so concurrent
 * updates (shop purchases, mission rewards, poop cleanup, etc.) cannot
 * overwrite each other and double-spend in-game currency.
 */
export async function updateNostrPetProfile(
  nostr: NPool,
  publishEvent: PublishEventFn,
  pubkey: string,
  update: ProfileUpdateFn,
): Promise<UpdateNostrPetProfileResult | null> {
  return runSerialized(pubkey, async () => {
    const prev = await fetchFreshPetsEvent(nostr, {
      kinds: [KIND_NOSTR_PET_PROFILE],
      authors: [pubkey],
      '#d': getNostrPetProfileQueryDValues(pubkey),
    });

    const profile = prev ? parseNostrPetProfileEvent(prev) : undefined;
    const updateResult = await update(profile, prev?.tags ?? createDefaultProfileTags(pubkey), prev?.content ?? '');
    if (!updateResult) return null;

    const tags = updateResult.tags ?? prev?.tags ?? createDefaultProfileTags(pubkey);
    const content = updateResult.content ?? prev?.content ?? '';

    const event = await publishEvent({
      kind: KIND_NOSTR_PET_PROFILE,
      content,
      tags,
      prev: prev ?? undefined,
    });

    return { event, profile, meta: updateResult.meta };
  });
}

// Serialize all profile-sats mutations per pubkey so concurrent read-modify-write
// operations do not overwrite each other (e.g. two actions rewarding sats at the
// same time, or a purchase and a consume running in parallel).
const profileUpdateQueue = new Map<string, Promise<unknown>>();

function runSerialized<T>(pubkey: string, operation: () => Promise<T>): Promise<T> {
  const pending = profileUpdateQueue.get(pubkey) ?? Promise.resolve();
  const next = pending.then(
    () => operation(),
    () => operation(),
  );
  // Keep the queue moving even if an individual operation fails, then remove
  // the entry once the chain settles so the Map does not grow without bound.
  const stored = next.catch(() => undefined).finally(() => {
    if (profileUpdateQueue.get(pubkey) === stored) {
      profileUpdateQueue.delete(pubkey);
    }
  });
  profileUpdateQueue.set(pubkey, stored);
  return next;
}

/**
 * Add `delta` sats to the logged-in user's Nostr pet profile.
 *
 * - Fetches the latest kind 11125 event from the user's configured relays.
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
  return runSerialized(pubkey, async () => {
    const prev = await fetchFreshPetsEvent(nostr, {
      kinds: [KIND_NOSTR_PET_PROFILE],
      authors: [pubkey],
      '#d': getNostrPetProfileQueryDValues(pubkey),
    });

    const profile = prev ? parseNostrPetProfileEvent(prev) : undefined;
    const prevSats = profile?.sats ?? 0;
    const newSats = Math.max(0, prevSats + delta);

    const tags = updateNostrPetProfileTags(prev?.tags ?? createDefaultProfileTags(pubkey), {
      sats: newSats.toString(),
    });

    const event = await publishEvent({
      kind: KIND_NOSTR_PET_PROFILE,
      content: prev?.content ?? profile?.content ?? '',
      tags,
      prev: prev ?? undefined,
    });

    return { event, prevSats, newSats };
  });
}

/**
 * Consume one unit of `itemId` from the user's storage.
 *
 * - Fetches the latest kind 11125 event from the user's configured relays.
 * - Returns `consumed: false` if the item is not in storage or quantity is 0.
 * - Publishes the updated storage tags.
 */
export async function consumeStorageItem(
  nostr: NPool,
  publishEvent: PublishEventFn,
  pubkey: string,
  itemId: string,
): Promise<ConsumeStorageItemResult> {
  return runSerialized(pubkey, async () => {
    const prev = await fetchFreshPetsEvent(nostr, {
      kinds: [KIND_NOSTR_PET_PROFILE],
      authors: [pubkey],
      '#d': getNostrPetProfileQueryDValues(pubkey),
    });

    const profile = prev ? parseNostrPetProfileEvent(prev) : undefined;
    const prevStorage = profile?.storage ?? [];
    const existingIndex = prevStorage.findIndex((s) => s.itemId === itemId);

    if (existingIndex < 0 || prevStorage[existingIndex].quantity <= 0) {
      return { event: prev ?? profile?.event ?? ({} as NostrEvent), prevStorage, newStorage: prevStorage, consumed: false };
    }

    const newStorage = prevStorage.map((s, i) =>
      i === existingIndex ? { ...s, quantity: s.quantity - 1 } : s,
    ).filter((s) => s.quantity > 0);

    const storageValues = createStorageTags(newStorage).map((tag) => tag[1]);
    const tags = updateNostrPetProfileTags(prev?.tags ?? createDefaultProfileTags(pubkey), {
      storage: storageValues,
    });

    const event = await publishEvent({
      kind: KIND_NOSTR_PET_PROFILE,
      content: prev?.content ?? profile?.content ?? '',
      tags,
      prev: prev ?? undefined,
    });

    return { event, prevStorage, newStorage, consumed: true };
  });
}

/**
 * Restore one unit of an item to the user's storage.
 *
 * Used as a compensating action when a pet-state publish fails after storage
 * was already decremented, so the item is not permanently lost.
 */
export async function restoreStorageItem(
  nostr: NPool,
  publishEvent: PublishEventFn,
  pubkey: string,
  itemId: string,
): Promise<ConsumeStorageItemResult> {
  return runSerialized(pubkey, async () => {
    const prev = await fetchFreshPetsEvent(nostr, {
      kinds: [KIND_NOSTR_PET_PROFILE],
      authors: [pubkey],
      '#d': getNostrPetProfileQueryDValues(pubkey),
    });

    const profile = prev ? parseNostrPetProfileEvent(prev) : undefined;
    const prevStorage = profile?.storage ?? [];
    const existingIndex = prevStorage.findIndex((s) => s.itemId === itemId);

    let newStorage: StorageItem[];
    if (existingIndex >= 0) {
      newStorage = prevStorage.map((s, i) =>
        i === existingIndex ? { ...s, quantity: s.quantity + 1 } : s,
      );
    } else {
      newStorage = [...prevStorage, { itemId, quantity: 1 }];
    }

    const storageValues = createStorageTags(newStorage).map((tag) => tag[1]);
    const tags = updateNostrPetProfileTags(prev?.tags ?? createDefaultProfileTags(pubkey), {
      storage: storageValues,
    });

    const event = await publishEvent({
      kind: KIND_NOSTR_PET_PROFILE,
      content: prev?.content ?? profile?.content ?? '',
      tags,
      prev: prev ?? undefined,
    });

    return { event, prevStorage, newStorage, consumed: true };
  });
}
