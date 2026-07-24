import { closeInviteInbox } from "@/concord-v2/lib/inviteInbox";
import { closeRumorStores } from "@/concord-v2/lib/rumorStore";
import { closeFoldedCache } from "@/lib/foldedCache";
import { resetDecryptConsent } from "@/lib/decryptConsent";

/**
 * Purge the decrypted-at-rest ₿AO chat (Concord V2) stores on final logout.
 *
 * The Concord caches hold DECRYPTED content and secret key material at rest —
 * channel rumors (plaintext messages), the fold cache (control-fold snapshots
 * the stream keys rehydrate from), pending wraps, the invite inbox, decrypted
 * image bytes, and the community root keys inside them. Anyone with local
 * storage access holds the same device trust, but a logout must not leave
 * another identity's decrypted data (or the keys that mint it) readable by
 * the NEXT account on this device.
 *
 * Scope is deliberately narrow — this is not Armada's scorched-earth
 * purgeClientStorage. 2140's own caches (the public-event store, theme, feed
 * prefs) are public data or per-account already and survive logout as they
 * always have. What is wiped:
 *
 * - IndexedDB: `2140-concord-cache`, `2140-concord-rumors`,
 *   `2140-concord-pending`, `2140-concord-invites`.
 * - Cache Storage: `concord-v2-images` (decrypted image plaintext).
 * - localStorage: every `2140:wire-cursor:*` resume cursor, the
 *   `2140:decrypt-consent` record (consent is per-person, not per-device),
 *   and `concord2:read-cut-pending:*` moderation markers.
 *
 * Wire cursors are keyed per account (`2140:wire-cursor:<pubkey>:<relay>`)
 * but purged wholesale on final logout — a fresh login replays from the
 * lookback floor and re-derives its cursors.
 */

/** Concord V2 IndexedDB databases holding decrypted content / key material. */
const CONCORD_DB_NAMES = [
  "2140-concord-cache", // foldedCache.ts — control-fold snapshots (stream-key rehydration)
  "2140-concord-rumors", // rumorStore.ts — decrypted channel messages
  "2140-concord-pending", // rumorStore.ts — wraps awaiting keys
  "2140-concord-invites", // inviteInbox.ts — decrypted direct invites
] as const;

/** Cache Storage names holding decrypted content (image.ts). */
const CONCORD_CACHE_STORAGE_NAMES = ["concord-v2-images"] as const;

/** localStorage key prefixes wiped by the purge. */
const PURGED_LOCAL_STORAGE_PREFIXES = ["2140:wire-cursor:", "concord2:read-cut-pending:"] as const;

/** Exact localStorage keys wiped by the purge. */
const PURGED_LOCAL_STORAGE_KEYS: readonly string[] = ["2140:decrypt-consent"];

function purgeLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        PURGED_LOCAL_STORAGE_KEYS.includes(key) ||
        PURGED_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

/**
 * Close the module-level store connections first: an open connection blocks
 * `deleteDatabase` (the request stalls in `onblocked`), which would silently
 * leave the decrypted DBs alive for the next login in the same tab.
 */
async function closeConcordStores(): Promise<void> {
  await Promise.all([
    closeRumorStores().catch(() => undefined),
    closeInviteInbox().catch(() => undefined),
    closeFoldedCache().catch(() => undefined),
  ]);
}

async function purgeIndexedDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await Promise.all(
    CONCORD_DB_NAMES.map(
      (name) =>
        new Promise<void>((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          } catch {
            resolve();
          }
        }),
    ),
  );
}

async function purgeCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(
    CONCORD_CACHE_STORAGE_NAMES.map((name) => caches.delete(name).catch(() => false)),
  );
}

/**
 * Wipe the decrypted Concord stores (see the module docstring). Best-effort:
 * individual deletions that fail (blocked by an OTHER tab, unavailable IDB)
 * don't abort the rest. Resets the in-memory decrypt-consent state too, so a
 * same-page next login re-asks rather than inheriting the previous account's
 * "always" choice.
 */
export async function purgeConcordStorage(): Promise<void> {
  resetDecryptConsent();
  purgeLocalStorage();
  await closeConcordStores();
  await Promise.all([purgeIndexedDB(), purgeCacheStorage()]);
}
