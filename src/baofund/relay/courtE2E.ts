/**
 * courtE2E - bundle entry for `scripts/court-e2e.mjs` (live court acceptance).
 * Re-exports the engine builder and the SAME folds/parsers the app ships, so
 * the probe exercises real code rather than a parallel test copy.
 */
export { buildDisputeEvent } from '@/baofund/court-core/events';
export {
  attestationsFilter,
  canOpenDispute,
  disputesFilter,
  foldDisputeStatus,
} from '../lib/court/disputeStatus';
export { ESCROW_MARKET_PREFIX, escrowMarketId } from '../lib/court/escrowCourt';
