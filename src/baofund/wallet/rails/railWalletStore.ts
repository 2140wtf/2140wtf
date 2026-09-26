// src/wallet/rails/railWalletStore.ts
//
// Browser-local storage for USER-CREATED testnet rail wallets (Bitcoin
// testnet4, Liquid testnet). This is the reload-safe home of a mnemonic the
// user generated here (source 'created') or imported from another wallet
// (source 'imported') — it is deliberately INDEPENDENT of the login seed:
// a NIP-07 / passkey / NIP-46 identity that has no seed can still create a
// rail wallet and keep it across reloads.
//
// TESTNET-ONLY, NO VALUE. The mnemonic IS the backup — these words are the
// only way to restore the wallet; the app cannot recover them. Everything
// lives in this browser's localStorage, nothing is sent anywhere.
//
// Storage shape (one slot per IDENTITY, never a global one):
//
//   key:   baofund:rails:wallet:<pubkey-lowercase>
//   value: { testnet4?: RailWalletRecord, liquid?: RailWalletRecord }
//   record: { version: 1, mnemonic, createdAt, source }
//
// The per-identity keying is the repo invariant for auth material (see
// AGENTS.md "Auth material is per-identity"): an invalid or absent pubkey
// reads and writes NOTHING — there is no global fallback slot that a new
// identity could adopt. Reads are try/catch-safe and validate every field;
// a corrupted slot degrades to "no stored wallet", never a throw.

import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export type RailWalletRail = 'testnet4' | 'liquid';
export type RailWalletSource = 'created' | 'imported';

export const RAIL_WALLET_VERSION = 1 as const;
export const RAIL_WALLETS_STORAGE_PREFIX = 'baofund:rails:wallet:';
export const MIN_RAIL_MNEMONIC_WORDS = 12;
export const MAX_RAIL_MNEMONIC_WORDS = 24;
/** Hard cap before BIP-39 work: a hostile slot cannot make us parse MBs. */
export const MAX_RAIL_MNEMONIC_CHARS = 512;

export interface RailWalletRecord {
  version: typeof RAIL_WALLET_VERSION;
  /** Normalized lowercase, single-spaced BIP-39 English mnemonic. */
  mnemonic: string;
  /** Unix seconds. */
  createdAt: number;
  source: RailWalletSource;
}

export type RailWalletMap = Partial<Record<RailWalletRail, RailWalletRecord>>;

const RAILS: readonly RailWalletRail[] = ['testnet4', 'liquid'];
const HEX64 = /^[0-9a-f]{64}$/;

/** Normalize a pubkey to the canonical 64-hex lowercase form; null otherwise. */
export function normalizeRailWalletPubkey(pubkey: string | null | undefined): string | null {
  if (typeof pubkey !== 'string') return null;
  const normalized = pubkey.trim().toLowerCase();
  return HEX64.test(normalized) ? normalized : null;
}

/** True when the value can own a rail-wallet slot (64-hex identity pubkey). */
export function isRailWalletPubkey(pubkey: string | null | undefined): boolean {
  return normalizeRailWalletPubkey(pubkey) !== null;
}

/**
 * Normalize + BIP-39-validate a mnemonic (12/15/18/21/24 English words).
 * Returns the canonical lowercase single-spaced form, or null. Never throws.
 */
export function normalizeRailWalletMnemonic(mnemonic: string | null | undefined): string | null {
  if (typeof mnemonic !== 'string' || mnemonic.length > MAX_RAIL_MNEMONIC_CHARS) return null;
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;
  const words = normalized.split(' ');
  if (words.length < MIN_RAIL_MNEMONIC_WORDS || words.length > MAX_RAIL_MNEMONIC_WORDS) return null;
  if (words.length % 3 !== 0) return null;
  try {
    return validateMnemonic(normalized, wordlist) ? normalized : null;
  } catch {
    return null;
  }
}

/** The per-identity storage key; null for an invalid/absent pubkey. */
export function railWalletStorageKey(pubkey: string | null | undefined): string | null {
  const normalized = normalizeRailWalletPubkey(pubkey);
  return normalized ? `${RAIL_WALLETS_STORAGE_PREFIX}${normalized}` : null;
}

/**
 * Per-identity testnet4 receive/change cursors (addresses/indexes only —
 * never keys). Keyed like the wallet slots (`baofund:l1:<pubkey-lowercase>`);
 * an invalid/absent pubkey reads zeros and writes nothing. The drawer
 * balance scan follows them, so a rotated wallet is not under-reported.
 */
export const TESTNET4_CURSOR_PREFIX = 'baofund:l1:';

export interface Testnet4Cursors {
  receiveIndex: number;
  changeIndex: number;
}

