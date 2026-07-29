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
export async function baoNip98Header(signer: BaoApiSigner, url: string, method: string): Promise<string> {
  const event = await signer.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method]],
    content: '',
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}
