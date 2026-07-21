import { useContext } from 'react';

import { CashuWalletContext, type CashuWalletContextValue } from '@/contexts/CashuWalletContext';

/** Read the global Cashu wallet state. Throws if used outside the provider. */
export function useCashuWalletContext(): CashuWalletContextValue {
  const ctx = useContext(CashuWalletContext);
  if (!ctx) {
    throw new Error('useCashuWalletContext must be used within a CashuWalletProvider');
  }
  return ctx;
}
