import { useMutation } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import {
  createEsploraVerifier,
  verifyBond,
  type StakeCommitment,
} from '@bao/frost-court';

export interface BondEscrowInput {
  readonly disputeId: string;
  readonly marketId?: string;
  readonly bondAmountSats: number;
  readonly bondAddress: string;
  readonly bondTxid?: string;
  readonly bondVout?: number;
  readonly rail?: string;
  readonly requiredBondSats?: number;
  readonly minConfirmations?: number;
}

function buildStakeCommitment(input: BondEscrowInput): StakeCommitment {
  return {
    amountSats: input.bondAmountSats,
    bondAddress: input.bondAddress,
    bondTxid: input.bondTxid,
    bondVout: input.bondVout,
    status: 'pending',
    committedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Verify a juror bond UTXO and return a confirmed `StakeCommitment`.
 *
 * For Bitcoin / Liquid rails the hook queries the configured BAO custom signet
 * Esplora endpoint and validates the UTXO amount and confirmations. For rails
 * that are still demo placeholders it returns a mock confirmed commitment and
 * logs a warning.
 */
export function useBondEscrow() {
  const { config } = useAppContext();

  return useMutation<StakeCommitment, Error, BondEscrowInput>({
    mutationFn: async (input) => {
      const commitment = buildStakeCommitment(input);
      const rail = input.rail?.toLowerCase() ?? 'bitcoin';

      if (rail === 'bitcoin' || rail === 'liquid') {
        if (!commitment.bondTxid || commitment.bondVout === undefined) {
          throw new Error(`Real ${rail} bond verification requires a txid and vout.`);
        }

        const esploraUrl = config.baoCustomSignetEsploraUrl;
        if (!esploraUrl) {
          throw new Error('BAO custom signet Esplora URL is not configured.');
        }
        const verifier = createEsploraVerifier(esploraUrl);
        const result = await verifyBond({
          commitment,
          minAmountSats: input.requiredBondSats ?? input.bondAmountSats,
          minConfirmations: input.minConfirmations ?? 1,
          verifier,
        });

        if (!result.valid) {
          throw new Error(result.error ?? 'Bond verification failed');
        }

        return {
          ...commitment,
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
        } as StakeCommitment;
      }

      // Demo / unsupported rails: fall back to a mock confirmed commitment so
      // the rest of the registration flow can still be exercised.
      console.warn(`[useBondEscrow] Rail "${rail}" is not chain-verified yet; using mock confirmation.`);
      return {
        ...commitment,
        status: 'confirmed',
        confirmedAt: Math.floor(Date.now() / 1000),
      } as StakeCommitment;
    },
  });
}
