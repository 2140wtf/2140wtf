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
import { getDecodedToken, getEncodedToken, type Proof } from 'cashu-ts3';
import { SimplePool } from 'nostr-tools';
import { normalizeProofWitnessForEncode, safeNormalizeMintUrl } from '../lib/cashu/tokenUtils';

/** localStorage key holding the ids of nutzap events already claimed here. */
export const CLAIMED_KEY = 'baofund:nip61-claimed';
const MAX_TRACKED = 500;

export interface ParsedNutzap {
  eventId: string;
  sender: string;
  recipient: string;
  mint: string;
  proofs: Proof[];
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

export function loadClaimedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CLAIMED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markClaimedIds(ids: string[]): void {
  if (ids.length === 0) return;
  const merged = [...loadClaimedIds(), ...ids].slice(-MAX_TRACKED);
  try {
    localStorage.setItem(CLAIMED_KEY, JSON.stringify(merged));
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
    proofs: parsed.proofs as Proof[],
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
  receive: (tokenStr: string, opts?: { privkey?: string }) => Promise<Proof[]>;
  /** Merge freshly received proofs into the local wallet store. */
  mergeProofs: (received: Proof[]) => Promise<void>;
  /** Wallet private key hex - needed to spend P2PK-locked proofs. */
  privkeyHex?: string | null;
  onClaimed?: (n: ParsedNutzap, received: Proof[]) => void;
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
  const claimedBefore = loadClaimedIds();
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
      const tokenStr = getEncodedToken({
        mint: parsed.mint,
        proofs: parsed.proofs.map(normalizeProofWitnessForEncode),
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
      markClaimedIds([parsed.eventId]);
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
}): Promise<SendNutzapResult> {
  if (!/^[0-9a-f]{64}$/i.test(deps.recipientPubkey)) {
    throw new Error('Recipient pubkey is not a 64-char hex npub value');
  }
  const relays = deps.relays.filter((r) => /^wss:\/\//.test(r));
  if (relays.length === 0) throw new Error('No wss:// relay configured for nutzap delivery');

  // Decode the token back to raw proofs for the kind:9321 tags.
  const decoded = getDecodedToken(deps.token);
  const rawProofs = decoded.proofs as unknown[];
  if (!Array.isArray(rawProofs) || rawProofs.length === 0) throw new Error('Token has no proofs');
  // The nutzap tags carry proof JSON: a string witness must be an object or
  // the recipient's mint rejects the P2PK check.
  const proofs = rawProofs.map((p) => normalizeProofWitnessForEncode(p as object));

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
