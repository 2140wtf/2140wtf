/**
 * Publish timeout budget, scaled to the active signer (#51).
 *
 * A publish is not just one relay round-trip: on an auth-gating relay the
 * EVENT can be rejected `auth-required`, triggering a NIP-42 kind-22242 sign
 * + AUTH + re-send inside the same await. With a local signer that's
 * milliseconds; with a remote NIP-46 bunker each sign is a relay round-trip
 * of its own, and on a lossy link (degraded Wi-Fi, mobile) sign + AUTH +
 * publish routinely exceeds 8s — sends then "fail" in bulk with timeouts even
 * though every step eventually succeeds, and the outbox has to recover them.
 */

/** Default publish budget for local (nsec/extension) signers. */
const LOCAL_TIMEOUT_MS = 8_000;
/** Budget when signing rides a remote NIP-46 bunker round-trip. */
const REMOTE_TIMEOUT_MS = 30_000;

/**
 * The publish timeout for the given login/signer method (`NUser["method"]`,
 * e.g. "nsec" | "bunker" | "extension"). Unknown/absent methods get the
 * remote budget — timing out a slow-but-succeeding publish is worse than
 * waiting a little longer for a genuinely dead one.
 */
export function publishTimeoutMs(method: string | undefined): number {
  if (method === "nsec" || method === "extension") return LOCAL_TIMEOUT_MS;
  return REMOTE_TIMEOUT_MS;
}
