/**
 * A tiny IndexedDB key→value store for caching DECRYPTED / folded Concord
 * results (community metadata, roster) across reloads, so the rail icon, the
 * community name/banner, and the admin roster paint instantly on refresh
 * instead of waiting for the raw events to be re-read + re-decrypted + re-folded.
 *
 * Values may contain `bigint`, `Uint8Array`, `Map`, and `Set`, which plain JSON
 * can't round-trip — {@link encode}/{@link decode} use a tagged-wrapper codec so
 * the folded shapes survive serialization exactly.
 *
 * Trust note: this persists DECRYPTED community data at rest. That is the same
 * device-trust level as the raw community keys already in the event store /
 * membership list — anyone with local storage access already has the keys.
 */

const DB_NAME = "2140-concord-cache";
const STORE = "kv";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Close the shared connection and forget it, so the database can be deleted
 * (the final-logout purge) — an open connection blocks `deleteDatabase`. The
 * next read reopens lazily via {@link openDb}.
 */
export async function closeFoldedCache(): Promise<void> {
  const pending = dbPromise;
  dbPromise = undefined;
  try {
    (await pending)?.close();
  } catch {
    // Never opened or already closed.
  }
}

// ── codec ─────────────────────────────────────────────────────────────────────
// Tagged wrappers for types JSON drops. Hex is used for bytes (compact, stable).

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { __t: "bigint", v: value.toString() };
  if (value instanceof Uint8Array) return { __t: "u8", v: toHex(value) };
  if (value instanceof Map) return { __t: "map", v: [...value.entries()] };
  if (value instanceof Set) return { __t: "set", v: [...value.values()] };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "__t" in (value as Record<string, unknown>)) {
    const tagged = value as { __t: string; v: unknown };
    switch (tagged.__t) {
      case "bigint": return BigInt(tagged.v as string);
      case "u8": return fromHex(tagged.v as string);
      case "map": return new Map(tagged.v as [unknown, unknown][]);
      case "set": return new Set(tagged.v as unknown[]);
    }
  }
  return value;
}

/** Serialize a folded value (with bigint/Uint8Array/Map/Set) to a string. */
export function encode(value: unknown): string {
  return JSON.stringify(value, replacer);
}

/** Deserialize a string produced by {@link encode}, or undefined on failure. */
export function decode<T>(json: string): T | undefined {
  try {
    return JSON.parse(json, reviver) as T;
  } catch {
    return undefined;
  }
}

// ── store ──────────────────────────────────────────────────────────────────────

/** Read a cached folded value by key, or undefined on miss / error. */
export async function readFolded<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    const json = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
    return json ? decode<T>(json) : undefined;
  } catch {
    return undefined;
  }
}

/** Persist a folded value by key (best-effort; failures are swallowed). */
export async function writeFolded(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    const json = encode(value);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(json, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort cache.
  }
}
