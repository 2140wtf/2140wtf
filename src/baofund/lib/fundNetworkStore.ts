/**
 * fundNetworkStore - the runtime demo|testnet selection for the Fund app.
 *
 * The build-time env (`VITE_BAO_FUND_NETWORK`) sets the DEFAULT; the user can
 * switch universes at runtime (persisted in localStorage). Every base, relay
 * and rail lookup goes through here, so ONE deployment serves BOTH:
 *
 *   demo    - the demo API (private signet): custodial demo wallet, fast
 *             faucet claims, instant ledger contributions from demo sats.
 *   testnet - the dedicated non-custodial Fund API (testnet4 / Liquid);
 *             contributions require external escrow.
 */
export type FundNetwork = 'demo' | 'testnet';

const STORAGE_KEY = 'bao.fund.network';
const listeners = new Set<() => void>();

/** Build-time default; read lazily so tests can stub the env per case. */
function envDefault(): FundNetwork {
  const raw = (import.meta.env.VITE_BAO_FUND_NETWORK as string | undefined)?.trim().toLowerCase();
  return raw === 'demo' ? 'demo' : 'testnet';
}

/** The active universe: an explicit runtime choice wins over the env default. */
export function getFundNetwork(): FundNetwork {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'demo' || stored === 'testnet') return stored;
  } catch {
    // Private mode / no storage: fall through to the build default.
  }
  return envDefault();
}

export function setFundNetwork(network: FundNetwork): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, network);
  } catch {
    // Private mode: the choice just does not survive a reload.
  }
  for (const listener of listeners) listener();
}

export function subscribeFundNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Clear the runtime choice (tests / "use the deployment default"). */
export function resetFundNetwork(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const listener of listeners) listener();
}
