import { useNostrLogin } from '@nostrify/react/login';
import { nip19 } from 'nostr-tools';
import { useMemo } from 'react';

import { getBaoMarketIdentityWithProof } from '@/lib/baoMarketIdentity';

export interface MarketIdentityResult {
  pubkey: string;
  proof: string;
  available: boolean;
}

/**
 * Derive an anonymous per-market trading identity for the current user.
 *
 * Only available when the user is logged in with a local nsec. Extension and
 * bunker logins cannot derive a deterministic private key locally, so the
 * trade falls back to the main auth pubkey.
 */
export function useBaoMarketIdentity(marketId: string | undefined): MarketIdentityResult {
  const { logins } = useNostrLogin();

  return useMemo(() => {
    if (!marketId || logins.length === 0) {
      return { pubkey: '', proof: '', available: false };
    }

    const login = logins[0];
    if (login?.type !== 'nsec') {
      return { pubkey: '', proof: '', available: false };
    }

    try {
      const decoded = nip19.decode(login.data.nsec);
      if (decoded.type !== 'nsec') {
        return { pubkey: '', proof: '', available: false };
      }
      const masterPrivkey = Array.from(decoded.data)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const identity = getBaoMarketIdentityWithProof(masterPrivkey, marketId);
      return { pubkey: identity.pubkey, proof: identity.proof, available: true };
    } catch {
      return { pubkey: '', proof: '', available: false };
    }
  }, [logins, marketId]);
}
