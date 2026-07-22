import { useMemo } from 'react';

import { useAuthor } from '@/hooks/useAuthor';
import { usePaymentTargets } from '@/hooks/usePaymentTargets';
import { useNutzapInfo, canReceiveNutzap } from '@/hooks/useNutzapInfo';
import { canZap } from '@/lib/canZap';

interface CanReceiveZapsResult {
  /** True when the recipient can receive via Lightning, Bitcoin, or Nutzap. */
  canReceive: boolean;
  /** True while any of the underlying queries is loading for the first time. */
  isLoading: boolean;
  /** Per-rail capability flags. */
  rails: {
    lightning: boolean;
    bitcoin: boolean;
    nutzap: boolean;
  };
}

/**
 * Determine whether a pubkey can receive zaps/tips through any supported rail.
 *
 * Checks, in order of cost:
 *  - Lightning: kind-0 `lud06`/`lud16` or NIP-A3 `lightning` target.
 *  - Bitcoin: NIP-A3 `payto bitcoin` target (`bc1…` or `sp1…`).
 *  - Nutzap: NIP-61 kind 10019 with accepted mints and P2PK pubkey.
 *
 * This is safe to use in feed cards: each query is keyed by pubkey and cached,
 * so repeated authors do not multiply relay traffic.
 */
export function useCanReceiveZaps(pubkey: string | undefined): CanReceiveZapsResult {
  const author = useAuthor(pubkey);
  const { targets: paymentTargets, isLoading: targetsLoading } = usePaymentTargets(pubkey);
  const { data: nutzapInfo, isLoading: nutzapLoading } = useNutzapInfo(pubkey);

  const metadata = author.data?.metadata;

  const rails = useMemo(() => {
    const lightning = canZap(metadata) || paymentTargets.some((t) => t.type === 'lightning' || t.type === 'bolt12');
    const bitcoin = paymentTargets.some((t) => t.type === 'bitcoin');
    const nutzap = canReceiveNutzap(nutzapInfo);
    return { lightning, bitcoin, nutzap };
  }, [metadata, paymentTargets, nutzapInfo]);

  return {
    canReceive: rails.lightning || rails.bitcoin || rails.nutzap,
    isLoading: author.isLoading || targetsLoading || nutzapLoading,
    rails,
  };
}
