import type { BaoWalletBalances } from '@/lib/baoWalletApi';

export type WalletRailId =
  | 'lightning'
  | 'cashu'
  | 'liquid'
  | 'spark'
  | 'ark'
  | 'fedimint'
  | 'l1';

/** Map a rail id to its displayed balance.
 *
 * When the bao.markets balance response is available, every tile shows that
 * same custodial ledger. Cashu falls back to the local NIP-60 balance only
 * while the remote response is unavailable, so the tiles and headline never
 * present two different sources as if they were one wallet.
 */
export function getRailBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): number {
  switch (railId) {
    case 'cashu':
      return apiBalances?.cashu ?? localCashuBalance;
    case 'lightning':
      return apiBalances?.lightning ?? 0;
    case 'liquid':
      return apiBalances?.liquid ?? 0;
    case 'spark':
      return apiBalances?.spark ?? 0;
    case 'ark':
      return apiBalances?.ark ?? 0;
    case 'fedimint':
      return apiBalances?.ecash ?? 0;
    case 'l1':
      return apiBalances?.l1 ?? 0;
    default:
      return 0;
  }
}

/** Text shown on a rail tile: the balance line plus an optional qualifier. */
export interface RailTileBalance {
  /** Main balance line, e.g. "42 sats" or "—" when the API balance is unknown. */
  main: string;
  /** Qualifier shown under the balance, e.g. "on bao.markets". */
  sub?: string;
}

/**
 * Balance text for a rail tile.
 *
 * The Cashu tile shows the custodial bao.markets balance when available and
 * falls back to the local balance while it is loading. The Lightning tile
 * shows the custodial bao.markets balance with an "on
 * bao.markets" qualifier, because its panel pays via the user's external
 * NWC/WebLN wallet and cannot touch the displayed custodial sats.
 */
export function getRailTileBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): RailTileBalance {
  if (!apiBalances) {
    return railId === 'cashu' ? { main: `${localCashuBalance} sats` } : { main: '—' };
  }
  const sats = getRailBalance(railId, apiBalances, localCashuBalance);
  if (railId === 'lightning') {
    return { main: `${sats} sats`, sub: 'on bao.markets' };
  }
  return { main: `${sats} sats` };
}
