/**
 * fal.live — AI image/video generation client.
 *
 * fal.ai sends `X-Frame-Options: DENY` and no CORS headers, so direct
 * iframing/fetching from the browser is blocked. The bao-fal-proxy
 * Cloudflare Worker (FAL_PROXY_URL) strips those headers for iframe embeds
 * and adds CORS headers for the REST API, mirroring the Lightning
 * Observatory proxy pattern (bao-lo-proxy).
 *
 * Fetch order: same-origin `/fal-api/*` (vite dev/preview proxy or a
 * production host rule) → worker proxy → public host (works if fal.ai
 * ever enables CORS).
 */

export const FAL_API_BASE = '/fal-api';
export const FAL_PUBLIC_BASE = 'https://fal.ai';

export const FAL_LIVE_URL = 'https://fal.live/';

/** Origin of the bao-fal-proxy Cloudflare Worker. The proxy strips fal.ai's
 * X-Frame-Options/frame-ancestors so the studio can be iframed, adds CORS
 * headers to the REST API, and streams results. Override with
 * VITE_FAL_PROXY_URL (e.g. for a locally running wrangler dev). */
export const FAL_PROXY_URL: string =
  (import.meta.env.VITE_FAL_PROXY_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://bao-fal-proxy.hello-cbd.workers.dev';

/** Fetch a path from the proxied fal API first, falling back to the
 * CORS-enabled bao-fal-proxy worker and then the public host. Mirrors
 * `loApiFetch` in lightningObservatory.ts. */
export async function falApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const candidates = [
    `${FAL_API_BASE}${path}`,
    `${FAL_PROXY_URL}${path}`,
    `${FAL_PUBLIC_BASE}${path}`,
  ];

  let res: Response | null = null;
  for (const url of candidates) {
    try {
      const attempt = await fetch(url, { signal });
      const contentType = attempt.headers.get('content-type') ?? '';
      if (attempt.ok && contentType.includes('application/json')) {
        res = attempt;
        break;
      }
    } catch {
      // try the next candidate
    }
  }

  if (!res || !res.ok) {
    throw new Error(`fal API returned ${res?.status ?? 'no response'}`);
  }

  return res;
}
