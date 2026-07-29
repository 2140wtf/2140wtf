import { useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { deriveNutzapKey, normalizeMintUrl } from '@/lib/cashu/cashu';
import { devLog } from '@/lib/cashu/devLog';

const NUTZAP_PAYMENT_KIND = 9321;

function dedupeMintUrls(mints: Array<{ url: string; name?: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of mints) {
    if (!m?.url) continue;
    const url = m.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.sort();
}

/**
 * Subscribe to incoming NIP-61 Nutzap payments (kind:9321).
 *
 * - Derives the Nutzap keypair from the wallet seed (used by the receiver ad
 *   published elsewhere).
 * - Listens for kind:9321 events tagged with the user's identity pubkey (`#p`)
 *   and one of the configured mint URLs (`#u`).
 * - Calls `onNutzap` for every new event so the wallet can redeem it.
 *
 * The subscription runs until the component unmounts. It reconnects with a short
 * backoff after errors or unexpected completion so Nutzaps are not silently
 * missed after the first minute.
 */
export function useNutzapReceiver(
  seedPhrase: string,
  mints: Array<{ name: string; url: string }>,
  onNutzap?: (event: NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();

  const keyPairRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const onNutzapRef = useRef(onNutzap);
  onNutzapRef.current = onNutzap;

  useEffect(() => {
    if (!seedPhrase) {
      keyPairRef.current = null;
      return;
    }
    try {
      keyPairRef.current = deriveNutzapKey(seedPhrase);
    } catch (e) {
      devLog.error('Failed to derive nutzap key:', e);
      keyPairRef.current = null;
    }
  }, [seedPhrase]);

  const mintUrls = useMemo(() => dedupeMintUrls(mints), [mints]);

  useEffect(() => {
    if (!user || !onNutzap || mintUrls.length === 0) return;

    // Relay `#u` filters match the tag string EXACTLY. Lowercasing the whole
    // URL (the old behavior) breaks mints with case-sensitive paths — our own
    // sender tags `u` with normalizeMintUrl(), which only lowercases the host.
    // Include both the normalized and the raw trimmed form so senders that do
    // not normalize (trailing slash, default port) still match.
    const normalizedMints = [...new Set(
      mintUrls.flatMap((u) => {
        const raw = u.trim();
        const normalized = normalizeMintUrl(raw);
        return normalized && normalized !== raw ? [raw, normalized] : [raw];
      }).filter(Boolean),
    )];
    if (normalizedMints.length === 0) return;

    const filters: NostrFilter[] = [
      { kinds: [NUTZAP_PAYMENT_KIND], '#p': [user.pubkey], '#u': normalizedMints },
    ];

    const controller = new AbortController();
    let active = true;

    const runSubscription = async () => {
      while (active && !controller.signal.aborted) {
        try {
          for await (const msg of nostr.req(filters, { signal: controller.signal })) {
            if (!active || controller.signal.aborted) break;
            if (msg[0] === 'EVENT') {
              onNutzapRef.current?.(msg[2]);
            }
          }
        } catch (e) {
          devLog.warn('Nutzap subscription error:', e);
        }
        if (!active || controller.signal.aborted) break;
        // Brief backoff before reconnecting so a relay error does not spin.
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    };

    void runSubscription();

    return () => {
      active = false;
      controller.abort();
    };
    // onNutzap is intentionally omitted; we use a ref so the subscription does
    // not tear down on every callback identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, mintUrls, nostr]);
}
