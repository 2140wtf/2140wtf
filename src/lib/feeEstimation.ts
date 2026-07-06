/**
 * Shared fee-estimation constants and helpers.
 *
 * Kept in a separate module to avoid a circular import between
 * `bitcoin.ts` and `hdWallet.ts`.
 */

/** Standard Bitcoin dust limit in satoshis. */
export const DUST_LIMIT = 546;

/** Estimated vBytes per P2TR input. */
export const VBYTES_PER_INPUT = 57.5;

/** Estimated vBytes per P2TR output. */
export const VBYTES_PER_OUTPUT = 43;

/** Estimated vBytes for transaction overhead (version, locktime, etc.). */
export const VBYTES_OVERHEAD = 10.5;

/**
 * Estimate the fee for a P2TR transaction in satoshis.
 *
 * @param numInputs  Number of Taproot inputs.
 * @param numOutputs Number of outputs (recipient + optional change).
 * @param feeRate    Fee rate in sat/vB.
 */
export function estimateFee(numInputs: number, numOutputs: number, feeRate: number): number {
  const vBytes = numInputs * VBYTES_PER_INPUT + numOutputs * VBYTES_PER_OUTPUT + VBYTES_OVERHEAD;
  return Math.ceil(vBytes * feeRate);
}

/**
 * Estimate the fee for a transaction that may or may not need a change output.
 *
 * First assumes a change output; if the resulting change is below the dust
 * limit, it re-estimates without one. This mirrors the dust-aware logic used
 * by the PSBT builders and prevents pre-checks from rejecting valid spends
 * where the change would be dropped.
 *
 * @param numInputs Number of transaction inputs.
 * @param numRecipients Number of recipient outputs.
 * @param feeRate Fee rate in sat/vB.
 * @param totalInput Total input value in sats.
 * @param totalOut Total value going to recipients in sats.
 */
export function estimateFeeWithDustChange(
  numInputs: number,
  numRecipients: number,
  feeRate: number,
  totalInput: number,
  totalOut: number,
): { fee: number; hasChange: boolean } {
  const feeWithChange = estimateFee(numInputs, numRecipients + 1, feeRate);
  const changeWithChange = totalInput - totalOut - feeWithChange;
  if (changeWithChange >= DUST_LIMIT) {
    return { fee: feeWithChange, hasChange: true };
  }
  const feeNoChange = estimateFee(numInputs, numRecipients, feeRate);
  return { fee: feeNoChange, hasChange: false };
}
