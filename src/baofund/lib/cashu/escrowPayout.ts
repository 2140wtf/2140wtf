// src/lib/cashu/escrowPayout.ts
//
// Escrow payout recovery - unblinding + persistence of a COMPLETED escrow
// swap's payout (milestone release for the project, refund for the donor).
//
// A release/refund completion returns the mint's blind signatures for the
// swap's outputs; the output blinding data travels on the swap the party just
// signed. Without unblinding them together, the payout is unrecoverable: the
// mint has spent the escrow inputs and the output proofs can only be
// reconstructed from the blinding factors that were in the initiating
// client's memory. `completeEscrowRelease` used to return only the milestone
// status, dropping `swap_signatures` on the floor - a settled release whose
// payout nobody could ever spend (audit).
//
// Rules:
//   - the mint signature count must match the outputs and every signature
//     amount must match its output (NUT-03 order);
//   - the mint's keyset must be reachable over https (loopback http allowed)
//     and advertise a key for every output amount - otherwise fail closed;
//   - the recovered token is JOURNALED per identity BEFORE any wallet
//     adoption, so a crash or a failed mint swap can never lose the payout;
//   - adopting into the wallet needs the identity key (the payout output is
//     P2PK-locked to the party key); without it the journal keeps the token
//     for manual import. Nothing here is ever deleted on a soft failure.
//
// The journal is a local convenience store, never a money authority: an
// entry's token is the value, the envelope is a recovery hint.

import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { Amount, getEncodedToken, pointFromHex, unblindSignature, type Proof } from '@cashu/cashu-ts';
import type { EscrowSwapOutputWire } from './escrowSwapComplete';

/** One mint blind signature for a swap output (the API's swap_signatures). */
export interface EscrowPayoutSignature {
  amount: number;
  C_: string;
  /** Keyset id when the mint returned it (optional in older payloads). */
  id?: string;
}

/** The subset of a mint keyset unblinding needs. */
export interface EscrowPayoutKeyset {
  id: string;
  keys: Record<string, string>;
}

export interface EscrowPayoutRecord {
  v: 1;
  kind: 'release' | 'refund';
  frId: string;
  milestoneId: string;
  mint: string;
  amountSats: number;
  token: string;
  createdAt: number;
}

const HEX_COMPRESSED_POINT = /^[0-9a-f]{66}$/i;
const STORE_PREFIX = 'baofund:escrow-payouts:';
const MAX_RECORDS = 20;

function isPositiveSats(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validate a `swap_signatures` payload from a completion response. Returns
 * null when the field is absent (older API); throws when it is present but
 * malformed - a malformed payout signature set must never be partially
 * trusted.
 */
export function parseEscrowPayoutSignatures(value: unknown): EscrowPayoutSignature[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new Error('The Fund API returned a malformed swap_signatures payload');
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('The Fund API returned a malformed swap signature');
    const sig = raw as Record<string, unknown>;
    if (!isPositiveSats(sig.amount) || typeof sig.C_ !== 'string' || !HEX_COMPRESSED_POINT.test(sig.C_)) {
      throw new Error('The Fund API returned a malformed swap signature');
    }
    return {
      amount: sig.amount,
      C_: sig.C_.toLowerCase(),
      ...(typeof sig.id === 'string' && sig.id.length > 0 ? { id: sig.id } : {}),
    };
  });
}

/** Exact keyset match, else a UNIQUE short-id prefix match (NUT-02 v2
 *  keyset ids are advertised in the full form while outputs may carry the
 *  short form). Ambiguity fails closed. */
