/**
 * Shared NIP-98 (kind:27235) HTTP auth for the bao.markets API.
 *
 * The API accepts `Authorization: Nostr <base64-event>` where the event's
 * `u` tag is the full request URL and `method` the HTTP method. Signing is
 * all it needs, so any signer works — including NIP-46 bunkers and NIP-07
 * extensions where no private key is available locally.
 */

export interface BaoApiSigner {
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }>;
}

/** Build the `Authorization` header value for a NIP-98 authenticated call. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function baoNip98Header(signer: BaoApiSigner, url: string, method: string, body?: string): Promise<string> {
  const payloadHash = body === undefined ? undefined : await sha256Hex(body);
  // A body-bound authorization event may only be reused for the exact same
  // payload. Always mint a fresh event: some API deployments reject a reused
  // authorization event even while it remains inside the NIP-98 time window.
  const tags = [['u', url], ['method', method.toUpperCase()]];
  if (payloadHash) tags.push(['payload', payloadHash]);
  const event = await signer.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}
