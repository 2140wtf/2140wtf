import { normalizeRelayUrl } from "@/lib/platform";

export interface RelayDeletionCapability {
  url: string;
  supported: boolean;
  reason?: "nip-09-not-advertised" | "relay-info-unavailable";
}

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
  if (!infoUrl) return { url, supported: false, reason: "relay-info-unavailable" };

  try {
    const response = await fetcher(infoUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { url, supported: false, reason: "relay-info-unavailable" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      return { url, supported: false, reason: "relay-info-unavailable" };
    }
    const supportedNips = (payload as { supported_nips?: unknown }).supported_nips;
    if (!Array.isArray(supportedNips)) {
      return { url, supported: false, reason: "nip-09-not-advertised" };
    }
    return supportedNips.includes(9)
      ? { url, supported: true }
      : { url, supported: false, reason: "nip-09-not-advertised" };
  } catch {
    return { url, supported: false, reason: "relay-info-unavailable" };
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