function keysetForOutput(keysets: readonly EscrowPayoutKeyset[], outputId: string): EscrowPayoutKeyset | null {
  const exact = keysets.find((k) => k.id === outputId);
  if (exact) return exact;
  const prefixed = keysets.filter((k) => k.id.startsWith(outputId) || outputId.startsWith(k.id));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/**
 * Unblind a completed swap's mint signatures into spendable proofs. Pure:
 * keysets are injected. Throws on ANY mismatch - the caller must treat the
 * payout as NOT recovered (the journal keeps the raw material for a retry).
 */
export function unblindEscrowPayoutProofs(
  outputs: readonly EscrowSwapOutputWire[],
  signatures: readonly EscrowPayoutSignature[],
  keysets: readonly EscrowPayoutKeyset[],
): Proof[] {
  if (!Array.isArray(outputs) || outputs.length === 0) throw new Error('The payout swap has no outputs');
  if (!Array.isArray(signatures) || signatures.length !== outputs.length) {
    throw new Error(`The Fund API returned ${Array.isArray(signatures) ? signatures.length : 'no'} mint signature(s) for ${outputs.length} payout output(s)`);
  }
  if (!Array.isArray(keysets) || keysets.length === 0) throw new Error('No mint keyset available for the payout unblind');
  return outputs.map((output, i) => {
    const signature = signatures[i];
    const amount = output.blindedMessage.amount;
    if (signature.amount !== amount) {
      throw new Error(`Payout signature ${i} is for ${signature.amount} sats but its output is ${amount} sats`);
    }
    // When the mint echoes the keyset id, it must match the output's.
    if (signature.id && signature.id !== output.blindedMessage.id) {
      throw new Error(`Payout signature ${i} keyset does not match its output`);
    }
    const keyset = keysetForOutput(keysets, output.blindedMessage.id);
    const keyHex = keyset?.keys[String(amount)];
    if (!keyset || !keyHex) {
      throw new Error(`The mint keyset${keyset ? ` ${keyset.id.slice(0, 16)}…` : ''} has no key for a ${amount}-sat payout output`);
    }
    const C = unblindSignature(
      pointFromHex(signature.C_),
      BigInt('0x' + output.blindingFactor),
      pointFromHex(keyHex),
    );
    const cHex = typeof (C as unknown as { toHex?: unknown }).toHex === 'function'
      ? (C as unknown as { toHex: (c?: boolean) => string }).toHex(true)
      : bytesToHex((C as unknown as { toBytes: (c?: boolean) => Uint8Array }).toBytes(true));
    return {
      id: output.blindedMessage.id,
      // cashu-ts 4.x: a library Proof carries an Amount; the wire amount is a
      // plain number, so convert at this boundary (getEncodedToken below
      // serializes the Proof[] and would otherwise receive a raw number).
      amount: Amount.from(amount),
      secret: new TextDecoder().decode(hexToBytes(output.secret.toLowerCase())),
      C: cHex,
    } as Proof;
  });
}

interface MintKeysWire {
  keysets?: Array<{ id?: unknown; keys?: unknown }>;
}

/** Fetch the mint's advertised keysets (NUT-01 /v1/keys). https only
 *  (loopback http for tests); redirects refused. */
export async function fetchMintPayoutKeysets(
  mintUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<EscrowPayoutKeyset[]> {
  const base = String(mintUrl ?? '').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('The escrow mint URL is invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('The escrow mint URL is not https');
  }
  const res = await fetchFn(`${base}/v1/keys`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Fetching the mint keys failed with HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as MintKeysWire | null;
  const keysets = Array.isArray(body?.keysets) ? body!.keysets : [];
  const out: EscrowPayoutKeyset[] = [];
  for (const raw of keysets) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
    const keys: Record<string, string> = {};
    if (raw.keys && typeof raw.keys === 'object' && !Array.isArray(raw.keys)) {
      for (const [amount, key] of Object.entries(raw.keys as Record<string, unknown>)) {
        if (typeof key === 'string' && key.length > 0) keys[amount] = key;
      }
    }
    if (Object.keys(keys).length > 0) out.push({ id: raw.id, keys });
  }
  if (out.length === 0) throw new Error('The mint did not advertise any usable keyset');
  return out;
}

// ─── Per-identity journal (bounded, best-effort) ────────────────────────────

function storeKey(pubkey: string): string | null {
  return /^[0-9a-f]{64}$/i.test(pubkey) ? `${STORE_PREFIX}${pubkey.toLowerCase()}` : null;
}

/** Every stored payout for an identity, newest first. Never throws. */
export function listEscrowPayouts(pubkey: string | null | undefined): EscrowPayoutRecord[] {
  const key = pubkey ? storeKey(pubkey) : null;
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is EscrowPayoutRecord => (
      !!r && typeof r === 'object'
      && (r as { v?: unknown }).v === 1
      && typeof (r as { token?: unknown }).token === 'string'
      && (r as { token: string }).token.length > 0
      && typeof (r as { mint?: unknown }).mint === 'string'
      && typeof (r as { frId?: unknown }).frId === 'string'
      && typeof (r as { milestoneId?: unknown }).milestoneId === 'string'
      && isPositiveSats((r as { amountSats?: unknown }).amountSats)
    ));
  } catch {
    return [];
  }
}

