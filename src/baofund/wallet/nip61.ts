/**
 * nip61 - the full claim loop for incoming nutzaps (NIP-61).
 *
 * scan → parse → filter(mine ∧ unclaimed ∧ same-mint) → swap at mint
 * → merge into local wallet → persist claimed-ids (idempotent re-runs).
 *
 * Redemption marker: NIP-61 itself defines no public redemption event;
 * claiming SPENDS the sender's proofs at the mint (natural double-spend
 * guard). A public/encrypted "redeemed" notice is a deliberate follow-up
 * once we pick a convention (vendor has an encrypted kind:7376 variant).
 */
import { parseNutzapEvent, buildNutzapEvent } from '@/baofund/cashu-wallet/lib/cashu/cashuNip60';
import { Mint, getDecodedToken, getEncodedToken, normalizeProofAmounts } from '@cashu/cashu-ts';
import { SimplePool } from 'nostr-tools';
import {
  isAllowedMintUrl,
  normalizeProofWitnessForEncode,
  safeNormalizeMintUrl,
  toStoredProofs,
  type StoredProof,
} from '../lib/cashu/tokenUtils';
import { isBlockedMintUrl } from './mintConfig';
import { scopedStorageKey } from '../lib/activeIdentity';

/** localStorage key BASE holding the ids of nutzap events already claimed. */
export const CLAIMED_KEY = 'baofund:nip61-claimed';
const MAX_TRACKED = 500;

/**
 * The claimed set is keyed by WALLET pubkey, never origin-global: a later
 * identity's wallet must not inherit (or suppress) another wallet's claim
 * state (audit run-2 nip61-claimed-global). The wallet pubkey is the same
 * value the claim loop verifies `#p` against.
 */
function claimedStorageKey(walletPubkey: string): string {
  return scopedStorageKey(CLAIMED_KEY, walletPubkey);
}

export interface ParsedNutzap {
  eventId: string;
  sender: string;
  recipient: string;
  mint: string;
  proofs: StoredProof[];
  amount: number;
}

export interface RawNostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
  created_at: number;
}

