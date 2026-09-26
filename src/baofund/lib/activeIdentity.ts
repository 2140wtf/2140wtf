/**
 * activeIdentity - the ONE identity whose local wallet/room storage this
 * browser session may read or write.
 *
 * Several storage modules used to share origin-global localStorage slots
 * (wallet proofs, top-up quotes, tx history, NIP-61 claim markers, room
 * links). On a shared browser a later identity then read - and even
 * republished - the previous identity's money and private room handles
 * (audit run-2: global-cashu-wallet-cross-identity, nip61-claimed-global,
 * topup-history-global, rooms-storage-global).
 *
 * `useAuth` is the single writer: it calls `setActiveIdentity(pubkey)` on
 * every successful login/restore and `setActiveIdentity(null)` on logout.
 * Storage modules read `getActiveIdentity()` and scope their keys, so an
 * identity can never observe another identity's slot. Guests get their own
 * per-browser scope in the room store - never a signed-in identity's.
 *
 * One-time migration: the first signed-in identity bound after the upgrade
 * ADOPTS the legacy global entries (`adoptLegacyStorageKey`), then the
 * legacy keys are removed. The data therefore survives for the identity that
 * was ACTIVE when the isolation shipped, and no other identity can see it.
 */

/** Identity pubkeys are 64-hex; anything else is not an identity. */
export const IDENTITY_HEX = /^[0-9a-f]{64}$/i;

type IdentityListener = (identity: string | null) => void;

let activeIdentity: string | null = null;
const listeners = new Set<IdentityListener>();

/** Normalize a candidate pubkey to lowercase 64-hex, or null. */
export function normalizeIdentity(pubkey: unknown): string | null {
  return typeof pubkey === 'string' && IDENTITY_HEX.test(pubkey) ? pubkey.toLowerCase() : null;
}

/** The active identity pubkey (lowercase 64-hex), or null when signed out. */
export function getActiveIdentity(): string | null {
  return activeIdentity;
}

/** Set (or clear) the active identity and notify storage modules. */
export function setActiveIdentity(pubkey: unknown): void {
  const next = normalizeIdentity(pubkey);
  if (next === activeIdentity) return;
  activeIdentity = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      /* a broken listener must never break the identity change */
    }
  }
}

/** Subscribe to identity changes (storage modules migrate + refresh here). */
export function onActiveIdentityChange(listener: IdentityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `base:identity` - the per-identity slot for a formerly global key. */
export function scopedStorageKey(base: string, identity: string): string {
  return `${base}:${identity.toLowerCase()}`;
}

/**
 * One-time migration of a legacy origin-global entry into `identity`'s
 * scoped slot: copy when the scoped slot is still empty, then remove the
 * legacy key. Never overwrites a scoped slot (a second identity binding must
 * not be handed data it did not own).
 */
export function adoptLegacyStorageKey(
  base: string,
  identity: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
): void {
  const scoped = scopedStorageKey(base, identity);
  try {
    const legacy = storage.getItem(base);
    if (legacy === null) return;
    if (storage.getItem(scoped) === null) storage.setItem(scoped, legacy);
    storage.removeItem(base);
  } catch {
    /* storage unavailable: no migration, and nothing is destroyed */
  }
}
