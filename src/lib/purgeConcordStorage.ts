import { resetDecryptConsent } from "@/lib/decryptConsent";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Purge the legacy ₿AO chat (Concord V2) stores on final logout.
 *
 * Concord V2 has been removed from the app; this purge remains so a device
 * that ran the old build has its decrypted-at-rest leftovers wiped on the
 * next final logout. What is wiped:
 *
 * - IndexedDB: `2140-concord-cache`, `2140-concord-rumors`,
 *   `2140-concord-pending`, `2140-concord-invites`.
 * - Cache Storage: `concord-v2-images` (decrypted image plaintext).
 * - localStorage: every `2140:wire-cursor:*` resume cursor, the
 *   `2140:decrypt-consent` record (consent is per-person, not per-device),
 *   and `concord2:read-cut-pending:*` moderation markers.
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

async function purgeIndexedDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await Promise.all(
    CONCORD_DB_NAMES.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error(`Couldn't delete ${name}.`));
            req.onblocked = () => reject(new Error(`Couldn't delete ${name} because another tab still has it open.`));
          } catch (error) {
            reject(error);
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
 * Wipe the decrypted Concord stores (see the module docstring). A blocked or
 * failed database deletion rejects so logout cannot silently claim success.
 * Resets the in-memory decrypt-consent state too, so a
 * same-page next login re-asks rather than inheriting the previous account's
 * "always" choice.
 */
export async function purgeConcordStorage(): Promise<void> {
  resetDecryptConsent();
  purgeLocalStorage();
  await Promise.all([purgeIndexedDB(), purgeCacheStorage()]);
}

/** Remove decrypted Concord material retained in TanStack Query memory. */
export function clearConcordQueryMemory(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => {
    const root = query.queryKey[0];
    return root === "concord2" || root === "concord2-mentions" || root === "wire";
  } });
}
