import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
import type { NPool } from '@nostrify/nostrify';

import {
  NOSTR_PET_PROFILE_KINDS,
  KIND_NOSTR_PET_PROFILE,
  getNostrPetProfileQueryDValues,
  isValidNostrPetProfileEvent,
  isLegacyNostrPetProfileKind,
  parseNostrPetProfileEvent,
  type NostrPetProfile,
} from './pets';

/**
 * Fetch the freshest Nostr pet profile (kind 11125) directly from relays,
 * bypassing any local TanStack Query cache.
 *
 * Prefers the current kind (11125) over legacy (31125). Returns a fully-parsed
 * `NostrPetProfile` including `.event` (the raw NostrEvent) so callers can
 * pass it as `prev` to `useNostrPublish`.
 *
 * Use this inside every mutation that performs a read-modify-write on the
 * Nostr pet profile to avoid overwriting content (daily missions JSON) or
 * tags with stale cached data.
 */
export async function fetchFreshNostrPetProfile(
  nostr: NPool,
  pubkey: string,
): Promise<NostrPetProfile | null> {
  const dValues = getNostrPetProfileQueryDValues(pubkey);

  const signal = AbortSignal.timeout(10_000);

  const events = await queryPetsRelay(nostr, [{
    kinds: [...NOSTR_PET_PROFILE_KINDS],
    authors: [pubkey],
    '#d': dValues,
  }], { signal });

  const validEvents = events.filter(isValidNostrPetProfileEvent);
  if (validEvents.length === 0) return null;

  // Prefer current kind over legacy
  const currentKindEvents = validEvents.filter(e => e.kind === KIND_NOSTR_PET_PROFILE);
  if (currentKindEvents.length > 0) {
    const sorted = currentKindEvents.sort((a, b) => b.created_at - a.created_at);
    return parseNostrPetProfileEvent(sorted[0]) ?? null;
  }

  const legacyKindEvents = validEvents.filter(e => isLegacyNostrPetProfileKind(e));
  if (legacyKindEvents.length > 0) {
    const sorted = legacyKindEvents.sort((a, b) => b.created_at - a.created_at);
    return parseNostrPetProfileEvent(sorted[0]) ?? null;
  }

  return null;
}
