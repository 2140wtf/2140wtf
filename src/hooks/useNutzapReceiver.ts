import { useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { usePublishPreferences } from './usePublishPreferences';
import { deriveNutzapKey } from '@/lib/cashu/cashu';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';
import { devLog } from '@/lib/cashu/devLog';

const NUTZAP_KIND = 10019;

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
 * Manage the public NIP-61 Nutzap receiver advertisement (kind:10019).
 *
 * - When the `nutzaps` preference is enabled, publishes/updates a kind:10019
 *   event listing the user's accepted mints, read relays, and nutzap pubkey.
 * - When disabled, overwrites any existing kind:10019 with an empty replacement
 *   so relays stop serving the old ad.
 *
 * The nutzap private key is derived from the wallet seed; the pubkey is the
 * only key material that ever leaves the device.
 */
export function useNutzapReceiver(
  seedPhrase: string,
  mints: Array<{ name: string; url: string }>,
  relayUrls: string[],
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { isEnabled } = usePublishPreferences();
  const publish = useNostrPublish();
  const enabled = isEnabled('nutzaps');

  const keyPairRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const lastPublishedRef = useRef<{ enabled: boolean; mints: string[]; pubkey?: string } | null>(null);

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
  const relayList = useMemo(
    () => [...new Set(relayUrls.filter((u) => typeof u === 'string' && u.length > 0))].sort(),
    [relayUrls],
  );

  useEffect(() => {
    if (!user || !keyPairRef.current) return;

    const keyPair = keyPairRef.current;
    const last = lastPublishedRef.current;
    if (
      last &&
      last.enabled === enabled &&
      last.pubkey === keyPair.pubkey &&
      JSON.stringify(last.mints) === JSON.stringify(mintUrls)
    ) {
      return;
    }

    const publishOrClear = async () => {
      try {
        const prev = await fetchFreshEvent(nostr, {
          kinds: [NUTZAP_KIND],
          authors: [user.pubkey],
          limit: 1,
        });

        if (enabled) {
          if (mintUrls.length === 0) {
            devLog.warn('Nutzap receiver enabled but no mints available; skipping publish');
            return;
          }
          const tags: string[][] = [
            ['alt', 'Nutzap receiver preferences'],
            ['pubkey', keyPair.pubkey],
            ...relayList.map((url) => ['relay', url]),
            ...mintUrls.map((url) => ['mint', url, 'sat']),
          ];
          await publish.mutateAsync({ kind: NUTZAP_KIND, content: '', tags, prev: prev ?? undefined });
          lastPublishedRef.current = { enabled: true, mints: mintUrls, pubkey: keyPair.pubkey };
        } else if (prev) {
          // Overwrite the old ad with an empty replacement so it disappears from relays.
          const tags: string[][] = [['alt', 'Nutzap receiver preferences']];
          await publish.mutateAsync({ kind: NUTZAP_KIND, content: '', tags, prev });
          lastPublishedRef.current = { enabled: false, mints: [], pubkey: undefined };
        } else {
          lastPublishedRef.current = { enabled: false, mints: [], pubkey: undefined };
        }
      } catch (e) {
        devLog.error('Failed to publish Nutzap receiver ad:', e);
      }
    };

    publishOrClear();
  }, [enabled, mintUrls, relayList, user, nostr, publish]);
}
