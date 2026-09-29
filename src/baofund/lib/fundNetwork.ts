/**
 * fundNetwork - the universe switch for the BAO Fund surface.
 *
 * demo   : the BAO demo universe (private signet). Campaigns, the custodial
 *          demo wallet, the faucet and every demo rail live on the shared
 *          demo API, so contributions settle instantly from demo coins.
 * testnet: the dedicated, non-custodial BAO Fund API (testnet4 / Liquid
 *          testnet). Contributions require external escrow; no faucet, no
 *          custody (assertNonCustodialConfig fails closed there).
 *
 * Selection is runtime (see fundNetworkStore.ts): `VITE_BAO_FUND_NETWORK`
 * sets the build default, and the user can switch universes with the toggle.
 * Every consumer reads the base from here, so a request can never mix the two
 * universes.
 */
import { getFundNetwork } from './fundNetworkStore';
import type { FundNetwork } from './fundNetworkStore';

export type { FundNetwork };

/** The demo universe API (BAO_NETWORK=demo on the shared demo deployment). */
export const DEMO_FUND_API_BASE = 'https://relay.bao.network/bao-api';

/** The rails the demo universe can settle a contribution from, in preference
 *  order. Lightning is the fast custodial rail (near-instant claims and
 *  internal ledger settlement); cashu/ecash are the ecash ledgers. */
export const DEMO_LEDGER_RAILS = ['lightning', 'cashu', 'ecash'] as const;
export type DemoLedgerRail = (typeof DEMO_LEDGER_RAILS)[number];

/** Rails the demo faucet can credit, in preference order (LNbits lightning is
 *  the fast path; cashu/ecash depend on the signet mint/federation). */
export const DEMO_FAUCET_RAILS = ['lightning', 'cashu', 'ecash'] as const;
export type DemoFaucetRail = (typeof DEMO_FAUCET_RAILS)[number];

export function fundNetwork(): FundNetwork {
  return getFundNetwork();
}

export function isDemoNetwork(): boolean {
  return fundNetwork() === 'demo';
}

/** API origin (no trailing slash, no /v1) for the selected universe. */
export function fundNetworkApiBase(): string {
  if (isDemoNetwork()) {
    const fromEnv = (import.meta.env.VITE_BAO_FUND_DEMO_API_URL as string | undefined)?.replace(/\/+$/, '');
    return fromEnv || DEMO_FUND_API_BASE;
  }
  const fromEnv = (import.meta.env.VITE_BAO_FUND_API_URL as string | undefined)?.replace(/\/+$/, '');
  return fromEnv || '/fund-api';
}
