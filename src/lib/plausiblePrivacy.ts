export interface AnalyticsRequest {
  n: string;
  u: string;
  d: string;
  r?: string | null;
}

const PRIVATE_PATHS = [
  /^\/bao\/c(?:\/|$)/i,
  /^\/bao\/invite(?:\/|$)/i,
  /^\/invite(?:\/|$)/i,
];

const PRIVATE_PATH_SUBSTRINGS = [
  /\/bao\/c(?:\/|[?#\s]|$)/i,
  /\/bao\/invite(?:\/|[?#\s]|$)/i,
  /\/invite(?:\/|[?#\s]|$)/i,
];

export function isPrivateRouteUrl(raw: string): boolean {
  try {
    const url = new URL(raw, "https://local.invalid");
    return PRIVATE_PATHS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

/** Find a private route anywhere in a telemetry payload; fail closed upstream. */
export function containsPrivateRoute(value: unknown): boolean {
  if (typeof value === "string") {
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      // Keep malformed input unchanged and still scan it fail-closed.
    }
    return isPrivateRouteUrl(decoded) || PRIVATE_PATH_SUBSTRINGS.some((pattern) => pattern.test(decoded));
  }
  if (Array.isArray(value)) return value.some(containsPrivateRoute);
  if (value && typeof value === "object") return Object.values(value).some(containsPrivateRoute);
  return false;
}

/** Prevent private route identifiers and navigation provenance reaching analytics. */
export function sanitizePlausibleRequest<T extends AnalyticsRequest>(payload: T): T | null {
  try {
    const url = new URL(payload.u);
    if (isPrivateRouteUrl(url.href)) return null;

    return {
      ...payload,
      u: `${url.origin}${url.pathname}`,
      r: null,
    };
  } catch {
    return null;
  }
}
