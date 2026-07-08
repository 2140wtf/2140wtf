/**
 * Persisted silent-payment UTXO state — NIP-78 codec.
 *
 * Discovered SP UTXOs are persisted as an addressable NIP-78 event
 * (kind 30078) whose `content` is a NIP-44-encrypted JSON document. This lets
 * scan state sync across devices via the user's relays, and lets a fresh
 * install resume from `scanHeight + 1` instead of walking the chain from
 * genesis.
 *
 * The encrypted payload contains per-output BIP-352 tweaks (`t_k`), so
 * NIP-44 encryption to the user's own pubkey prevents relay operators from
 * correlating the stored data with on-chain outputs.
 *
 * Event shape:
 *   kind:    30078
 *   d-tag:   `${appId}/hdwallet/sp-utxos`
 *   content: NIP-44( JSON.stringify(SPStorageDocument) )
 */

import type { SPMatchedUtxo } from './scanner';

/** Current document schema version. Bump on breaking changes. */
export const SP_STORAGE_VERSION = 1;

const SP_STORAGE_D_TAG_SUFFIX = 'hdwallet/sp-utxos';

/** Build the full d-tag for the given appId, e.g. `"2140/hdwallet/sp-utxos"`. */
export function spStorageDTag(appId: string): string {
  return `${appId}/${SP_STORAGE_D_TAG_SUFFIX}`;
}

/** One persisted silent-payment UTXO entry. */
export interface SPStoredUtxo {
  /** Lowercase 64-char hex transaction id. */
  txid: string;
  /** Output index. */
  vout: number;
  /** Value in satoshis. */
  value: number;
  /** Block height the UTXO was mined at. */
  height: number;
  /** 32-byte BIP-352 tweak `t_k`, lowercase hex. Needed at spend time. */
  tweak: string;
  /** Per-tx output index within the SP output set (`k = 0, 1, …`). */
  k: number;
  /**
   * Real block timestamp in unix seconds. Optional for backward compatibility;
   * the UI can fall back to a synthetic estimate from `height` when missing.
   */
  time?: number;
}

/** The full persisted document, after NIP-44 decrypt + JSON parse. */
export interface SPStorageDocument {
  /** Schema version. Always `SP_STORAGE_VERSION` for newly-written docs. */
  version: number;
  /**
   * The highest *fully-scanned* block height. Forward scans should resume at
   * `scanHeight + 1`. `0` means "never scanned".
   */
  scanHeight: number;
  /** All discovered SP UTXOs the wallet still considers spendable. */
  utxos: SPStoredUtxo[];
  /**
   * SP UTXOs that have been confirmed spent. Retained here — rather than
   * deleted — so transaction history can still show the original receive.
   */
  spent?: SPStoredUtxo[];
}

/** Empty document used as the starting state. */
export const EMPTY_SP_STORAGE: SPStorageDocument = {
  version: SP_STORAGE_VERSION,
  scanHeight: 0,
  utxos: [],
  spent: [],
};

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/**
 * Parse a decrypted JSON string into an `SPStorageDocument`. Returns the empty
 * document on any error rather than throwing, so a corrupted relay payload
 * doesn't break the wallet.
 */
export function parseSPStorage(plaintext: string): SPStorageDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return { ...EMPTY_SP_STORAGE };
  }
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SP_STORAGE };
  const obj = raw as Record<string, unknown>;
  const scanHeight =
    typeof obj.scanHeight === 'number' &&
    Number.isInteger(obj.scanHeight) &&
    obj.scanHeight >= 0
      ? obj.scanHeight
      : 0;
  const utxos = parseUtxoArray(obj.utxos);
  const spent = parseUtxoArray(obj.spent);
  return { version: SP_STORAGE_VERSION, scanHeight, utxos, spent };
}

/** Shared validator for both the active and archived UTXO lists. */
function parseUtxoArray(raw: unknown): SPStoredUtxo[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: SPStoredUtxo[] = [];
  for (const u of rows) {
    if (!u || typeof u !== 'object') continue;
    const row = u as Record<string, unknown>;
    if (typeof row.txid !== 'string' || !/^[0-9a-f]{64}$/.test(row.txid)) continue;
    if (typeof row.vout !== 'number' || !Number.isInteger(row.vout) || row.vout < 0) continue;
    if (typeof row.value !== 'number' || !Number.isInteger(row.value) || row.value < 0) continue;
    if (typeof row.height !== 'number' || !Number.isInteger(row.height) || row.height < 0) continue;
    if (typeof row.tweak !== 'string' || !/^[0-9a-f]{64}$/.test(row.tweak)) continue;
    if (typeof row.k !== 'number' || !Number.isInteger(row.k) || row.k < 0) continue;
    const time =
      typeof row.time === 'number' && Number.isInteger(row.time) && row.time > 0
        ? row.time
        : undefined;
    out.push({
      txid: row.txid,
      vout: row.vout,
      value: row.value,
      height: row.height,
      tweak: row.tweak,
      k: row.k,
      ...(time !== undefined ? { time } : {}),
    });
  }
  return out;
}

