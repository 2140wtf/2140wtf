// src/wallet/nip60/sync.ts
//
// NIP-60 wallet sync glue between the app and the vendored
// @/baofund/cashu-wallet/lib/cashu/index: relay pool adapter (SimplePool), restore (incl.
// cross-app adoption of a 2140/bao.markets wallet the identity published
// elsewhere), publish of config + token events, and proof merging.

import { SimplePool } from 'nostr-tools/pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools';
import {
  buildTokenEvent,
  buildWalletConfigEvent,
  normalizeMintUrl,
  restoreCrossAppNip60Wallet,
  restoreNip60Wallet,
  type Nip60Signer,
  type Nip60SyncApi,
  type Nip60WalletConfig,
} from '@/baofund/cashu-wallet/lib/cashu/index';

/** Build the NIP-60 sync API over a SimplePool bound to the user's relays. */
export function makeSyncApi(signer: Nip60Signer, relays: string[]): Nip60SyncApi {
  const pool = new SimplePool();
  return {
    signer,
    relays,
    publish: async (event) => {
      // pool.publish returns Promise<void>[] - awaiting the ARRAY does not
      // await the per-relay promises, so this used to report success (and
      // leak rejections) even when every relay refused. Settle them.
      try {
        const settled = await Promise.allSettled(pool.publish(relays, event));
        return settled.some((r) => r.status === 'fulfilled') ? event.id : null;
      } catch {
        return null;
      }
    },
    query: async (filter: Filter) => {
      try {
        return await pool.querySync(relays, filter);
      } catch {
        return [];
      }
    },
    queryRelays: async (urls: string[], filter: Filter) => {
      try {
        return await pool.querySync(urls, filter);
      } catch {
        return [];
      }
    },
    publishToRelays: async (urls: string[], event: NostrEvent) => {
      try {
        const settled = await Promise.allSettled(pool.publish(urls, event));
        return settled.some((r) => r.status === 'fulfilled') ? event.id : null;
      } catch {
        return null;
      }
    },
  };
}

export interface RestoredWallet {
  proofsByMint: Record<string, unknown[]>;
  mints: string[];
  historyCount: number;
  /** Wallet pubkey when this identity's wallet was adopted from another app. */
  adoptedWalletPubkey: string | null;
}

/**
 * High-water-mark for the last adopted config's created_at. Persisted so that
 * on the next restore we reject any OLDER config - preventing rollback
 * adoption by a hostile relay that withholds the current config. Both the HWM
 * and the adopted wallet key are scoped PER IDENTITY: a single origin-wide
 * key made one identity's adoption decide another identity's restore (and the
 * same identity's later refresh).
 */
const CONFIG_HWM_KEY = 'bao-fund:nip60:configHwm';
const IDENTITY_WALLET_KEY = 'baofund:nip60:walletkey';

const identityKey = (base: string, identityPubkey: string): string =>
  `${base}:${identityPubkey.toLowerCase()}`;

function loadConfigHwm(identityPubkey: string): number {
  try { return Number(localStorage.getItem(identityKey(CONFIG_HWM_KEY, identityPubkey))) || 0; }
  catch { return 0; }
}
function persistConfigHwm(identityPubkey: string, ts: number): void {
  try { localStorage.setItem(identityKey(CONFIG_HWM_KEY, identityPubkey), String(ts)); } catch { /* noop */ }
}
function loadIdentityWalletKey(identityPubkey: string): Uint8Array | null {
  try {
    const hex = localStorage.getItem(identityKey(IDENTITY_WALLET_KEY, identityPubkey));
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  } catch { return null; }
}
function persistIdentityWalletKey(identityPubkey: string, key: Uint8Array): void {
  try {
    const hex = Array.from(key).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(identityKey(IDENTITY_WALLET_KEY, identityPubkey), hex);
  } catch { /* noop */ }
}

/** Clear this identity's NIP-60 restore state (HWM + adopted wallet key).
 *  Call on sign-out from any entry point so the next identity on a shared
 *  browser starts from a clean device view. */
export function clearNip60IdentityState(identityPubkey: string): void {
  try {
    localStorage.removeItem(identityKey(CONFIG_HWM_KEY, identityPubkey));
    localStorage.removeItem(identityKey(IDENTITY_WALLET_KEY, identityPubkey));
  } catch { /* noop */ }
}

/** Test seam for the per-identity adoption state (not for app code). */
export const __nip60StateForTests = {
  CONFIG_HWM_KEY,
  IDENTITY_WALLET_KEY,
  loadConfigHwm,
  persistConfigHwm,
} as const;

/**
 * Restore the wallet for an identity: first try to ADOPT the wallet another
 * app (2140 / bao.markets) published for the same identity - same seed →
 * same identity pubkey → kind:17375 config on the user's relays. Falls back
 * to a fresh BAO wallet key when nothing was ever published.
 */
