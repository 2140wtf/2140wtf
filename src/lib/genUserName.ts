/**
 * Generate a short display fallback for a pubkey when no profile is available.
 */
export function genUserName(pubkey: string): string {
  return `anon-${pubkey.slice(0, 8)}`;
}
