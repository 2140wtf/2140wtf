/**
 * Platform (build-time pinned) configuration for the ₿AO chat (Concord V2)
 * foundation, ported from Armada's `lib/platform.ts`. Only the pieces the
 * wire sync engine and the stream-auth graft need live here:
 *
 * - `normalizeRelayUrl` — shared relay URL normalization.
 * - `APP_RELAYS` — `VITE_APP_RELAYS`, default general-purpose app relays used
 *   as the seed for `AppConfig.appRelays` (Concord communities fall back to
 *   these when a community carries no relay list).
 * - `CONCORD_AV_SERVERS` — `VITE_CONCORD_AV_SERVERS`, blind LiveKit token
 *   broker https origins for Concord voice. The constant is ported now (the
 *   voice UI lands in a later phase).
 */

/** Normalize a relay URL: require ws/wss scheme, strip trailing slash. */
export function normalizeRelayUrl(url: string): string | undefined {
  let value = url.trim();
  if (!value) return undefined;
  if (!/^wss?:\/\//i.test(value)) {
    // Bare hostnames are allowed for convenience; assume wss except localhost/IPs.
    const secure = !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
    value = `${secure ? "wss" : "ws"}://${value}`;
  }
  try {
    const u = new URL(value);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return undefined;
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** Convert a relay websocket URL to its HTTP(S) origin (NIP-11, AV brokers). */
export function relayToHttpUrl(relayUrl: string): string {
  return relayUrl
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/$/, "");
}

/** Relay URL → path segment for chat deep links. */
export function relayToRouteParam(relayUrl: string): string {
  return encodeURIComponent(relayUrl.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "ws:" : "")));
}

/** Path segment → relay URL. `relay.internal` ⇒ wss, `ws:host` ⇒ ws. */
export function routeParamToRelay(param: string): string | undefined {
  const decoded = decodeURIComponent(param);
  if (decoded.startsWith("ws:")) {
    return normalizeRelayUrl(`ws://${decoded.slice(3)}`);
  }
  return normalizeRelayUrl(decoded);
}

/**
 * Default app relays: general-purpose relays used for non-group-scoped ₿AO
 * chat traffic (the Concord V2 community list, invite delivery fallbacks).
 * These seed `AppConfig.appRelays`, which the user can edit in Settings.
 * Defaults mirror the client's search relay set.
 */
export const APP_RELAYS: string[] = (
  import.meta.env.VITE_APP_RELAYS || "wss://relay.ditto.pub,wss://relay.dreamith.to"
)
  .split(",")
  .map((url: string) => normalizeRelayUrl(url))
  .filter((url: string | undefined): url is string => Boolean(url));

/**
 * Default Concord AV brokers (CORD-07 §2): blind LiveKit token brokers (https
 * origins) used to START a call in an empty voice channel — once anyone is in
 * a call, their presence-announced broker is the rendezvous point (§5). The
 * broker authorizes by channel-key-possession proof, not membership, so it
 * learns nothing about the community.
 *
 * Ported as a constant only; the voice UI that consumes it lands in a later
 * phase. Unset defaults to the public Armada instance (the reference broker);
 * operators can override with `VITE_CONCORD_AV_SERVERS` (comma-separated
 * https origins) or set it empty to disable Concord voice.
 */
const DEFAULT_PUBLIC_AV_SERVER = "https://armada.buzz";
export const CONCORD_AV_SERVERS: string[] = (
  import.meta.env.VITE_CONCORD_AV_SERVERS ?? DEFAULT_PUBLIC_AV_SERVER
)
  .split(",")
  .map((s: string) => s.trim())
  .filter((s: string) => Boolean(s));
