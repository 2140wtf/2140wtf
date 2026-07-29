import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useAppContext } from './useAppContext';
import { createIdentityNip60Signer, type Nip60SyncApi } from '@/lib/cashu/cashuNip60';
import { devLog } from '@/lib/cashu/devLog';

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

    const relays = (config.relayMetadata?.relays ?? [])
      .filter((r) => r.read !== false || r.write !== false)
      .map((r) => r.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0);

    const publish: Nip60SyncApi['publish'] = async (event: NostrEvent) => {
      try {
        await nostr.event(event, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
        return event.id;
      } catch (e) {
        devLog.error('NIP-60 publish failed:', e);
        return null;
      }
    };

    const query: Nip60SyncApi['query'] = async (filter: NostrFilter) => {
      try {
        return await nostr.query([filter], { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) });
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