export async function restoreWalletForIdentity(
  identitySigner: Nip60Signer,
  api: Nip60SyncApi,
  freshWalletKey: Uint8Array,
): Promise<{ restored: RestoredWallet; walletSigner: Nip60Signer; walletPrivkey: Uint8Array }> {
  let walletPrivkey: Uint8Array | null = null;
  let adopted = false;

  try {
    const hwm = loadConfigHwm(identitySigner.pubkey);
    const cross = await restoreCrossAppNip60Wallet(identitySigner, api.query, hwm);
    if (cross.walletPrivkey) {
      walletPrivkey = cross.walletPrivkey;
      adopted = true;
      // Persist the new HWM so THIS identity's next restore rejects any
      // older config; the adopted key is persisted per identity so ordinary
      // refreshes and later restores reuse it even before re-adoption.
      if (cross.configCreatedAt > hwm) persistConfigHwm(identitySigner.pubkey, cross.configCreatedAt);
      persistIdentityWalletKey(identitySigner.pubkey, walletPrivkey);
    }
  } catch {
    /* no foreign config → fresh wallet */
  }
  if (!walletPrivkey) {
    walletPrivkey = loadIdentityWalletKey(identitySigner.pubkey) ?? freshWalletKey;
  }

  const walletSigner = walletPrivkey && walletPrivkey.length === 32
    ? await import('@/baofund/cashu-wallet/lib/cashu/index').then((m) => m.createNip60Signer(walletPrivkey as Uint8Array))
    : identitySigner;

  const result = await restoreNip60Wallet(walletSigner, identitySigner, api.query);

  // Tombstone continuity for FRESH devices: this device never published these
  // mints, so its tracked set is empty. Without seeding, spending the LAST
  // proof of a restored mint publishes nothing and the pre-spend event stays
  // on the relay - a later restore (union of non-deleted token events)
  // resurrects the spent proof. Seed the tracked set from the mints that came
  // back in token events; the empty-mint supersede in publishAllTokenEvents
  // then fires on the next wallet change.
  const relayMints = Object.keys(result.proofsByMint)
    .map((mint) => normalizeMintUrl(mint))
    .filter((mint): mint is string => !!mint);
  if (relayMints.length > 0) {
    const tracked = loadPublishedMints(identitySigner.pubkey);
    let added = false;
    for (const mint of relayMints) {
      if (!tracked.has(mint)) {
        tracked.add(mint);
        added = true;
      }
    }
    if (added) savePublishedMints(identitySigner.pubkey, tracked);
  }

  const mints = Object.keys(result.proofsByMint);
  if (result.config?.mints) {
    for (const mint of result.config.mints) {
      if (!mints.includes(mint)) mints.push(mint);
    }
  }
  const restored: RestoredWallet = {
    proofsByMint: result.proofsByMint,
    mints,
    historyCount: result.history.length,
    adoptedWalletPubkey: adopted ? walletSigner.pubkey : null,
  };
  return { restored, walletSigner, walletPrivkey };
}

/** Publish the wallet config (identity-signed) so other apps can adopt it. */
export async function publishWalletConfig(
  api: Nip60SyncApi,
  configs: Nip60WalletConfig[],
): Promise<string | null> {
  const event = await buildWalletConfigEvent(configs, api.signer);
  return event ? api.publish(event) : null;
}

/** NIP-60 token event kind (kind:7375) - mirrors @/baofund/cashu-wallet/lib/cashu/index's TOKEN_KIND,
 *  which the package index does not re-export. */
const TOKEN_EVENT_KIND = 7375;

/**
 * Prior token events of this wallet, grouped by the MINT each encrypted
 * payload carries. Round-2 review: del-tagging ALL prior events while
 * publishing only one mint's proofs destroyed sibling-mint relay backups
 * (funds existed only there). Token event contents are NIP-44
 * encrypted-to-self and carry { mint }, so we decrypt to attribute ids.
 * Events we cannot read are NEVER deleted (fail-safe).
 */
async function classifyPriorTokenEvents(
  api: Nip60SyncApi,
  walletSigner: Nip60Signer,
): Promise<Record<string, string[]> | undefined> {
  try {
    const prev = await api.query({ kinds: [TOKEN_EVENT_KIND], authors: [walletSigner.pubkey], limit: 500 });
    const byMint: Record<string, string[]> = {};
    for (const e of prev as Array<{ id?: string; content?: string; pubkey?: string }>) {
      if (typeof e.id !== 'string' || typeof e.content !== 'string' || typeof e.pubkey !== 'string') continue;
      try {
        const plain = await walletSigner.nip44Decrypt(walletSigner.pubkey, e.content);
        if (!plain) continue;
        const rawMint = (JSON.parse(plain) as { mint?: unknown }).mint;
        if (typeof rawMint !== 'string') continue;
        const mint = normalizeMintUrl(rawMint);
        if (!mint) continue;
        (byMint[mint] ??= []).push(e.id);
      } catch {
        // unreadable payload - leave the event alone
      }
    }
    return byMint;
  } catch {
    return undefined;
  }
}

