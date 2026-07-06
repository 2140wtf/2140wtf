import { useMemo } from 'react';
import { useNostrLogin, type NLoginType } from '@nostrify/react/login';
import { nip19 } from 'nostr-tools';

/**
 * Return the raw Nostr secret key bytes for the current login, if the user is
 * logged in with a local nsec. Extension and bunker logins cannot expose their
 * private key, so real juror ceremonies that require NIP-44 share encryption
 * currently require an nsec login.
 */
export function useUserSeckey(): Uint8Array | undefined {
  const { logins } = useNostrLogin();

  return useMemo(() => {
    const login = logins[0] as NLoginType | undefined;
    if (!login) return undefined;

    if (login.type === 'nsec') {
      try {
        const decoded = nip19.decode(login.data.nsec);
        if (decoded.type === 'nsec' && decoded.data instanceof Uint8Array) {
          return new Uint8Array(decoded.data);
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }, [logins]);
}