/** Journal a recovered payout (deduped by frId+milestoneId, bounded). */
export function saveEscrowPayout(pubkey: string | null | undefined, record: EscrowPayoutRecord): boolean {
  const key = pubkey ? storeKey(pubkey) : null;
  if (!key) return false;
  try {
    const existing = listEscrowPayouts(pubkey).filter(
      (r) => !(r.frId === record.frId && r.milestoneId === record.milestoneId),
    );
    const next = [record, ...existing].slice(0, MAX_RECORDS);
    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Drop a journal entry (the payout was adopted into the wallet). */
export function removeEscrowPayout(pubkey: string | null | undefined, frId: string, milestoneId: string): void {
  const key = pubkey ? storeKey(pubkey) : null;
  if (!key) return;
  try {
    const next = listEscrowPayouts(pubkey).filter((r) => !(r.frId === frId && r.milestoneId === milestoneId));
    if (next.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* best effort */
  }
}

// ─── Recovery orchestration ─────────────────────────────────────────────────

export interface RecoverEscrowPayoutOpts {
  kind: 'release' | 'refund';
  frId: string;
  milestoneId: string;
  /** The mint the completed swap settled at. */
  mint: string;
  /** Exact sats the swap pays the beneficiary. */
  expectedPayoutSats: number;
  /** The swap's outputs (blinding data) and the mint's signatures. */
  outputs: readonly EscrowSwapOutputWire[];
  signatures: readonly EscrowPayoutSignature[];
  /** The identity the payout belongs to (journal scope); null = no journal. */
  identityPubkey: string | null;
  /** Seed identity key (hex) to sign the P2PK payout during wallet adoption. */
  identityHex?: string | null;
  /** Injectable for tests. */
  fetchKeys?: (mint: string) => Promise<EscrowPayoutKeyset[]>;
  /** Injectable for tests; defaults to a NIP-60 wallet receive. */
  adopt?: (token: string, opts: { privkey?: string }) => Promise<void>;
}

export interface RecoveredEscrowPayout {
  token: string;
  amountSats: number;
  /** `wallet` when adopted into the local wallet, `journal` when only stored. */
  stored: 'wallet' | 'journal';
}

/**
 * Unblind a completed swap's payout, journal it, and try to adopt it into
 * the local wallet. Throws when unblinding fails (nothing stored, and the
 * caller must surface the failure); a failed ADOPTION keeps the journal
 * entry and reports `journal`.
 */
export async function recoverEscrowPayout(opts: RecoverEscrowPayoutOpts): Promise<RecoveredEscrowPayout> {
  if (!isPositiveSats(opts.expectedPayoutSats)) throw new Error('The payout amount is invalid');
  const fetchKeys = opts.fetchKeys ?? fetchMintPayoutKeysets;
  const keysets = await fetchKeys(opts.mint);
  const proofs = unblindEscrowPayoutProofs(opts.outputs, opts.signatures, keysets);
  const amountSats = proofs.reduce((sum, p) => sum + Amount.from(p.amount).toNumber(), 0);
  if (amountSats !== opts.expectedPayoutSats) {
    throw new Error(`The recovered payout is ${amountSats} sats, expected ${opts.expectedPayoutSats}`);
  }
  const token = getEncodedToken({ mint: opts.mint, proofs, unit: 'sat' });
  const record: EscrowPayoutRecord = {
    v: 1,
    kind: opts.kind,
    frId: opts.frId,
    milestoneId: opts.milestoneId,
    mint: opts.mint,
    amountSats,
    token,
    createdAt: Date.now(),
  };
  // Journal FIRST: the token is the only recoverable copy until the wallet
  // receive commits its own crash journal.
  const journaled = saveEscrowPayout(opts.identityPubkey, record);
  try {
    const adopt = opts.adopt ?? defaultAdopt;
    await adopt(token, opts.identityHex ? { privkey: opts.identityHex } : {});
    removeEscrowPayout(opts.identityPubkey, opts.frId, opts.milestoneId);
    return { token, amountSats, stored: 'wallet' };
  } catch (err) {
    if (!journaled) {
      // No identity scope to journal under AND the wallet receive failed:
      // the token exists only in memory. Refuse to report it as stored.
      throw new Error(
        `The payout could not be stored (${err instanceof Error ? err.message : String(err)}) - the token is NOT saved`,
        { cause: err },
      );
    }
    return { token, amountSats, stored: 'journal' };
  }
}

/**
 * Default adoption: receive the token into the per-identity Cashu wallet
 * (swaps the P2PK payout into the wallet's own proofs and persists them;
 * the NIP-60 republish follows the store change). Throws when unavailable.
 */
async function defaultAdopt(token: string, opts: { privkey?: string }): Promise<void> {
  const { receiveIntoStoredWallet } = await import('../../wallet/cashuWallet');
  await receiveIntoStoredWallet(token, opts.privkey ? { privkey: opts.privkey } : undefined);
}

/**
 * Adopt a JOURNALED payout into the wallet (Wallet → escrow payouts action).
 * Returns false when the receive failed; the journal entry is kept either
 * way (a spent-at-mint token simply fails again - never silently dropped).
 */
export async function adoptEscrowPayout(
  pubkey: string | null | undefined,
  record: EscrowPayoutRecord,
  identityHex?: string | null,
  adopt?: (token: string, opts: { privkey?: string }) => Promise<void>,
): Promise<boolean> {
  try {
    const run = adopt ?? defaultAdopt;
    await run(record.token, identityHex ? { privkey: identityHex } : {});
    removeEscrowPayout(pubkey, record.frId, record.milestoneId);
    return true;
  } catch {
    return false;
  }
}
