/**
 * BAO network selector for the client.
 *
 * Demo and public testnet are separate deployments with different API bases,
 * relays and market `n` tags. The selection is persisted and applied by a
 * reload so every existing query/market/wallet path uses the same network
 * without threading a new context through the whole app.
 */
export type BaoNetworkId = 'demo' | 'testnet';

export interface BaoNetworkEndpoints {
  /** REST base INCLUDING `/v1` for the markets API. */
  api: string;
  /** Fund API base WITHOUT `/v1` (fundraising appends its own paths). */
  fundApi: string;
  /** Relay carrying kind-38000 market definitions and BAO events. */
  relay: string;
  /** Value of the market `n`/`network` tag. */
  marketNetwork: string;
  label: string;
}

const DEMO: BaoNetworkEndpoints = {
  api: 'https://relay.bao.network/bao-api/v1',
  fundApi: 'https://relay.bao.network/bao-api',
  relay: 'wss://relay.bao.network',
  marketNetwork: 'demo',
  label: 'Demo',
};

// The dotted `api.testnet.bao.network` / `relay.testnet.bao.network` names
// retired with the bao.network domain (2026-11-04) and are NXDOMAIN; the
// hyphenated bao.markets pair is the live testnet deployment. Pointing at the
// dotted names left the testnet picker with no API and an unconnectable relay.
const TESTNET: BaoNetworkEndpoints = {
  api: 'https://api-testnet.bao.markets/v1',
  fundApi: 'https://api-testnet.bao.markets',
  relay: 'wss://relay-testnet.bao.markets',
  marketNetwork: 'testnet',
  label: 'Testnet',
};

const STORAGE_KEY = 'bao:network:v1';

export function getBaoNetwork(): BaoNetworkId {
  if (typeof window === 'undefined') return 'demo';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('network');
    if (fromQuery === 'demo' || fromQuery === 'testnet') return fromQuery;
    return localStorage.getItem(STORAGE_KEY) === 'testnet' ? 'testnet' : 'demo';
  } catch {
    return 'demo';
  }
}

export function baoNetworkEndpoints(id: BaoNetworkId = getBaoNetwork()): BaoNetworkEndpoints {
  return id === 'testnet' ? TESTNET : DEMO;
}

/** Persist the choice and reload so every data path re-reads the endpoints. */
export function setBaoNetwork(id: BaoNetworkId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set('network', id);
    window.location.assign(url.toString());
  } catch {
    /* storage unavailable — the query parameter is the fallback */
  }
}
