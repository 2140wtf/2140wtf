import { ensureDecryptConsent, getDecryptConsent } from "@/lib/decryptConsent";

import type { NostrSigner } from "@nostrify/nostrify";

/**
 * Structural subset of a signer with a persistent decrypt cache (Armada's
 * AppSigner exposes `isDecryptCached`; this client's signers currently do
 * not). The cache-peek is what lets a warm client skip the consent prompt
 * entirely: a decrypt whose plaintext is already cached never touches the
 * signer, so there is nothing to ask about.
 */
interface DecryptCachePeek {
  isDecryptCached(method: "nip04" | "nip44", counterparty: string, ciphertext: string): Promise<boolean>;
}

/** Whether a signer exposes a decrypt-cache peek. */
function canPeekDecryptCache(signer: NostrSigner): signer is NostrSigner & DecryptCachePeek {
  return typeof (signer as { isDecryptCached?: unknown } | null)?.isDecryptCached === "function";
}

/** One decrypt's inputs, for the cache-peek. */
export interface DecryptTarget {
  counterparty: string;
  ciphertext: string;
}

/**
 * Decide whether a batch of signer decrypts may proceed, WITHOUT flooding the
 * signer to find out.
 *
 * The rule, in order:
 *
 *   0. The signer can't prompt (a local nsec decrypts instantly, no approval) →
 *      proceed. There is nothing to gate: the consent prompt only exists to
 *      spare remote (NIP-46 bunker) / extension (NIP-07) signers a storm of
 *      per-decrypt approvals.
 *   1. Already allowed → proceed (the common steady state).
 *   2. Every target is already cached → proceed silently. A cached decrypt
 *      never touches the signer, so there's nothing to prompt about; this is
 *      what lets a warm client (re-entering a thread, a reconnect) skip the
 *      gate entirely.
 *   3. Otherwise consult the one-time consent gate (`ensureDecryptConsent`),
 *      which opens at most ONE app-wide prompt and remembers the answer.
 *
 * Returns true iff the caller should perform the (uncached) decrypts. When it
 * returns false the caller must leave the content as encrypted placeholders and
 * expose the manual "Decrypt" / "Decrypt all" affordances.
 */
export async function mayBulkDecrypt(
  signer: NostrSigner,
  method: "nip04" | "nip44",
  targets: DecryptTarget[],
  needsApproval: boolean,
): Promise<boolean> {
  if (targets.length === 0) return true;
  if (!needsApproval) return true;
  if (getDecryptConsent() === "allowed") return true;
  if (getDecryptConsent() === "declined" && (await allCached(signer, method, targets))) return true;
  if (getDecryptConsent() === "declined") return false;

  // Undecided: if the whole batch is cached, proceed without ever asking.
  if (await allCached(signer, method, targets)) return true;

  return (await ensureDecryptConsent()) === "allowed";
}

/** Whether every target's plaintext is already cached (no signer round-trip). */
async function allCached(signer: NostrSigner, method: "nip04" | "nip44", targets: DecryptTarget[]): Promise<boolean> {
  if (!canPeekDecryptCache(signer)) return false;
  for (const t of targets) {
    if (!(await signer.isDecryptCached(method, t.counterparty, t.ciphertext))) return false;
  }
  return true;
}

/**
 * Whether a login's signer can surface an approval prompt per decrypt.
 *
 * Only remote (NIP-46 `bunker`) and extension (NIP-07 `extension`) signers hand
 * each decrypt to something outside the app that may ask the user. A local
 * `nsec` decrypts inline with the in-memory key — instant, silent, no approval
 * — so gating it would prompt about a cost that doesn't exist. Anything unknown
 * is treated conservatively as "can prompt".
 */
export function signerNeedsApproval(method: string | undefined): boolean {
  return method !== "nsec";
}
