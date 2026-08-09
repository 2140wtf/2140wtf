import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { createIdentityNip60Signer, type Nip60SyncApi } from '@/lib/cashu/cashuNip60';
import { devLog } from '@/lib/cashu/devLog';
import { BAO_MARKETS_RELAY } from '@/lib/baoRelayMarkets';

const PUBLISH_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 8_000;

/** Build a NIP-60 sync adapter for the currently logged-in user.
 *
 * Returns `undefined` when the user is not logged in or the signer does not
 * support NIP-44.
 */
export function useNip60Sync(): Nip60SyncApi | undefined {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();

  return useMemo(() => {
    if (!user) return undefined;
    if (!user.signer.nip44) {
      devLog.warn('Current signer does not support NIP-44; NIP-60 sync disabled.');
      return undefined;
    }

    const signer = createIdentityNip60Signer(user);

    const baoRelay = BAO_MARKETS_RELAY.replace(/\/+$/, '').toLowerCase();
    const configuredRelays = (config.relayMetadata?.relays ?? [])
      .filter((relay) => typeof relay.url === 'string' && relay.url.length > 0)
      // The BAO demo wallet uses a flat kind:17375 on its own relay. Keeping
      // the main wallet off that relay prevents either replaceable config from
      // overwriting the other when a user adds relay.bao.network to NIP-65.
      .filter((relay) => relay.url.replace(/\/+$/, '').toLowerCase() !== baoRelay);
    const readRelays = configuredRelays.filter((relay) => relay.read !== false).map((relay) => relay.url);
    const writeRelays = configuredRelays.filter((relay) => relay.write !== false).map((relay) => relay.url);
    const relays = [...new Set([...readRelays, ...writeRelays])];

    const publish: Nip60SyncApi['publish'] = async (event: NostrEvent) => {
      if (writeRelays.length === 0) return null;
      try {
        await nostr.group(writeRelays).event(event, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
        return event.id;
      } catch (e) {
        devLog.error('NIP-60 publish failed:', e);
        return null;
      }
    };

    const query: Nip60SyncApi['query'] = async (filter: NostrFilter) => {
      if (readRelays.length === 0) return [];
      try {
        return await nostr.group(readRelays).query([filter], { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
      } catch (e) {
        devLog.error('NIP-60 query failed:', e);
        return [];
      }
    };

    const queryRelays: NonNullable<Nip60SyncApi['queryRelays']> = async (urls, filter) => {
      try {
        return await nostr.group(urls).query([filter], { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
      } catch (e) {
        devLog.error('NIP-60 targeted relay query failed:', e);
        return [];
      }
    };

    const publishToRelays: NonNullable<Nip60SyncApi['publishToRelays']> = async (urls, event) => {
      try {
        await nostr.group(urls).event(event, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
        return event.id;
      } catch (e) {
        devLog.error('NIP-60 targeted relay publish failed:', e);
        return null;
      }
    };

    return { signer, publish, query, queryRelays, publishToRelays, relays };
  }, [user, nostr, config.relayMetadata?.relays]);
}
