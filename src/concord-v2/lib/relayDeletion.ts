import { normalizeRelayUrl } from "@/lib/platform";
import { BAO_MARKETS_RELAY } from "@/lib/baoRelayMarkets";

export interface RelayDeletionCapability {
  url: string;
  supported: boolean;
  reason?: "nip-09-not-advertised" | "relay-info-unavailable";
  /**
   * Set when a first-party attestation substituted for a NIP-11 document the
   * browser could not read. Never set when a readable document answered.
   */
  attestation?: "first-party-attested";
}

/**
 * First-party BAO relays whose NIP-09 deletion support is attested by the
 * operator out-of-band. relay.bao.network's NIP-11 document DOES advertise
 * NIP-09, but its GET response lacks an Access-Control-Allow-Origin header,
 * so every browser fetch of it fails and the fail-closed check below would
 * exclude the app's own relay. The attestation covers ONLY that transport
 * failure: a readable document still wins, including fail-closed when the
 * document omits NIP-09.
 */
export const FIRST_PARTY_DELETION_CAPABLE_RELAYS: readonly string[] = [BAO_MARKETS_RELAY];

type RelayInfoFetch = typeof fetch;

function relayInfoUrl(relayUrl: string): string | undefined {
  const normalized = normalizeRelayUrl(relayUrl);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Fail-closed NIP-11 check for BAO home relays. A relay is purge-compatible
 * only when its own information document advertises NIP-09; accepting an
 * arbitrary kind-5 event does not prove that the relay applies deletions.
 */
export async function relayDeletionCapability(
  relayUrl: string,
  fetcher: RelayInfoFetch = fetch,
): Promise<RelayDeletionCapability> {
  const url = normalizeRelayUrl(relayUrl) ?? relayUrl;
  const infoUrl = relayInfoUrl(url);
  // Transport failure: fail closed for arbitrary relays, but accept the
  // operator's out-of-band attestation for first-party BAO relays.
  const unavailable = (): RelayDeletionCapability =>
    FIRST_PARTY_DELETION_CAPABLE_RELAYS.some((relay) => normalizeRelayUrl(relay) === url)
      ? { url, supported: true, attestation: "first-party-attested" }
      : { url, supported: false, reason: "relay-info-unavailable" };

  if (!infoUrl) return unavailable();

  try {
    const response = await fetcher(infoUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return unavailable();
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      return unavailable();
    }
    const supportedNips = (payload as { supported_nips?: unknown }).supported_nips;
    if (!Array.isArray(supportedNips)) return { url, supported: false, reason: "nip-09-not-advertised" };
    return supportedNips.includes(9)
      ? { url, supported: true }
      : { url, supported: false, reason: "nip-09-not-advertised" };
  } catch {
    return unavailable();
  }
}

export async function partitionDeletionCapableRelays(
  relayUrls: string[],
  fetcher: RelayInfoFetch = fetch,
): Promise<{ supported: string[]; excluded: RelayDeletionCapability[] }> {
  const unique = [...new Set(relayUrls.map((url) => normalizeRelayUrl(url)).filter((url): url is string => Boolean(url)))];
  const capabilities = await Promise.all(unique.map((url) => relayDeletionCapability(url, fetcher)));
  return {
    supported: capabilities.filter((capability) => capability.supported).map((capability) => capability.url),
    excluded: capabilities.filter((capability) => !capability.supported),
  };
}