export function loadClaimedIds(walletPubkey: string): Set<string> {
  const key = claimedStorageKey(walletPubkey);
  try {
    // One-time migration: the first wallet that claims after the upgrade
    // ADOPTS the legacy global claimed set (the ACTIVE identity's data),
    // then the global key is removed so no other wallet can read it.
    if (localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem(CLAIMED_KEY);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(CLAIMED_KEY);
      }
    }
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markClaimedIds(ids: string[], walletPubkey: string): void {
  if (ids.length === 0) return;
  const merged = [...loadClaimedIds(walletPubkey), ...ids].slice(-MAX_TRACKED);
  try {
    localStorage.setItem(claimedStorageKey(walletPubkey), JSON.stringify(merged));
  } catch {
    /* storage full/unavailable - claims stay functional this session */
  }
}

/** Parse one kind:9321 event via the vendored real parser (+ our envelope fields). */
export function parseMine(ev: RawNostrEvent, walletPubkey: string): ParsedNutzap | null {
  let parsed: ReturnType<typeof parseNutzapEvent>;
  try {
    parsed = parseNutzapEvent(ev as never);
  } catch {
    return null;
  }
  if (!parsed) return null;
  if (parsed.recipient.toLowerCase() !== walletPubkey.toLowerCase()) return null;
  if (!ev.id || typeof ev.id !== 'string') return null;
  return {
    eventId: ev.id,
    sender: parsed.sender,
    recipient: parsed.recipient,
    mint: parsed.mint,
    proofs: parsed.proofs as StoredProof[],
    amount: parsed.amount,
  };
}

export interface ClaimDeps {
  /** Relay query returning candidate kind:9321 events addressed to us. */
  query: () => Promise<RawNostrEvent[]>;
  walletPubkey: string;
  /** The active mint (fallback when `knownMints` is not supplied). */
  activeMint: string;
  /** Every mint the wallet knows. When present, nutzaps from any of these are
   *  claimable; nutzaps from unknown mints are skipped, never auto-adopted. */
  knownMints?: string[];
  /** Swap the encoded token at its mint (wallet.receive under the hood). */
  receive: (tokenStr: string, opts?: { privkey?: string }) => Promise<StoredProof[]>;
  /** Merge freshly received proofs into the local wallet store. */
  mergeProofs: (received: StoredProof[]) => Promise<void>;
  /** Wallet private key hex - needed to spend P2PK-locked proofs. */
  privkeyHex?: string | null;
  onClaimed?: (n: ParsedNutzap, received: StoredProof[]) => void;
}

export interface ClaimResult {
  claimed: number;
  sats: number;
  /** Nutzaps addressed to us but on another mint (single-mint wallet). */
  skippedOtherMint: number;
  /** Already claimed in this browser. */
  alreadyClaimed: number;
  /** Per-event failures (some events may still have been claimed). */
  failures: string[];
}

/**
 * Full loop. Idempotent: claimed ids are tracked locally, so re-running
 * never double-receives. Each event is marked claimed IMMEDIATELY after its
 * receive+merge succeeds: one later failure must not discard the marks for
 * earlier successes (their proofs are spent; retrying them would wedge the
 * whole scan). Failures are collected and thrown after the scan.
 */
export async function claimNutzaps(deps: ClaimDeps): Promise<ClaimResult> {
  const result: ClaimResult = { claimed: 0, sats: 0, skippedOtherMint: 0, alreadyClaimed: 0, failures: [] };
  const events = await deps.query();
  const claimedBefore = loadClaimedIds(deps.walletPubkey);
  const failures: string[] = [];

  for (const ev of events) {
    const parsed = parseMine(ev, deps.walletPubkey);
    if (!parsed) continue;
    if (claimedBefore.has(parsed.eventId)) {
      result.alreadyClaimed += 1;
      continue;
    }
    const known = deps.knownMints && deps.knownMints.length > 0 ? deps.knownMints : [deps.activeMint];
    if (!known.some((m) => safeNormalizeMintUrl(m) === safeNormalizeMintUrl(parsed.mint))) {
      result.skippedOtherMint += 1;
      continue;
    }
    // Encode → swap at the mint → merge locally → mark. A failure here only
    // fails THIS event; later events are still attempted.
    try {
      // Witness strings must become objects before re-encoding: a
      // double-encoded witness fails the mint's P2PK signature check.
      // Proofs are amount-normalized (cashu-ts 4.x Proof[] carries Amount).
      const tokenStr = getEncodedToken({
        mint: parsed.mint,
        proofs: normalizeProofAmounts(parsed.proofs.map(normalizeProofWitnessForEncode)),
        unit: 'sat',
      });
      const received = await deps.receive(
        tokenStr,
        deps.privkeyHex ? { privkey: deps.privkeyHex } : undefined,
      );
      if (!Array.isArray(received) || received.length === 0) {
        throw new Error(`Mint returned no proofs for nutzap ${parsed.eventId.slice(0, 8)}`);
      }
      await deps.mergeProofs(received);
      markClaimedIds([parsed.eventId], deps.walletPubkey);
      result.claimed += 1;
      result.sats += parsed.amount;
      deps.onClaimed?.(parsed, received);
    } catch (e) {
      failures.push(`${parsed.eventId.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failures.length > 0) {
    result.failures = failures;
    // Nothing claimed at all -> surface as an error so the caller retries;
    // a PARTIAL success returns the result so the UI can report what landed.
    if (result.claimed === 0) {
      throw new Error(`claim failed for ${failures.length} nutzap(s): ${failures.join('; ')}`);
    }
  }
  return result;
}

// ── Send side: deliver a token AS a nutzap (kind:9321) ─────────────────────

/** Signer shape shared with the API clients (guestIdentity.BaoSigner). */
interface EventSigner {
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>;
}

export interface SendNutzapResult {
  eventId: string;
  /** Relays (≥1) that accepted the event. */
  publishedTo: string[];
}

/**
 * Full keyset ids for the token's mint, fetched with ONE read (`/v1/keysets`).
 * cashu-ts 4.x's `getDecodedToken(token, keysetIds)` cannot map NUT-02 v2
 * SHORT ids without them, so a v2-keyed token (every modern mint) previously
 * failed to decode and the nutzap never left the device.
 */
async function defaultFetchKeysetIds(mintUrl: string): Promise<readonly string[]> {
  const normalized = safeNormalizeMintUrl(mintUrl);
  if (!isAllowedMintUrl(normalized) || isBlockedMintUrl(normalized)) {
    throw new Error(`Mint ${normalized} is not an allowed nutzap mint`);
  }
  const mint = new Mint(normalized);
  const res = await mint.getKeySets();
  const ids = (res?.keysets ?? [])
    .map((k) => k?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) throw new Error(`Mint ${normalized} returned no keysets`);
  return ids;
}

/**
 * Decode the token for the nutzap tags, keyset-aware. v0/v1-keyed tokens
 * decode with an empty keyset list (no network); a v2 SHORT id then triggers
 * ONE read of the mint's keysets and a retry - fail closed when that read
 * fails, never publish an undecodable token. Receive/claim are untouched:
 * they decode through the loaded wallet, which already carries its keychain.
 */
async function decodeTokenForNutzap(
  token: string,
  mintUrl: string,
  deps: { keysetIds?: readonly string[]; fetchKeysetIds?: (mintUrl: string) => Promise<readonly string[]> },
): Promise<ReturnType<typeof getDecodedToken>> {
  try {
    return getDecodedToken(token, []);
  } catch {
    const provided = deps.keysetIds && deps.keysetIds.length > 0 ? deps.keysetIds : undefined;
    const keysetIds = provided ?? await (deps.fetchKeysetIds ?? defaultFetchKeysetIds)(mintUrl);
    if (keysetIds.length === 0) throw new Error(`No keyset ids available for mint ${mintUrl}`);
    return getDecodedToken(token, keysetIds);
  }
}

/**
 * Publish an already-issued cashu token as a NIP-61 nutzap addressed to the
 * recipient's Nostr pubkey. The proofs leave the donor's hands the moment
 * the event is visible - same trust model as handing over the token string,
 * but zero copy/paste and the claim loop picks it up automatically.
 * Resolves only if ≥1 relay accepted; on total failure the caller falls
 * back to manual delivery (the token is still in the donor's UI).
 */
export async function sendNutzap(deps: {
  recipientPubkey: string;
  /** Encoded cashu token (from spendFromStoredWallet). */
  token: string;
  mint: string;
  signer: EventSigner;
  relays: string[];
  memo?: string;
  /** Full keyset ids for the token's mint (tests / callers that already have them). */
  keysetIds?: readonly string[];
  /** Injectable keyset fetch (default: one read of the mint's `/v1/keysets`). */
  fetchKeysetIds?: (mintUrl: string) => Promise<readonly string[]>;
}): Promise<SendNutzapResult> {
  if (!/^[0-9a-f]{64}$/i.test(deps.recipientPubkey)) {
    throw new Error('Recipient pubkey is not a 64-char hex npub value');
  }
  const relays = deps.relays.filter((r) => /^wss:\/\//.test(r));
  if (relays.length === 0) throw new Error('No wss:// relay configured for nutzap delivery');

  // Decode the token back to raw proofs for the kind:9321 tags. cashu-ts 4.x
  // requires the mint's full keyset ids for v2 SHORT ids; they are fetched
  // lazily and the decode fails closed if they cannot be resolved, so an
  // undecodable token is never published as a nutzap.
  const decoded = await decodeTokenForNutzap(deps.token, deps.mint, deps);
  const rawProofs = toStoredProofs(decoded.proofs);
  if (!Array.isArray(rawProofs) || rawProofs.length === 0) throw new Error('Token has no proofs');
  // The nutzap tags carry proof JSON: a string witness must be an object or
  // the recipient's mint rejects the P2PK check.
  const proofs = rawProofs.map((p) => normalizeProofWitnessForEncode(p));

  // The vendor builder signs with the SENDER's identity key and pins the
  // recipient via #p + mint via #u + each proof as a JSON tag.
  const adapter = {
    signEvent: async (t: { kind: number; created_at: number; tags: string[][]; content: string }) => {
      const signed = await deps.signer.signEvent(t);
      return signed as never;
    },
  };
  const ev = await buildNutzapEvent(
    deps.recipientPubkey.toLowerCase(),
    deps.mint,
    proofs,
    adapter as never,
    deps.memo ? { memo: deps.memo } : undefined,
  );
  if (!ev) throw new Error('Failed to build nutzap event');

  const pool = new SimplePool();
  try {
    const settled = await Promise.allSettled(pool.publish(relays, ev as never));
    const ok = relays.filter((_, i) => settled[i].status === 'fulfilled');
    if (ok.length === 0) {
      throw new Error(`No relay accepted the nutzap (${settled.length} tried)`);
    }
    return { eventId: ev.id, publishedTo: ok };
  } finally {
    try { pool.close(relays); } catch { /* pool cleanup best-effort */ }
  }
}