/** Serialise a document for encryption. */
export function serializeSPStorage(doc: SPStorageDocument): string {
  return JSON.stringify({
    version: SP_STORAGE_VERSION,
    scanHeight: doc.scanHeight,
    utxos: doc.utxos,
    spent: doc.spent ?? [],
  });
}

// ---------------------------------------------------------------------------
// UTXO helpers
// ---------------------------------------------------------------------------

/** Convert a freshly-discovered match into the persisted hex form. */
export function matchedUtxoToStored(m: SPMatchedUtxo): SPStoredUtxo {
  return {
    txid: m.txid,
    vout: m.vout,
    value: m.value,
    height: m.height,
    tweak: bytesToHex(m.tweak),
    k: m.k,
  };
}

/**
 * Merge newly-discovered UTXOs into the persisted set, de-duplicated by
 * `(txid, vout)`. New entries overwrite existing ones with the same key, except
 * that an existing `time` is preserved if the new entry lacks one.
 */
export function mergeUtxos(
  existing: ReadonlyArray<SPStoredUtxo>,
  fresh: ReadonlyArray<SPStoredUtxo>,
): SPStoredUtxo[] {
  const key = (u: SPStoredUtxo) => `${u.txid}:${u.vout}`;
  const map = new Map<string, SPStoredUtxo>();
  for (const u of existing) map.set(key(u), u);
  for (const u of fresh) {
    const k = key(u);
    const prior = map.get(k);
    if (prior && prior.time !== undefined && u.time === undefined) {
      map.set(k, { ...u, time: prior.time });
    } else {
      map.set(k, u);
    }
  }
  return Array.from(map.values());
}

/** Total satoshi balance across all active stored UTXOs. */
export function spStorageBalance(doc: SPStorageDocument): number {
  let total = 0;
  for (const u of doc.utxos) total += u.value;
  return total;
}

/**
 * Remove the given `(txid, vout)` entries from a UTXO list. Used after a
 * successful spend to drop consumed SP UTXOs.
 */
export function pruneSpUtxos(
  existing: ReadonlyArray<SPStoredUtxo>,
  spent: ReadonlyArray<{ txid: string; vout: number }>,
): SPStoredUtxo[] {
  if (spent.length === 0) return existing.slice();
  const spentKeys = new Set(spent.map((s) => `${s.txid}:${s.vout}`));
  return existing.filter((u) => !spentKeys.has(`${u.txid}:${u.vout}`));
}

/**
 * Move the given `(txid, vout)` entries from a document's active `utxos` list
 * to its `spent` archive, deduplicated against any existing archive entries.
 */
export function archiveSpentUtxos(
  doc: SPStorageDocument,
  spent: ReadonlyArray<{ txid: string; vout: number }>,
): SPStorageDocument {
  if (spent.length === 0) return doc;
  const spentKeys = new Set(spent.map((s) => `${s.txid}:${s.vout}`));
  const remaining: SPStoredUtxo[] = [];
  const toArchive: SPStoredUtxo[] = [];
  for (const u of doc.utxos) {
    if (spentKeys.has(`${u.txid}:${u.vout}`)) {
      toArchive.push(u);
    } else {
      remaining.push(u);
    }
  }
  if (toArchive.length === 0) return doc;

  const existingArchive = doc.spent ?? [];
  const archiveByKey = new Map<string, SPStoredUtxo>();
  for (const u of existingArchive) archiveByKey.set(`${u.txid}:${u.vout}`, u);
  for (const u of toArchive) {
    const k = `${u.txid}:${u.vout}`;
    if (!archiveByKey.has(k)) archiveByKey.set(k, u);
  }

  return {
    version: SP_STORAGE_VERSION,
    scanHeight: doc.scanHeight,
    utxos: remaining,
    spent: Array.from(archiveByKey.values()),
  };
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, '0');
  }
  return s;
}
