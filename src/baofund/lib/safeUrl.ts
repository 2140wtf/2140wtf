// src/lib/safeUrl.ts
//
// URL hardening for API/relay-controlled strings that become hrefs.
// React blocks javascript: hrefs but NOT data:, and a rogue explorer_url must
// never become a clickable non-web URL.
export function safeExplorerHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