/** Ids of this wallet's previously published token events FOR ONE MINT, so
 *  the new token event supersedes exactly that mint's prior events via the
 *  NIP-60 `del` tag. Without supersession, restores UNION old and new
 *  events and resurrect already-spent proofs - phantom balance, every
 *  later send rejected at the mint. */
async function previousTokenEventIds(
  api: Nip60SyncApi,
  walletSigner: Nip60Signer,
  mintUrl: string,
): Promise<string[] | undefined> {
  const classified = await classifyPriorTokenEvents(api, walletSigner);
  if (!classified) return undefined; // query failed - publish WITHOUT deletions rather than mis-del
  const normalized = normalizeMintUrl(mintUrl);
  const ids = (normalized ? classified[normalized] : undefined) ?? [];
  return ids.length > 0 ? ids : undefined;
}

/** Publish a NIP-60 token event (wallet-signed) for one mint's proofs.
 *  Supersedes all of the wallet's prior token events (NIP-60 `del`). */
export async function publishTokenEvent(
  api: Nip60SyncApi,
  walletSigner: Nip60Signer,
  mintUrl: string,
  proofs: unknown[],
): Promise<string | null> {
  const delEventIds = await previousTokenEventIds(api, walletSigner, mintUrl);
  const event = await buildTokenEvent(mintUrl, proofs, walletSigner, delEventIds);
  return event ? api.publish(event) : null;
}

/**
 * Mints this identity has previously published proofs for, so a mint that
 * drops to ZERO gets a superseding empty token event (a stale relay event
 * would otherwise resurrect spent proofs on the next restore - the vendor
 * publish path skips empty proof lists).
 */
const PUBLISHED_MINTS_KEY = 'bao-fund:nip60:publishedMints';
const publishedMintsKeyFor = (identityPubkey: string): string =>
  `${PUBLISHED_MINTS_KEY}:${identityPubkey.toLowerCase()}`;

function loadPublishedMints(identityPubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(publishedMintsKeyFor(identityPubkey));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePublishedMints(identityPubkey: string, mints: Set<string>): void {
  try {
    localStorage.setItem(publishedMintsKeyFor(identityPubkey), JSON.stringify([...mints]));
  } catch {
    /* storage unavailable */
  }
}

/** Publish token events for every mint with proofs and supersede mints that
 *  dropped to zero. Returns published count. */
export async function publishAllTokenEvents(
  api: Nip60SyncApi,
  walletSigner: Nip60Signer,
  proofsByMint: Record<string, unknown[]>,
): Promise<number> {
  let published = 0;
  const next = new Set<string>();
  for (const [mint, proofs] of Object.entries(proofsByMint)) {
    const normalized = normalizeMintUrl(mint);
    if (!normalized || proofs.length === 0) continue;
    if (await publishTokenEvent(api, walletSigner, normalized, proofs)) published += 1;
    next.add(normalized);
  }
  const identityPubkey = api.signer?.pubkey;
  if (identityPubkey) {
    // Mints whose tombstone publish FAILED stay tracked so the next republish
    // retries the supersede. Dropping them here (unconditional save) made one
    // transient relay error permanent: the pre-spend event would then never be
    // superseded and the next restore resurrected spent proofs.
    const tracked = new Set(next);
    for (const mint of loadPublishedMints(identityPubkey)) {
      if (next.has(mint)) continue;
      if (await publishTokenEvent(api, walletSigner, mint, [])) published += 1;
      else tracked.add(mint);
    }
    savePublishedMints(identityPubkey, tracked);
  }
  return published;
}

/**
 * Merge restored (relay) proofs into the local wallet, deduping by secret.
 * FIXED (round-2): local proofs take priority - prevents stale relay
 * events (pre-spend) from overwriting the local wallet and then
 * `refresh()` amplifying the resurrected state back to all relays.
 */
export function mergeRestoredProofs(
  current: ReadonlyArray<unknown>,
  restored: ReadonlyArray<unknown>,
): unknown[] {
  // restored first, then current overwrites - local wins.
  const bySecret = new Map<string, unknown>();
  for (const p of restored as Array<{ secret?: unknown }>) {
    if (p && typeof p.secret === 'string' && p.secret) bySecret.set(p.secret, p);
  }
  for (const p of current as Array<{ secret?: unknown }>) {
    if (p && typeof p.secret === 'string' && p.secret) bySecret.set(p.secret, p);
  }
  return [...bySecret.values()];
}

export type { Nip60Signer, Nip60SyncApi, Nip60WalletConfig, NostrEvent, Filter };
export { verifyEvent } from 'nostr-tools/pure';
