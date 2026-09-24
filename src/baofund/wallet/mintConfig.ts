/**
 * Mint endpoints are deployment config, not code: the primary mint comes from
 * `VITE_BAO_MINT_URL` and falls back to a public MAINNET mint. Never point the
 * fallback at a test-network mint: the wallet is presented as real money and
 * a signet/regtest mint would produce worthless ecash (and invoices no real
 * Lightning wallet can pay). Extra mints may be listed after the first
 * (comma/space/newline separated) for multi-mint support.
 *
 * The relay-hosted BAO mint (`relay.bao.network/cashu`) is a SIGNET test mint
 * used only by the markets CBANOS settlement tests; it must never be a Fund
 * default.
 */

export const FALLBACK_MINT_URL = 'https://mint.minibits.cash/Bitcoin';

const MAX_MINT_URLS = 8;
const MAX_MINT_URL_LENGTH = 512;

/**
 * Hosts that must never become the wallet's mint: `relay.bao.network/cashu`
 * is the BAO SIGNET test mint (markets CBANOS settlement only). Owner rule
 * 2026-09-21: no signet Cashu wallet anywhere - a stale env var must not
 * silently reopen the test mint.
 */
const BLOCKED_MINT_HOSTS = new Set(['relay.bao.network']);

/**
 * Hostname of a URL, lowercased and with the DNS root dot removed, so
 * `relay.bao.network.` (the same host over DNS) cannot slip past the blocklist.
 * Null for unparseable input.
 */
function normalizedHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** True for hosts that must never become the wallet's mint (signet/regtest). */
export function isBlockedMintUrl(url: string): boolean {
  const host = normalizedHost(url);
  return host !== null && BLOCKED_MINT_HOSTS.has(host);
}

export function parseMintUrls(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const candidate = part.trim().replace(/\/+$/, '');
    if (!candidate || candidate.length > MAX_MINT_URL_LENGTH) continue;
    try {
      const url = new URL(candidate);
      if (isBlockedMintUrl(candidate)) continue;
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) continue;
      const normalized = url.toString().replace(/\/+$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= MAX_MINT_URLS) break;
    } catch {
      // Not a URL - skip.
    }
  }
  return out;
}

export const configuredMints: string[] = parseMintUrls(
  (import.meta.env as Record<string, string | undefined>).VITE_BAO_MINT_URL,
);

export const PRIMARY_MINT_URL = configuredMints[0] ?? FALLBACK_MINT_URL;