function readCursorIndex(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

export function readTestnet4Cursors(pubkey: string | null | undefined): Testnet4Cursors {
  const normalized = normalizeRailWalletPubkey(pubkey);
  if (!normalized) return { receiveIndex: 0, changeIndex: 0 };
  try {
    const raw = localStorage.getItem(`${TESTNET4_CURSOR_PREFIX}${normalized}`);
    if (!raw) return { receiveIndex: 0, changeIndex: 0 };
    const parsed = JSON.parse(raw) as { receiveIndex?: unknown; changeIndex?: unknown };
    return {
      receiveIndex: readCursorIndex(parsed.receiveIndex),
      changeIndex: readCursorIndex(parsed.changeIndex),
    };
  } catch {
    return { receiveIndex: 0, changeIndex: 0 };
  }
}

export function saveTestnet4Cursors(pubkey: string | null | undefined, cursors: Testnet4Cursors): boolean {
  const normalized = normalizeRailWalletPubkey(pubkey);
  if (
    !normalized
    || !Number.isSafeInteger(cursors.receiveIndex) || cursors.receiveIndex < 0
    || !Number.isSafeInteger(cursors.changeIndex) || cursors.changeIndex < 0
  ) {
    return false;
  }
  try {
    localStorage.setItem(
      `${TESTNET4_CURSOR_PREFIX}${normalized}`,
      JSON.stringify({ receiveIndex: cursors.receiveIndex, changeIndex: cursors.changeIndex }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Per-identity Liquid receive-chain cursor: the highest derivation index the
 * user has rotated to (addresses/indexes only — never keys). Keyed like the
 * wallet slots (`baofund:liquid:<pubkey-lowercase>`); an invalid/absent
 * pubkey reads 0 and writes nothing. Never a source of truth for funds.
 */
export const LIQUID_RECEIVE_CURSOR_PREFIX = 'baofund:liquid:';

export function readLiquidReceiveIndex(pubkey: string | null | undefined): number {
  const normalized = normalizeRailWalletPubkey(pubkey);
  if (!normalized) return 0;
  try {
    const raw = localStorage.getItem(`${LIQUID_RECEIVE_CURSOR_PREFIX}${normalized}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { receiveIndex?: unknown };
    return Number.isSafeInteger(parsed.receiveIndex) && (parsed.receiveIndex as number) >= 0
      ? (parsed.receiveIndex as number)
      : 0;
  } catch {
    return 0;
  }
}

export function saveLiquidReceiveIndex(pubkey: string | null | undefined, receiveIndex: number): boolean {
  const normalized = normalizeRailWalletPubkey(pubkey);
  if (!normalized || !Number.isSafeInteger(receiveIndex) || receiveIndex < 0) return false;
  try {
    localStorage.setItem(
      `${LIQUID_RECEIVE_CURSOR_PREFIX}${normalized}`,
      JSON.stringify({ receiveIndex }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Validate one persisted record; null when any field is wrong or corrupt. */
function parseRecord(value: unknown): RailWalletRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.version !== RAIL_WALLET_VERSION) return null;
  const mnemonic = normalizeRailWalletMnemonic(typeof r.mnemonic === 'string' ? r.mnemonic : null);
  if (!mnemonic) return null;
  if (typeof r.createdAt !== 'number' || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0) return null;
  if (r.source !== 'created' && r.source !== 'imported') return null;
  return { version: RAIL_WALLET_VERSION, mnemonic, createdAt: r.createdAt, source: r.source };
}

/**
 * Load every stored rail wallet for an identity. Invalid pubkey or corrupt
 * storage yields an empty map — never a throw and never another identity's
 * wallet.
 */
export function loadRailWallets(pubkey: string | null | undefined): RailWalletMap {
  const key = railWalletStorageKey(pubkey);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: RailWalletMap = {};
    for (const rail of RAILS) {
      const record = parseRecord((parsed as Record<string, unknown>)[rail]);
      if (record) out[rail] = record;
    }
    return out;
  } catch {
    return {};
  }
}

/** Load one rail's stored wallet; null when absent or invalid. */
export function loadRailWallet(pubkey: string | null | undefined, rail: RailWalletRail): RailWalletRecord | null {
  return loadRailWallets(pubkey)[rail] ?? null;
}

/**
 * Persist one rail wallet for an identity (replacing any previous record for
 * that rail). Returns false — and writes nothing — for an invalid pubkey,
 * rail, or record; never throws.
 */
export function saveRailWallet(
  pubkey: string | null | undefined,
  rail: RailWalletRail,
  record: RailWalletRecord,
): boolean {
  const key = railWalletStorageKey(pubkey);
  if (!key || !RAILS.includes(rail)) return false;
  const validated = parseRecord(record);
  if (!validated) return false;
  try {
    const map = loadRailWallets(pubkey);
    map[rail] = validated;
    localStorage.setItem(key, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one rail wallet for an identity. The identity slot itself is dropped
 * when its last rail wallet goes. Returns false for an invalid pubkey/rail;
 * never throws.
 */
export function clearRailWallet(pubkey: string | null | undefined, rail: RailWalletRail): boolean {
  const key = railWalletStorageKey(pubkey);
  if (!key || !RAILS.includes(rail)) return false;
  try {
    const map = loadRailWallets(pubkey);
    if (!(rail in map)) return true;
    delete map[rail];
    if (Object.keys(map).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}
