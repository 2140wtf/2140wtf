export interface AnalyticsRequest {
  n: string;
  u: string;
  d: string;
  r?: string | null;
}

const PRIVATE_PATHS = [
  /^\/bao\/c(?:\/|$)/,
  /^\/bao\/invite(?:\/|$)/,
  /^\/invite(?:\/|$)/,
];

/** Prevent private route identifiers and navigation provenance reaching analytics. */
export function sanitizePlausibleRequest<T extends AnalyticsRequest>(payload: T): T | null {
  try {
    const url = new URL(payload.u);
    if (PRIVATE_PATHS.some((pattern) => pattern.test(url.pathname))) return null;

    return {
      ...payload,
      u: `${url.origin}${url.pathname}`,
      r: null,
    };
  } catch {
    return null;
  }
}
