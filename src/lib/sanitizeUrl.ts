/**
 * Validate that a string is a well-formed HTTPS URL.
 *
 * Returns the normalised `href` when valid, or `undefined` otherwise.
 * This **must** be used whenever a URL originates from untrusted Nostr
 * event data (tags, metadata fields, etc.) and will be placed into an
 * `href`, `window.open()`, or `openUrl()` call.  Without this check a
 * malicious `javascript:` URI could execute arbitrary code.
 */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // not a valid URL
  }
  return undefined;
}

/**
 * Returns a safe HTTPS URL only when it points to a host other than the app's
 * own. Used to decide whether to offer an "open externally" affordance: a link
 * back into our own host should navigate in-app, not pop a new tab. Returns
 * `undefined` for same-host, invalid, or non-HTTPS URLs.
 */
export function externalUrl(raw: string | undefined | null): string | undefined {
  const safe = sanitizeUrl(raw);
  if (!safe) return undefined;
  try {
    if (new URL(safe).host === window.location.host) return undefined;
  } catch {
    return undefined;
  }
  return safe;
}

/** Display hostname for a URL (drops a leading `www.`). Falls back to the raw
 *  string when it can't be parsed. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Validate that a relay URL uses a safe WebSocket scheme.
 *
 * Allows `wss://` everywhere and `ws://` only for localhost/loopback so dev
 * relays still work. Rejects `javascript:`, `data:`, and other non-relay URLs.
 */
export function isAllowedRelayUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'wss:') return true;
    if (parsed.protocol === 'ws:' && isLocalhost(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate that an HTTPS API/service URL uses a safe scheme.
 *
 * Allows `https://` everywhere and `http://` only for localhost/loopback. Empty
 * strings are accepted for optional config fields.
 */
export function isAllowedHttpsUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && isLocalhost(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate a share/canonical-origin URL.
 *
 * Must be `https://`, must not contain a path, query, or fragment, and must
 * not include a trailing slash.
 */
export function isAllowedShareOrigin(url: string | undefined | null): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an RFC-6570-style URL template (e.g. CORS proxy, favicon, link
 * preview). Empty strings are allowed. Non-empty templates must begin with an
 * allowed HTTPS (or localhost HTTP) prefix after stripping `{placeholder}`
 * segments, preventing `javascript:` injection via template expansion.
 */
export function isAllowedUrlTemplate(template: string | undefined | null): boolean {
  if (!template) return true;
  const stripped = template.replace(/\{[^}]*\}/g, '').trim();
  if (stripped.startsWith('https://')) return true;
  if (
    stripped.startsWith('http://localhost') ||
    stripped.startsWith('http://127.0.0.1')
  ) {
    return true;
  }
  return false;
}
