/**
 * Which relay URLs this runtime can actually open a WebSocket to (#47).
 *
 * A Concord community minted against a dev/LAN relay embeds `ws://` URLs in
 * its invites verbatim (the CORD-05 wire format carries them, and must — the
 * relay list IS the community's home). But a `ws://` socket is mixed content
 * on any secure origin: the Android APK's WebView runs at `https://localhost`
 * with `allowMixedContent: false`, so every non-loopback `ws://` connection is
 * silently blocked and the community is dead on arrival — no receive, no
 * send, no error. These helpers let the mint and join paths surface that
 * instead of failing silently.
 */

/** The page protocol governing mixed-content rules (injectable for tests). */
function pageProtocol(): string {
  return typeof window !== "undefined" ? window.location.protocol : "";
}

/** True when this runtime can open a WebSocket to `url`. */
export function relayUsableHere(url: string, protocol: string = pageProtocol()): boolean {
  if (/^wss:\/\//i.test(url)) return true;
  if (!/^ws:\/\//i.test(url)) return false;
  // ws:// is fine from an insecure page (the localhost/LAN quickstart), and
  // loopback is exempt from mixed-content blocking even on secure origins.
  if (protocol === "") return true; // SSR/tests: nothing to judge
  if (protocol === "http:") return true;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * A human-readable reason why NONE of `relays` are usable on this platform,
 * or null when at least one is. Meant for join/preview flows so a dead-on-
 * arrival community produces an actionable error instead of silence.
 */
export function unusableRelaysReason(relays: string[], protocol: string = pageProtocol()): string | null {
  if (relays.length === 0) return "This community lists no relays.";
  if (relays.some((url) => relayUsableHere(url, protocol))) return null;
  const sample = relays[0];
  return (
    `None of this community's relays are reachable from this app: insecure ` +
    `relays (like ${sample}) are blocked on this platform. Ask the community ` +
    `owner to host it on a wss:// relay.`
  );
}

/** The subset of `relays` that are NOT usable here (for mint-time warnings). */
export function unusableRelaysHere(relays: string[], protocol: string = pageProtocol()): string[] {
  return relays.filter((url) => !relayUsableHere(url, protocol));
}

/**
 * Relay pick for a NEW community: prefer the `wss://` subset so no member is
 * locked out, regardless of where the CREATOR happens to be running. Usability
 * here is about every future member's platform, not this page's protocol — a
 * creator on plain-http dev can open `ws://localhost:5577` just fine, but a
 * community minted with it is dead on arrival for every APK/https member
 * (#47). Falls back to the full list only when it contains no `wss://` relay
 * at all (a deliberate all-local deployment) — creating must not be blocked by
 * a stray dev relay, just cleaned of it.
 */
export function preferPortableRelays(relays: string[]): string[] {
  const wss = relays.filter((url) => /^wss:\/\//i.test(url));
  return wss.length > 0 ? wss : relays;
}
