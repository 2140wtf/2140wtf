/**
 * Bitcoin helpers — address derivation, balance/tx fetching, fee
 * estimation, PSBT construction & signing, and broadcast.
 *
 * Every fetcher takes an ordered `baseUrls` array (Esplora REST roots, e.g.
 * `['https://mempool.space/api', 'https://blockstream.info/api']`) and routes
 * the request through {@link esploraFetch}, which handles per-attempt
 * timeouts, exponential-backoff cool-downs, and ordered failover across
 * endpoints. Callers can also pass an `AbortSignal` (typically from a
 * TanStack Query `queryFn`) to cancel the inflight request.
 *
 * The mempool.space-specific `/v1/prices` endpoint is the one exception —
 * only `mempool.space`-compatible backends expose it. {@link fetchBtcPrice}
 * configures `skipStatuses: [404]` so non-mempool backends (Blockstream's
 * Esplora) coexist in the list without being penalised.
 */
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { nip19 } from 'nostr-tools';
import { HDKey } from '@scure/bip32';
import { esploraFetch } from './esplora';
import {
  decodeSilentPaymentAddress,
  isSilentPaymentAddress,
  validateSilentPaymentAddress,
  type SilentPaymentAddress,
} from './silentPayments';
import { encodePsbtV2, type PsbtV2Input, type PsbtV2Output } from './psbtV2';
import type { TransactionInputUpdate } from '@scure/btc-signer/psbt.js';
import {
  type DerivedAddress,
  type HdUtxo,
  buildTapBip32Derivation,
  type LegacyUtxo,
} from './hdWallet';
import { DUST_LIMIT, estimateFee } from './feeEstimation';
export { estimateFee, estimateFeeWithDustChange, DUST_LIMIT } from './feeEstimation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sanity cap for fee rate (sat/vB). Prevents accidental or malicious fee drains. */
export const MAX_FEE_RATE_SATS_PER_VB = 10_000;

/**
 * Strict 32-byte hex validator. Rejects anything that isn't exactly 64
 * lowercase-or-uppercase hex characters.
 */
function isValidPubkeyHex(s: string): boolean {
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
}

/**
 * Decode a 32-byte (64-char) hex string to bytes. `@scure/base`'s `hex.decode`
 * only accepts lowercase, so normalise the case first.
 */
function hexToBytes(s: string): Uint8Array {
  return hex.decode(s.toLowerCase());
}

/**
 * Convert a Nostr public key (32-byte hex) to a Bitcoin Taproot (P2TR) address.
 *
 * Both Nostr and Bitcoin Taproot use secp256k1 with 32-byte x-only public keys
 * (Schnorr / BIP-340), so the key can be used directly as a Taproot internal
 * public key with no mathematical conversion.
 *
 * Returns an empty string if the input is malformed or not a valid x-only key
 * on the secp256k1 curve.
 */
export function nostrPubkeyToBitcoinAddress(pubkeyHex: string): string {
  if (!isValidPubkeyHex(pubkeyHex)) return '';

  try {
    const internalPubkey = hexToBytes(pubkeyHex);
    const payment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
    return payment.address || '';
  } catch (error) {
    console.error('Error generating Bitcoin address:', error);
    return '';
  }
}

/**
 * Convert a bech32 `npub1...` identifier to a Bitcoin Taproot (P2TR) address.
 * Decodes the npub to a hex pubkey, then delegates to {@link nostrPubkeyToBitcoinAddress}.
 */
export function npubToBitcoinAddress(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error('Invalid npub format');
  }
  return nostrPubkeyToBitcoinAddress(decoded.data);
}

// ---------------------------------------------------------------------------
// Balance / Address data (wallet page)
// ---------------------------------------------------------------------------

/** Balance data returned by the Esplora API. */
export interface AddressData {
  /** Confirmed on-chain balance in satoshis. */
  balance: number;
  /** Unconfirmed mempool balance in satoshis. */
  pendingBalance: number;
  /** Sum of confirmed + pending balance. */
  totalBalance: number;
  /** Total satoshis ever received (confirmed). */
  totalReceived: number;
  /** Total satoshis ever sent (confirmed). */
  totalSent: number;
  /** Confirmed transaction count. */
  txCount: number;
  /** Pending (mempool) transaction count. */
  pendingTxCount: number;
}

/**
 * Fetch balance and transaction stats for a Bitcoin address from an
 * Esplora-compatible REST API (e.g. mempool.space, Blockstream).
 *
 * @param address    The Bitcoin address to look up.
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchAddressData(
  address: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<AddressData> {
  const response = await esploraFetch(baseUrls, `/address/${address}`, { signal, retryStatuses: [404] });

  if (!response.ok) {
    throw new Error('Failed to fetch balance');
  }

  const data = await response.json();

  const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const pendingBalance = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;

  return {
    balance: confirmedBalance,
    pendingBalance,
    totalBalance: confirmedBalance + pendingBalance,
    totalReceived: data.chain_stats.funded_txo_sum,
    totalSent: data.chain_stats.spent_txo_sum,
    txCount: data.chain_stats.tx_count,
    pendingTxCount: data.mempool_stats.tx_count,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Convert satoshis to a BTC string with up to 8 decimal places. */
export function satsToBTC(sats: number): string {
  return (sats / 100_000_000).toFixed(8);
}

/**
 * Convert satoshis to a BTC string with trailing zeros stripped.
 * E.g. `formatBTC(100_000_000)` → `"1"`, `formatBTC(1_234_560)` → `"0.0123456"`.
 */
export function formatBTC(sats: number): string {
  return satsToBTC(sats).replace(/\.?0+$/, '');
}

/** Format a satoshi amount with locale-aware thousand separators. */
export function formatSats(sats: number): string {
  return sats.toLocaleString();
}

/**
 * Ordered list of public BTC/USD price endpoints used as fallbacks when no
 * configured Esplora backend exposes the mempool.space `/v1/prices` extension.
 *
 * Each entry provides a `url` and a `parse` function that extracts the USD
 * price (as a number) from the JSON response. Endpoints are tried in order;
 * the first successful fetch wins. These are simple unauthenticated public
 * APIs with permissive CORS, chosen for reliability over precision.
 */
interface BtcPriceFallback {
  name: string;
  url: string;
  parse(data: unknown): number | undefined;
}

const BTC_PRICE_FALLBACKS: BtcPriceFallback[] = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/exchange-rates?currency=BTC',
    parse(data) {
      const rates = (data as { data?: { rates?: Record<string, string> } })?.data?.rates;
      const usd = rates?.USD;
      return usd ? Number(usd) : undefined;
    },
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    parse(data) {
      const result = (data as { result?: Record<string, { c?: string[] }> })?.result;
      const pair = result?.XXBTZUSD ?? result?.XBTUSD;
      const last = pair?.c?.[0];
      return last ? Number(last) : undefined;
    },
  },
  {
    name: 'blockchain.info',
    url: 'https://blockchain.info/ticker',
    parse(data) {
      const last = (data as { USD?: { last?: number } })?.USD?.last;
      return last ? Number(last) : undefined;
    },
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse(data) {
      const usd = (data as { bitcoin?: { usd?: number } })?.bitcoin?.usd;
      return usd ? Number(usd) : undefined;
    },
  },
];

async function fetchJsonWithTimeout(url: string, signal?: AbortSignal, timeoutMs = 10_000): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, { signal: composed });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchBtcPriceFromFallbacks(signal?: AbortSignal): Promise<number> {
  const errors: string[] = [];
  for (const fallback of BTC_PRICE_FALLBACKS) {
    try {
      const data = await fetchJsonWithTimeout(fallback.url, signal, 8_000);
      const price = fallback.parse(data);
      if (price && Number.isFinite(price) && price > 0) {
        return price;
      }
      errors.push(`${fallback.name}: unparseable`);
    } catch (err) {
      errors.push(`${fallback.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All BTC price fallbacks failed: ${errors.join('; ')}`);
}

/**
 * Fetch the current BTC price in USD.
 *
 * First tries the configured Esplora APIs (`/v1/prices`), which works on
 * mempool.space-compatible backends. If none of those expose the price
 * endpoint, falls back to public exchange APIs (Coinbase, Kraken,
 * Blockchain.info, CoinGecko).
 *
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchBtcPrice(baseUrls: string[], signal?: AbortSignal): Promise<number> {
  try {
    const response = await esploraFetch(baseUrls, `/v1/prices`, {
      // /v1/prices is a mempool.space extension — 404 means "endpoint doesn't
      // speak this path", not "the endpoint is dead". Soft-failover to the
      // next URL without putting this one in cool-down.
      skipStatuses: [404],
      signal,
    });

    if (response.ok) {
      const data = await response.json();
      const price = Number(data.USD);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {
    // Esplora endpoints failed or don't expose /v1/prices; fall through to
    // public exchange APIs so the marketplace can still show USD prices.
  }

  return fetchBtcPriceFromFallbacks(signal);
}

/** Convert a BTC amount to satoshis (rounded to nearest integer).
 *
 * Uses integer-friendly parsing to avoid IEEE-754 floating-point rounding
 * errors (e.g. 0.00000001 * 1e8 is not exactly 1).
 */
export function btcToSats(btc: number): number {
  if (!Number.isFinite(btc) || btc <= 0) return 0;
  return parseBtcAmountToSats(btc.toFixed(8));
}

/**
 * USD threshold above which Bitcoin send/zap flows require explicit
 * confirmation (two-tap). Chosen to catch meaningful dollar amounts without
 * nagging on everyday $5–$25 zaps.
 */
export const LARGE_AMOUNT_USD_THRESHOLD = 100;

/**
 * Whether a given satoshi amount crosses the "large amount" threshold at the
 * current BTC/USD price. Returns false when `btcPrice` is unavailable, so the
 * UI does not arm confirmation without a known USD value.
 */
export function isLargeAmount(sats: number, btcPrice: number | undefined): boolean {
  if (!btcPrice || !Number.isFinite(btcPrice) || btcPrice <= 0) return false;
  if (!Number.isFinite(sats) || sats <= 0) return false;
  const usd = (sats / 100_000_000) * btcPrice;
  return usd >= LARGE_AMOUNT_USD_THRESHOLD;
}

/** Convert satoshis to USD given a BTC price. */
export function satsToUSD(sats: number, btcPrice: number): string {
  const btc = sats / 100_000_000;
  return (btc * btcPrice).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Wallet-page transaction list (simplified per-address view)
// ---------------------------------------------------------------------------

/** A simplified transaction relevant to a specific address. */
export interface Transaction {
  /** Transaction ID (hex). */
  txid: string;
  /** Net satoshi change for the address (positive = received, negative = sent). */
  amount: number;
  /** Whether this is a receive or send relative to the address. */
  type: 'receive' | 'send';
  /** Whether the transaction is confirmed. */
  confirmed: boolean;
  /** Unix timestamp of the block (undefined if unconfirmed). */
  timestamp?: number;
}

/**
 * Fetch transactions for a Bitcoin address from an Esplora-compatible API.
 * Returns simplified transactions with net amount relative to the address.
 *
 * @param address    The Bitcoin address to look up.
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchTransactions(
  address: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<Transaction[]> {
  const response = await esploraFetch(baseUrls, `/address/${address}/txs`, { signal, retryStatuses: [404] });

  if (!response.ok) {
    throw new Error('Failed to fetch transactions');
  }

  const txs = await response.json();

  return txs.map((tx: Record<string, unknown>) => {
    const vin = tx.vin as Array<{ prevout: { scriptpubkey_address?: string; value: number } | null }>;
    const vout = tx.vout as Array<{ scriptpubkey_address?: string; value: number }>;
    const status = tx.status as { confirmed: boolean; block_time?: number };

    // Sum sats flowing out of this address (inputs we owned)
    const totalIn = vin.reduce((sum, input) => {
      if (input.prevout?.scriptpubkey_address === address) {
        return sum + input.prevout.value;
      }
      return sum;
    }, 0);

    // Sum sats flowing into this address (outputs we own)
    const totalOut = vout.reduce((sum, output) => {
      if (output.scriptpubkey_address === address) {
        return sum + output.value;
      }
      return sum;
    }, 0);

    const net = totalOut - totalIn;

    return {
      txid: tx.txid as string,
      amount: Math.abs(net),
      type: net >= 0 ? 'receive' : 'send',
      confirmed: status.confirmed,
      timestamp: status.block_time,
    } satisfies Transaction;
  });
}

// ---------------------------------------------------------------------------
// Full transaction detail (NIP-73 /i/bitcoin:tx:... page)
// ---------------------------------------------------------------------------

/** A single input in a full transaction. */
export interface TxInput {
  txid: string;
  vout: number;
  address?: string;
  value: number;
  isCoinbase: boolean;
}

/** A single output in a full transaction. */
export interface TxOutput {
  address?: string;
  value: number;
  scriptpubkeyType: string;
  /** True if the output has been spent. */
  spent: boolean;
}

/** Full transaction detail returned by the Esplora API. */
export interface TxDetail {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  confirmed: boolean;
  blockHeight?: number;
  blockHash?: string;
  blockTime?: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  /** Total value of all inputs (sats). */
  totalInput: number;
  /** Total value of all outputs (sats). */
  totalOutput: number;
}

/**
 * Fetch full transaction details from an Esplora-compatible API.
 *
 * @param txid       The transaction ID (hex).
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchTxDetail(
  txid: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<TxDetail> {
  const response = await esploraFetch(baseUrls, `/tx/${txid}`, { signal });
  if (!response.ok) throw new Error('Failed to fetch transaction');

  const tx = await response.json();

  const vin = tx.vin as Array<{
    txid: string;
    vout: number;
    prevout: { scriptpubkey_address?: string; value: number } | null;
    is_coinbase: boolean;
  }>;
  const vout = tx.vout as Array<{
    scriptpubkey_address?: string;
    value: number;
    scriptpubkey_type: string;
  }>;
  const status = tx.status as { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };

  const inputs: TxInput[] = vin.map((input) => ({
    txid: input.txid,
    vout: input.vout,
    address: input.prevout?.scriptpubkey_address,
    value: input.prevout?.value ?? 0,
    isCoinbase: input.is_coinbase,
  }));

  const outputs: TxOutput[] = vout.map((output) => ({
    address: output.scriptpubkey_address,
    value: output.value,
    scriptpubkeyType: output.scriptpubkey_type,
    spent: false, // Esplora /tx endpoint doesn't include spending info
  }));

  const totalInput = inputs.reduce((sum, i) => sum + i.value, 0);
  const totalOutput = outputs.reduce((sum, o) => sum + o.value, 0);

  return {
    txid: tx.txid as string,
    version: tx.version as number,
    locktime: tx.locktime as number,
    size: tx.size as number,
    weight: tx.weight as number,
    fee: tx.fee as number,
    confirmed: status.confirmed,
    blockHeight: status.block_height,
    blockHash: status.block_hash,
    blockTime: status.block_time,
    inputs,
    outputs,
    totalInput,
    totalOutput,
  };
}

// ---------------------------------------------------------------------------
// Full address detail (NIP-73 /i/bitcoin:address:... page)
// ---------------------------------------------------------------------------

/** Full address detail combining balance stats + recent transactions. */
export interface AddressDetail {
  address: string;
  balance: number;
  pendingBalance: number;
  totalBalance: number;
  totalReceived: number;
  totalSent: number;
  txCount: number;
  pendingTxCount: number;
  /** Most recent transactions (up to 25). */
  recentTxs: Transaction[];
}

/**
 * Fetch full address details (balance + recent txs) from an Esplora-compatible API.
 *
 * @param address    The Bitcoin address to look up.
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchAddressDetail(
  address: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<AddressDetail> {
  const [addrData, txs] = await Promise.all([
    fetchAddressData(address, baseUrls, signal),
    fetchTransactions(address, baseUrls, signal),
  ]);

  return {
    address,
    ...addrData,
    recentTxs: txs.slice(0, 25),
  };
}

// ---------------------------------------------------------------------------
// Sending: UTXOs, fee estimation, transaction construction, broadcast
// ---------------------------------------------------------------------------

/** An unspent transaction output. */
export interface UTXO {
  txid: string;
  vout: number;
  /** Value in satoshis. */
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

/**
 * Fetch UTXOs for a Bitcoin address from an Esplora-compatible API.
 *
 * @param address    The Bitcoin address to look up.
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
function isValidUtxo(u: unknown): u is UTXO {
  if (!u || typeof u !== 'object') return false;
  const txid = (u as Record<string, unknown>).txid;
  const vout = (u as Record<string, unknown>).vout;
  const value = (u as Record<string, unknown>).value;
  const status = (u as Record<string, unknown>).status;
  return (
    typeof txid === 'string' &&
    txid.length > 0 &&
    typeof vout === 'number' &&
    Number.isInteger(vout) &&
    vout >= 0 &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    !!status &&
    typeof status === 'object' &&
    typeof (status as Record<string, unknown>).confirmed === 'boolean'
  );
}

export async function fetchUTXOs(
  address: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<UTXO[]> {
  const response = await esploraFetch(baseUrls, `/address/${address}/utxo`, { signal, retryStatuses: [404] });
  if (!response.ok) throw new Error('Failed to fetch UTXOs');
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Invalid UTXO response');
  }
  return data.filter(isValidUtxo);
}

/** Fee rate estimates keyed by confirmation speed. */
export interface FeeRates {
  /** ~10 min / next block (target 1). */
  fastestFee: number;
  /** ~30 min (target 3). */
  halfHourFee: number;
  /** ~1 hour (target 6). */
  hourFee: number;
  /** ~1 day (target 144). */
  economyFee: number;
  /** Minimum relay fee (target 504). */
  minimumFee: number;
}

/**
 * Fetch the current Bitcoin block height from an Esplora-compatible API.
 *
 * Endpoint: `/blocks/tip/height` returns the height of the current chain tip
 * as plain text. Fails over through `baseUrls` using the same cool-down logic
 * as the other Esplora helpers.
 *
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function fetchBlockHeight(baseUrls: string[], signal?: AbortSignal): Promise<number> {
  const response = await esploraFetch(baseUrls, `/blocks/tip/height`, { signal });
  if (!response.ok) throw new Error('Failed to fetch block height');
  const text = await response.text();
  const height = Number(text.trim());
  if (!Number.isFinite(height) || height < 0) throw new Error('Invalid block height response');
  return height;
}

/**
 * Fetch recommended fee rates (sat/vB) from an Esplora-compatible API.
 *
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
const FEE_RATE_TARGETS = ['1', '3', '6', '144', '504'] as const;

function isValidFeeRates(data: unknown): data is Record<string, number> {
  if (!data || typeof data !== 'object') return false;
  return FEE_RATE_TARGETS.every(
    (target) =>
      target in data &&
      typeof (data as Record<string, unknown>)[target] === 'number' &&
      Number.isFinite((data as Record<string, number>)[target]) &&
      (data as Record<string, number>)[target] > 0,
  );
}

export async function getFeeRates(baseUrls: string[], signal?: AbortSignal): Promise<FeeRates> {
  // `/fee-estimates` is always present on a healthy Esplora backend, so a 404
  // never means "not found" — it means the endpoint is misbehaving (notably
  // mempool.space serving 404 instead of 429 to rate-limited mobile clients).
  // Treat it as a retryable failure so we fail over to the next endpoint
  // instead of trusting the 404 and giving up.
  const response = await esploraFetch(baseUrls, `/fee-estimates`, { signal, retryStatuses: [404] });
  if (!response.ok) throw new Error('Failed to fetch fee estimates');

  const data = await response.json();
  if (!isValidFeeRates(data)) {
    throw new Error('Invalid fee estimates response');
  }

  return {
    fastestFee: Math.ceil(data['1']),
    halfHourFee: Math.ceil(data['3']),
    hourFee: Math.ceil(data['6']),
    economyFee: Math.ceil(data['144']),
    minimumFee: Math.ceil(data['504']),
  };
}

/**
 * Validate a Bitcoin address (mainnet). Returns `true` if the address has a
 * valid format and checksum, `false` otherwise.
 */
export function validateBitcoinAddress(address: string): boolean {
  try {
    btc.Address(btc.NETWORK).decode(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsed BIP-21 payment URI.
 *
 * `address` is the on-chain fallback (the URI's path); `sp` is the BIP-352
 * silent payment recipient if the URI included a valid `sp=` parameter;
 * `amountSats` is the BIP-21 `amount=` parameter converted from BTC to
 * satoshis. Other BIP-21 parameters (`label`, `message`, `lightning`, …) are
 * not surfaced — we have no lightning support to fall back to.
 */
export interface ParsedBitcoinUri {
  /** On-chain address from the URI path. May be empty for sp-only URIs. */
  address: string;
  /** BIP-352 silent payment address from the `sp=` parameter, if present. */
  sp?: string;
  /**
   * Amount in satoshis, parsed from the BIP-21 `amount=` parameter (which is
   * specified in BTC). Undefined when the URI has no amount or the value is
   * malformed / non-positive / non-finite. Rounded down to whole sats so we
   * never overstate the requester's intent.
   */
  amountSats?: number;
}

/**
 * Parse a BTC decimal string (e.g. "0.00000001") into an integer number of
 * satoshis without using floating-point multiplication, avoiding rounding
 * errors like `0.00000001 * 1e8 === 0.9999999999999999`. Rejects malformed
 * input, values with more than 8 decimal places, and non-positive amounts.
 * Returns 0 for invalid input.
 */
export function parseBtcAmountToSats(amountRaw: string): number {
  if (!amountRaw || !/^\d+(\.\d{1,8})?$/.test(amountRaw)) return 0;
  const [wholeStr, fracStr = ''] = amountRaw.split('.');
  const whole = Number.parseInt(wholeStr, 10);
  if (!Number.isFinite(whole) || whole < 0) return 0;
  const fracPadded = (fracStr + '00000000').slice(0, 8);
  const frac = Number.parseInt(fracPadded, 10);
  const sats = whole * 100_000_000 + frac;
  return Number.isFinite(sats) && sats > 0 ? sats : 0;
}

/**
 * Parse a `bitcoin:` BIP-21 URI without committing to any particular address
 * format. Returns `null` for anything that isn't `bitcoin:…`.
 *
 * The scheme check is case-insensitive (`bitcoin:` and `BITCOIN:` both parse).
 * Validation of the address/sp values is left to the caller — this helper
 * just splits the URI into its parts.
 */
export function parseBitcoinUri(input: string): ParsedBitcoinUri | null {
  const trimmed = input.trim();
  if (!/^bitcoin:/i.test(trimmed)) return null;

  const payload = trimmed.slice('bitcoin:'.length);
  const qIdx = payload.indexOf('?');
  const address = (qIdx === -1 ? payload : payload.slice(0, qIdx)).trim();

  let sp: string | undefined;
  let amountSats: number | undefined;
  if (qIdx !== -1) {
    // URLSearchParams handles percent-decoding and repeated keys.
    const params = new URLSearchParams(payload.slice(qIdx + 1));
    sp = params.get('sp')?.trim() || undefined;

    const amountRaw = params.get('amount')?.trim();
    if (amountRaw) {
      const sats = parseBtcAmountToSats(amountRaw);
      if (sats > 0) {
        amountSats = sats;
      }
    }
  }

  return { address, sp, amountSats };
}

/**
 * Broadcast a signed transaction hex to the Bitcoin network via an
 * Esplora-compatible API. Returns the txid.
 *
 * Broadcast is idempotent at the Bitcoin protocol layer — re-broadcasting a
 * tx that's already in mempool is harmless — so we let the failover client
 * retry across endpoints normally. The first endpoint that accepts the tx
 * wins.
 *
 * @param txHex      The signed transaction hex.
 * @param baseUrls   Ordered list of Esplora REST roots tried with failover.
 * @param signal     Optional abort signal (e.g. from TanStack Query).
 */
export async function broadcastTransaction(
  txHex: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<string> {
  const response = await esploraFetch(baseUrls, `/tx`, {
    method: 'POST',
    body: txHex,
    signal,
    // A 404 on broadcast is never a legitimate "not found" — fail over.
    retryStatuses: [404],
  });

  if (!response.ok) {
    const body = await response.text();
    // Don't include the server response body in the user-facing error — it
    // could contain the raw transaction hex or other wallet data in some
    // Esplora/mempool configurations. Log it for debugging instead.
    console.warn('Broadcast failed:', response.status, body);
    throw new Error(`Broadcast failed (${response.status}). Please try again.`);
  }

  return response.text();
}

/**
 * Thrown when a broadcast attempt failed AND the follow-up visibility probe
 * could not get a definitive answer from any endpoint — the transaction may
 * still have reached the network. Blind-retrying would build a second,
 * different transaction and double-pay, so this error names the txid and
 * deliberately does NOT invite a retry.
 */
export class BroadcastOutcomeUnknownError extends Error {
  /** Locally computed txid of the transaction whose fate is unknown. */
  readonly txid: string;
  constructor(txid: string) {
    super(
      `Broadcast outcome unknown — the transaction may still have reached the network. ` +
      `Check for txid ${txid} in your transaction history or a block explorer; ` +
      `if it appears, do NOT retry — the payment went through.`,
    );
    this.name = 'BroadcastOutcomeUnknownError';
    this.txid = txid;
  }
}

/**
 * Compute the txid of a raw (signed) transaction. A pure function of the
 * bytes — valid before broadcast, which is what makes post-failure
 * disambiguation possible.
 */
export function txidFromRawTx(txHex: string): string {
  return btc.Transaction.fromRaw(hexToBytes(txHex)).id;
}

/** Tunables for the post-failure visibility probe (tests inject zeros). */
export interface BroadcastProbeOptions {
  /** Probe rounds over the whole endpoint list. Default 2. */
  probeRounds?: number;
  /** Delay between probe rounds in ms (propagation slack). Default 1500. */
  probeDelayMs?: number;
}

/**
 * Broadcast a signed transaction, disambiguating failures so callers never
 * mistake "the network ate our POST" for "the tx was rejected".
 *
 * A failed `POST /tx` is ambiguous: the request may have reached a node
 * before the connection dropped, and an HTTP 400 can mean "already in
 * mempool" — both are successes in disguise. Because the txid is a pure
 * function of the signed bytes, any failure is followed by a `GET
 * /tx/{txid}` probe of every configured endpoint:
 *
 * - visible anywhere → the broadcast landed; return the txid (success);
 * - at least one endpoint answered 404 and none returned 2xx → the tx is
 *   known-nowhere; rethrow the original (retry-safe) broadcast error;
 * - no endpoint gave any answer → throw {@link BroadcastOutcomeUnknownError}
 *   so the UI can warn instead of inviting a double-paying retry.
 */
export async function broadcastTransactionDisambiguated(
  txHex: string,
  baseUrls: string[],
  signal?: AbortSignal,
  opts?: BroadcastProbeOptions,
): Promise<string> {
  if (baseUrls.length === 0) {
    // Nothing to broadcast through and nothing to probe — let the failover
    // client's own all-endpoints error through untouched.
    return broadcastTransaction(txHex, baseUrls, signal);
  }
  const txid = txidFromRawTx(txHex);
  let broadcastErr: unknown;
  try {
    return await broadcastTransaction(txHex, baseUrls, signal);
  } catch (err) {
    broadcastErr = err;
  }
  // A caller abort is never ambiguous — propagate it as-is.
  if (signal?.aborted) throw broadcastErr;

  const rounds = opts?.probeRounds ?? 2;
  const delay = opts?.probeDelayMs ?? 1500;
  let answeredNotFound = false;
  for (let round = 0; round < rounds; round++) {
    if (round > 0 && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    for (const url of baseUrls) {
      if (signal?.aborted) throw broadcastErr;
      try {
        const res = await esploraFetch([url], `/tx/${txid}`, { signal });
        if (res.ok) return txid;
        if (res.status === 404) answeredNotFound = true;
      } catch {
        // Endpoint unreachable — no answer from this one.
      }
    }
  }
  // A definitive "never seen it" from any reachable endpoint (and a 2xx
  // nowhere) means the broadcast genuinely failed — safe to retry.
  if (answeredNotFound) throw broadcastErr;
  throw new BroadcastOutcomeUnknownError(txid);
}

/**
 * Compute the maximum sendable amount (in sats) after fees.
 *
 * @param totalBalance Total spendable sats across all UTXOs.
 * @param numInputs    Number of UTXOs that will be consumed.
 * @param feeRate      Fee rate in sat/vB.
 * @returns The max amount in sats, or 0 if the balance cannot cover fees.
 */
export function maxSendable(totalBalance: number, numInputs: number, feeRate: number): number {
  // When sending max there is no change output, so only 1 output.
  const fee = estimateFee(numInputs, 1, feeRate);
  return Math.max(0, totalBalance - fee);
}

/** Result of building an unsigned PSBT. */
export interface UnsignedPsbt {
  /** Hex-encoded unsigned PSBT. */
  psbtHex: string;
  /** Fee in satoshis. */
  fee: number;
}

/**
 * Build an unsigned Taproot PSBT ready for signing.
 *
 * This function constructs the PSBT with all inputs and outputs but does NOT
 * sign it. The returned hex can be passed to any signer (local nsec, NIP-07
 * extension, or NIP-46 remote signer).
 *
 * @param senderPubkeyHex 32-byte hex x-only public key of the sender.
 * @param toAddress       Recipient Bitcoin address.
 * @param amountSats      Amount to send in satoshis.
 * @param utxos           Available UTXOs (all will be consumed).
 * @param feeRate         Fee rate in sat/vB.
 */
export function buildUnsignedPsbt(
  senderPubkeyHex: string,
  toAddress: string,
  amountSats: number,
  utxos: UTXO[],
  feeRate: number,
): UnsignedPsbt {
  return buildUnsignedPsbtMulti(
    senderPubkeyHex,
    [{ address: toAddress, amountSats }],
    utxos,
    feeRate,
  );
}

/** A single recipient output for a multi-output PSBT. */
export interface PsbtRecipient {
  /** Bitcoin address to pay. */
  address: string;
  /** Amount to send to this address in satoshis. */
  amountSats: number;
}

/** Optional settings for local PSBT signing. */
export interface PsbtSigningOptions {
  /**
   * User-approved payment intents (address + amount). When supplied, the signer
   * verifies after finalization that every non-change output matches one intent
   * and that every intent is present exactly once. Unexpected extra outputs are
   * rejected.
   */
  paymentIntents?: PsbtRecipient[];
  /**
   * Additional addresses that are allowed as change outputs beyond the wallet's
   * own input scripts. Used for HD wallets where change goes to a fresh address.
   */
  changeAddresses?: string[];
}

/**
 * Build an unsigned Taproot PSBT with multiple recipient outputs.
 *
 * Same flow as {@link buildUnsignedPsbt} but produces a single transaction
 * paying many recipients in one broadcast. Used by the "zap all" flow where
 * the sender wants to tip every member of a NIP-51 follow set / pack with one
 * signature and one network fee.
 *
 * Per-recipient amounts MUST each be at or above {@link DUST_LIMIT} (546 sats);
 * dust outputs are rejected by Bitcoin's standardness rules and the whole tx
 * would fail to broadcast. The caller is responsible for filtering small
 * recipients or bumping their amounts before calling this.
 *
 * @param senderPubkeyHex 32-byte hex x-only public key of the sender.
 * @param recipients      List of recipient (address, amountSats) pairs.
 * @param utxos           Available UTXOs (all will be consumed).
 * @param feeRate         Fee rate in sat/vB.
 */
export function buildUnsignedPsbtMulti(
  senderPubkeyHex: string,
  recipients: PsbtRecipient[],
  utxos: UTXO[],
  feeRate: number,
): UnsignedPsbt {
  if (!isValidPubkeyHex(senderPubkeyHex)) {
    throw new Error('Invalid sender public key.');
  }
  if (!Number.isFinite(feeRate) || feeRate < 1 || feeRate > MAX_FEE_RATE_SATS_PER_VB) {
    throw new Error(
      `Fee rate must be between 1 and ${MAX_FEE_RATE_SATS_PER_VB} sat/vB. Got ${feeRate}.`,
    );
  }
  if (recipients.length === 0) throw new Error('At least one recipient is required.');

  for (const r of recipients) {
    if (!validateBitcoinAddress(r.address)) {
      throw new Error(`Invalid recipient Bitcoin address: ${r.address}`);
    }
    if (!Number.isFinite(r.amountSats) || !Number.isInteger(r.amountSats) || r.amountSats < DUST_LIMIT) {
      throw new Error(
        `Each recipient must receive an integer amount of at least ${DUST_LIMIT} sats (dust limit). Got ${r.amountSats}.`,
      );
    }
  }

  const internalPubkey = hexToBytes(senderPubkeyHex);

  // Derive change address (same Taproot address as sender) and the
  // scriptPubKey used for each P2TR witness UTXO.
  const senderPayment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
  const changeAddress = senderPayment.address;
  if (!changeAddress) throw new Error('Failed to derive change address');
  const senderScript = senderPayment.script;

  const tx = new btc.Transaction();
  let totalInput = 0;

  for (const utxo of utxos) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: senderScript,
        amount: BigInt(utxo.value),
      },
      tapInternalKey: internalPubkey,
    });
    totalInput += utxo.value;
  }

  const totalOut = recipients.reduce((s, r) => s + r.amountSats, 0);

  // Estimate fee — first assume N + 1 outputs (recipients + change). Change
  // at the dust limit exactly is still standard, so use >= (not >) per
  // BIP-141/P2TR relay policy (minimum non-dust output is 546 sats).
  const numRecipients = recipients.length;
  const feeWithChange = estimateFee(utxos.length, numRecipients + 1, feeRate);
  const changeWithBoth = totalInput - totalOut - feeWithChange;
  const hasChange = changeWithBoth >= DUST_LIMIT;
  const numOutputs = hasChange ? numRecipients + 1 : numRecipients;
  const fee = estimateFee(utxos.length, numOutputs, feeRate);
  const change = totalInput - totalOut - fee;

  if (change < 0) {
    throw new Error(
      `Insufficient funds. Need ${(totalOut + fee).toLocaleString()} sats, have ${totalInput.toLocaleString()} sats.`,
    );
  }

  for (const r of recipients) {
    tx.addOutputAddress(r.address, BigInt(r.amountSats), btc.NETWORK);
  }

  if (hasChange) {
    tx.addOutputAddress(changeAddress, BigInt(change), btc.NETWORK);
  }

  return { psbtHex: hex.encode(tx.toPSBT()), fee };
}

/** HD-derived UTXO accepted by {@link buildUnsignedPsbtHd}. */
export type BuildUnsignedPsbtHdUtxo = HdUtxo | LegacyUtxo;

/** Result of building an unsigned HD PSBT. */
export interface UnsignedPsbtHd extends UnsignedPsbt {
  /** The change output address, when one was included. */
  changeAddress?: string;
}

/**
 * Build an unsigned Taproot PSBT from HD-derived (or legacy) UTXOs.
 *
 * Unlike {@link buildUnsignedPsbtMulti}, this function:
 *   - takes already-selected HD UTXOs (it does not sweep all UTXOs),
 *   - derives change to a fresh HD change address,
 *   - records `tapBip32Derivation` on each input so a local signer can derive
 *     the per-input private key from the wallet account node.
 *
 * Legacy single-address UTXOs (path === 'legacy') are supported alongside
 * HD-derived UTXOs for backwards compatibility.
 *
 * @param accountNode HD account node (m/86'/0'/0').
 * @param recipients Recipient addresses and amounts.
 * @param hdUtxos Selected HD UTXOs covering the spend.
 * @param changeAddress Fresh HD change address (or legacy address for a
 *                    legacy-only spend).
 * @param feeRate Fee rate in sat/vB.
 */
export function buildUnsignedPsbtHd(
  accountNode: HDKey,
  recipients: PsbtRecipient[],
  hdUtxos: BuildUnsignedPsbtHdUtxo[],
  changeAddress: DerivedAddress | { address: string; pubkeyHex: string },
  feeRate: number,
): UnsignedPsbtHd {
  if (recipients.length === 0) throw new Error('At least one recipient is required.');
  if (hdUtxos.length === 0) throw new Error('At least one UTXO is required.');

  if (!Number.isFinite(feeRate) || feeRate < 1 || feeRate > MAX_FEE_RATE_SATS_PER_VB) {
    throw new Error(
      `Fee rate must be between 1 and ${MAX_FEE_RATE_SATS_PER_VB} sat/vB. Got ${feeRate}.`,
    );
  }

  for (const r of recipients) {
    if (!validateBitcoinAddress(r.address)) {
      throw new Error(`Invalid recipient Bitcoin address: ${r.address}`);
    }
    if (!Number.isFinite(r.amountSats) || !Number.isInteger(r.amountSats) || r.amountSats < DUST_LIMIT) {
      throw new Error(
        `Each recipient must receive an integer amount of at least ${DUST_LIMIT} sats (dust limit). Got ${r.amountSats}.`,
      );
    }
  }

  const tx = new btc.Transaction();
  let totalInput = 0;

  for (const utxo of hdUtxos) {
    const internalPubkey = hexToBytes(utxo.pubkeyHex);
    const payment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
    const script = payment.script;
    if (!script) throw new Error(`Failed to derive script for ${utxo.address}`);

    const input: TransactionInputUpdate = {
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script,
        amount: BigInt(utxo.value),
      },
      tapInternalKey: internalPubkey,
    };

    if (utxo.path !== 'legacy') {
      // HD-derived input: attach BIP-32 derivation info so the signer can
      // re-derive the private key without scanning addresses.
      input.tapBip32Derivation = [buildTapBip32Derivation(accountNode, {
        address: utxo.address,
        path: utxo.path,
        pubkeyHex: utxo.pubkeyHex,
        index: 0,
        chain: 0,
      })];
    }

    tx.addInput(input);
    totalInput += utxo.value;
  }

  const totalOut = recipients.reduce((s, r) => s + r.amountSats, 0);

  // Assume a change output, then check if the change is dust.
  const feeWithChange = estimateFee(hdUtxos.length, recipients.length + 1, feeRate);
  const changeWithChange = totalInput - totalOut - feeWithChange;
  const hasChange = changeWithChange >= DUST_LIMIT;
  const numOutputs = hasChange ? recipients.length + 1 : recipients.length;
  const fee = estimateFee(hdUtxos.length, numOutputs, feeRate);
  const change = totalInput - totalOut - fee;

  if (change < 0) {
    throw new Error(
      `Insufficient funds. Need ${(totalOut + fee).toLocaleString()} sats, have ${totalInput.toLocaleString()} sats.`,
    );
  }

  for (const r of recipients) {
    tx.addOutputAddress(r.address, BigInt(r.amountSats), btc.NETWORK);
  }

  if (hasChange) {
    tx.addOutputAddress(changeAddress.address, BigInt(change), btc.NETWORK);
  }

  return {
    psbtHex: hex.encode(tx.toPSBT()),
    fee,
    changeAddress: hasChange ? changeAddress.address : undefined,
  };
}

/** Allowed sighash types for the local Taproot signer. */
const ALLOWED_SIGHASH_TYPES = new Set<number>([
  btc.SigHash.DEFAULT,
  btc.SigHash.ALL,
]);

/**
 * Inspect a PSBT before local signing.
 *
 * Rejects:
 *   - empty input/output sets,
 *   - inputs missing a witness UTXO or with zero/negative value,
 *   - inputs that are not P2TR key-path spends owned by the expected pubkey,
 *   - inputs that request a non-standard sighash (anything other than
 *     SIGHASH_DEFAULT or SIGHASH_ALL),
 *   - transactions whose outputs exceed their inputs (negative fee).
 *
 * This keeps the local signer from being tricked into signing a PSBT that
 * spends someone else's UTXO, uses a weaker sighash, or is structurally
 * invalid.
 */
function inspectPsbtForLocalSigning(
  tx: btc.Transaction,
  expectedPubkey: Uint8Array,
): void {
  if (tx.inputsLength === 0) {
    throw new Error('PSBT has no inputs.');
  }
  if (tx.outputsLength === 0) {
    throw new Error('PSBT has no outputs.');
  }

  let inputSum = 0n;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (!inp.witnessUtxo) {
      throw new Error(`PSBT input ${i} is missing its witness UTXO.`);
    }
    if (inp.witnessUtxo.amount <= 0n) {
      throw new Error(`PSBT input ${i} has a zero or negative value.`);
    }
    if (!inp.witnessUtxo.script || inp.witnessUtxo.script.length === 0) {
      throw new Error(`PSBT input ${i} has an empty prevout script.`);
    }
    if (!inp.tapInternalKey) {
      throw new Error(`PSBT input ${i} is not a Taproot key-path spend.`);
    }
    if (!bytesEqual(inp.tapInternalKey, expectedPubkey)) {
      throw new Error(`PSBT input ${i} is not owned by this signer.`);
    }
    if (inp.sighashType !== undefined && !ALLOWED_SIGHASH_TYPES.has(inp.sighashType)) {
      throw new Error(`PSBT input ${i} requests a non-standard sighash type (${inp.sighashType}).`);
    }
    inputSum += inp.witnessUtxo.amount;
  }

  let outputSum = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    const amount = out.amount ?? 0n;
    if (amount < 0n) {
      throw new Error(`PSBT output ${i} has a negative amount.`);
    }
    outputSum += amount;
  }

  if (outputSum > inputSum) {
    throw new Error('PSBT outputs exceed inputs; transaction is invalid.');
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decode a mainnet Bitcoin address to its output script. Throws on malformed
 * or non-mainnet addresses.
 */
function addressToOutputScript(address: string): Uint8Array {
  const decoded = btc.Address(btc.NETWORK).decode(address);
  if (!decoded) {
    throw new Error(`Unable to decode Bitcoin address: ${address}`);
  }
  return btc.OutScript.encode(decoded);
}

/** True iff `script` is the output script for `address`. */
function outputScriptMatchesAddress(script: Uint8Array, address: string): boolean {
  try {
    return bytesEqual(script, addressToOutputScript(address));
  } catch {
    return false;
  }
}

/** Convert a list of addresses to their output scripts, skipping invalid ones. */
function scriptsForAddresses(addresses: string[]): Uint8Array[] {
  return addresses
    .map((a) => {
      try {
        return addressToOutputScript(a);
      } catch {
        return null;
      }
    })
    .filter((s): s is Uint8Array => s !== null);
}

/** True iff `script` matches any of the allowed change scripts. */
function isChangeOutput(script: Uint8Array, allowedChangeScripts: Uint8Array[]): boolean {
  return allowedChangeScripts.some((change) => bytesEqual(script, change));
}

/**
 * Verify that every transaction output either matches a user-approved payment
 * intent (address + amount) or is a change output to the sender. Rejects
 * unexpected extra outputs and missing intents.
 */
function verifyTxOutputsMatchIntent(
  tx: btc.Transaction,
  paymentIntents: PsbtRecipient[],
  allowedChangeScripts: Uint8Array[],
): void {
  const remaining = paymentIntents.map((i) => ({ ...i }));

  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    const amount = out.amount;
    const script = out.script;
    if (!script || script.length === 0) {
      throw new Error(`PSBT signing: transaction output ${i} has no script.`);
    }

    if (isChangeOutput(script, allowedChangeScripts)) continue;

    const idx = remaining.findIndex(
      (intent) =>
        BigInt(intent.amountSats) === amount && outputScriptMatchesAddress(script, intent.address),
    );
    if (idx < 0) {
      throw new Error(
        'PSBT signing: transaction output does not match the approved payment intent.',
      );
    }
    remaining.splice(idx, 1);
  }

  if (remaining.length > 0) {
    throw new Error('PSBT signing: approved payment intent is missing from transaction outputs.');
  }
}

/**
 * Sign a PSBT locally using a raw private key (nsec).
 *
 * `@scure/btc-signer`'s `Transaction.sign(privateKey)` handles BIP-341
 * TapTweak internally for any input whose `tapInternalKey` matches the
 * key's x-only public key. Inputs that don't match are left untouched,
 * which matters for future multi-signer PSBTs; today `buildUnsignedPsbt`
 * only ever adds the user's own UTXOs, so in practice every input matches.
 *
 * @param psbtHex       Hex-encoded unsigned PSBT.
 * @param privateKeyHex 32-byte hex private key.
 * @param options       Optional payment-intent verification.
 * @returns Hex-encoded signed PSBT (not finalized).
 */
export function signPsbtLocal(
  psbtHex: string,
  privateKeyHex: string,
  options?: PsbtSigningOptions,
): string {
  const tx = btc.Transaction.fromPSBT(hexToBytes(psbtHex));
  const privKey = hexToBytes(privateKeyHex);

  try {
    // Derive the x-only pubkey so we can verify every input is owned by this
    // signer before any signature is produced.
    const internalPubkey = btc.utils.pubSchnorr(privKey);
    inspectPsbtForLocalSigning(tx, internalPubkey);

    // `tx.sign` returns the number of inputs signed. We restrict the signer
    // to SIGHASH_ALL so a malicious PSBT cannot trick us into signing with a
    // weaker sighash (e.g. SIGHASH_NONE). DEFAULT is equivalent to ALL in
    // @scure/btc-signer, so allow both.
    const signedCount = tx.sign(privKey, [btc.SigHash.DEFAULT, btc.SigHash.ALL]);

    if (signedCount === 0) {
      throw new Error('No inputs in this PSBT are owned by the signer.');
    }

    if (options?.paymentIntents) {
      // The only expected change output for the single-key path is back to the
      // sender's own address.
      const senderPayment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
      verifyTxOutputsMatchIntent(tx, options.paymentIntents, [senderPayment.script]);
    }

    return hex.encode(tx.toPSBT());
  } finally {
    // Best-effort wipe of the decoded private key from this stack frame.
    privKey.fill(0);
  }
}

/**
 * Sign a PSBT locally using an HD wallet account node.
 *
 * Each input is expected to carry `tapBip32Derivation` metadata binding its
 * `tapInternalKey` to a BIP-32 path under `accountNode`. The signer derives the
 * per-input private key, verifies the input is owned by the derived pubkey, and
 * signs it.
 *
 * For backwards compatibility, inputs without `tapBip32Derivation` (legacy
 * single-key inputs derived directly from the Nostr pubkey) can be signed by
 * passing the raw 32-byte legacy private key as `legacyPrivateKey`.
 *
 * @param psbtHex          Hex-encoded unsigned PSBT.
 * @param accountNode      Bitcoin wallet account node (m/86'/0'/0').
 * @param legacyPrivateKey Optional 32-byte private key for legacy inputs.
 * @param options          Optional payment-intent verification.
 * @returns Hex-encoded signed PSBT (not finalized).
 */
export function signPsbtLocalHd(
  psbtHex: string,
  accountNode: HDKey,
  legacyPrivateKey?: Uint8Array,
  options?: PsbtSigningOptions,
): string {
  const tx = btc.Transaction.fromPSBT(hexToBytes(psbtHex));

  if (tx.inputsLength === 0) {
    throw new Error('PSBT has no inputs.');
  }
  if (tx.outputsLength === 0) {
    throw new Error('PSBT has no outputs.');
  }

  let inputSum = 0n;
  let outputSum = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    outputSum += tx.getOutput(i).amount ?? 0n;
  }

  const derivedKeys = new Map<string, Uint8Array>();
  const accountFingerprint = accountNode.fingerprint;

  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (!inp.witnessUtxo) {
      throw new Error(`PSBT input ${i} is missing its witness UTXO.`);
    }
    if (inp.witnessUtxo.amount <= 0n) {
      throw new Error(`PSBT input ${i} has a zero or negative value.`);
    }
    if (!inp.tapInternalKey) {
      throw new Error(`PSBT input ${i} is not a Taproot key-path spend.`);
    }
    if (inp.sighashType !== undefined && !ALLOWED_SIGHASH_TYPES.has(inp.sighashType)) {
      throw new Error(`PSBT input ${i} requests a non-standard sighash type (${inp.sighashType}).`);
    }
    inputSum += inp.witnessUtxo.amount;

    const derivations = inp.tapBip32Derivation;
    if (!derivations || derivations.length === 0) {
      if (!legacyPrivateKey) {
        throw new Error(`PSBT input ${i} is missing tapBip32Derivation and no legacy private key was provided.`);
      }
      const derivedPubkey = btc.utils.pubSchnorr(legacyPrivateKey);
      if (!bytesEqual(derivedPubkey, inp.tapInternalKey)) {
        throw new Error(`PSBT input ${i}: legacy private key does not match tapInternalKey.`);
      }
      const keyHex = hex.encode(legacyPrivateKey);
      if (!derivedKeys.has(keyHex)) {
        derivedKeys.set(keyHex, new Uint8Array(legacyPrivateKey));
      }
      continue;
    }

    // Find the derivation entry that matches this input's tapInternalKey and
    // is rooted at our account node.
    const match = derivations.find((d) => bytesEqual(d[0], inp.tapInternalKey!));
    if (!match) {
      throw new Error(`PSBT input ${i}: no tapBip32Derivation matches tapInternalKey.`);
    }
    const { der } = match[1];
    if (der.fingerprint !== accountFingerprint) {
      throw new Error(`PSBT input ${i}: derivation fingerprint does not match the account node.`);
    }

    // The BIP-174 path is the full path from the master. The last two elements
    // are the chain (receive/change) and address index under the account node.
    const path = der.path;
    if (path.length < 2) {
      throw new Error(`PSBT input ${i}: derivation path is too short.`);
    }
    const chain = path[path.length - 2];
    const index = path[path.length - 1];

    const childNode = accountNode.deriveChild(chain).deriveChild(index);
    if (!childNode.privateKey) {
      throw new Error(`PSBT input ${i}: failed to derive private key.`);
    }
    const derivedPubkey = btc.utils.pubSchnorr(childNode.privateKey);
    if (!bytesEqual(derivedPubkey, inp.tapInternalKey)) {
      throw new Error(`PSBT input ${i}: derived pubkey does not match tapInternalKey.`);
    }

    const keyHex = hex.encode(childNode.privateKey);
    if (!derivedKeys.has(keyHex)) {
      derivedKeys.set(keyHex, new Uint8Array(childNode.privateKey));
    }
  }

  // Collect scripts that are allowed as change outputs. Inputs obviously belong
  // to this wallet, and callers can supply explicit change addresses for HD
  // wallets where change goes to a fresh address.
  const allowedChangeScripts: Uint8Array[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    if (inp.witnessUtxo?.script) {
      allowedChangeScripts.push(inp.witnessUtxo.script);
    }
  }
  if (options?.changeAddresses) {
    allowedChangeScripts.push(...scriptsForAddresses(options.changeAddresses));
  }

  if (outputSum > inputSum) {
    throw new Error('PSBT outputs exceed inputs; transaction is invalid.');
  }

  // Sign each input with its derived private key. Because every HD input has a
  // distinct tapInternalKey, each `tx.sign` call affects exactly the matching
  // input.
  let signedCount = 0;
  for (const privKey of derivedKeys.values()) {
    signedCount += tx.sign(privKey, [btc.SigHash.DEFAULT, btc.SigHash.ALL]);
  }

  if (signedCount === 0) {
    throw new Error('No inputs in this PSBT were signed.');
  }
  if (signedCount < tx.inputsLength) {
    throw new Error(`Only ${signedCount} of ${tx.inputsLength} inputs were signed.`);
  }

  if (options?.paymentIntents) {
    verifyTxOutputsMatchIntent(tx, options.paymentIntents, allowedChangeScripts);
  }

  // Best-effort wipe of derived keys.
  for (const privKey of derivedKeys.values()) {
    privKey.fill(0);
  }

  return hex.encode(tx.toPSBT());
}

/**
 * Finalize a signed PSBT and extract the raw transaction hex.
 *
 * @param psbtHex Hex-encoded signed PSBT.
 * @returns Raw transaction hex ready for broadcast.
 */
export function finalizePsbt(psbtHex: string): string {
  const tx = btc.Transaction.fromPSBT(hexToBytes(psbtHex));
  tx.finalize();
  return hex.encode(tx.extract());
}

/**
 * Create, sign, and return a raw Bitcoin Taproot transaction.
 *
 * Convenience wrapper that calls {@link buildUnsignedPsbt},
 * {@link signPsbtLocal}, and {@link finalizePsbt} in sequence.
 *
 * @param privateKeyHex 32-byte hex private key (from Nostr nsec).
 * @param toAddress     Recipient Bitcoin address.
 * @param amountSats    Amount to send in satoshis.
 * @param utxos         Available UTXOs (all will be consumed).
 * @param feeRate       Fee rate in sat/vB.
 * @returns The signed transaction hex and the fee paid.
 */
export function createBitcoinTransaction(
  privateKeyHex: string,
  toAddress: string,
  amountSats: number,
  utxos: UTXO[],
  feeRate: number,
): { txHex: string; fee: number } {
  // Derive the x-only pubkey from the private key for buildUnsignedPsbt
  const internalPubkey = btc.utils.pubSchnorr(hexToBytes(privateKeyHex));
  const senderPubkeyHex = hex.encode(internalPubkey);

  const { psbtHex, fee } = buildUnsignedPsbt(senderPubkeyHex, toAddress, amountSats, utxos, feeRate);
  const signedHex = signPsbtLocal(psbtHex, privateKeyHex, {
    paymentIntents: [{ address: toAddress, amountSats }],
  });
  const txHex = finalizePsbt(signedHex);

  return { txHex, fee };
}

// ---------------------------------------------------------------------------
// BIP-352 / BIP-375 silent payment sends (sp1… / tsp1…)
// ---------------------------------------------------------------------------
//
// Silent payment recipients hand out a static `sp1…` address that the
// sender's wallet turns into a per-transaction BIP-341 taproot output. The
// transformation depends on the sender's input set (BIP-352
// `outpoint_L · a · B_scan`), so the on-chain output isn't computable
// without either:
//
//   (a) the sender's private key (the local nsec path) — we decode the SP
//       address ourselves and embed the derived P2TR in a regular PSBT v0
//       before signing, or
//   (b) the signer (NIP-07 / NIP-46) supporting BIP-375 — we hand it a
//       PSBT v2 carrying `PSBT_OUT_SP_V0_INFO`, and the signer fills in the
//       output script while signing.
//
// {@link buildUnsignedSilentPaymentPsbt} produces the PSBT v2 + BIP-375
// flavour that any signer of the latter shape can consume. The local
// `NSecSignerBtc.signPsbt` short-circuits this by detecting the BIP-375
// fields in the PSBT v2 and resolving the SP output before signing.

/**
 * Cheap routing predicate for the recipient picker.
 *
 * Returns `true` iff `s` looks like a silent payment address. A `true`
 * here only commits the UI to treating the input as an SP address; full
 * validation happens at coin-selection time.
 */
export function looksLikeSilentPaymentAddress(s: string): boolean {
  return isSilentPaymentAddress(s);
}

/**
 * Validate a silent payment address, returning the decoded scan/spend
 * pubkeys on success or `null` on failure.
 *
 * Use for inline form validation. The reason `null` (rather than throwing)
 * is that pickers may speculatively check half-typed addresses.
 */
export function validateAndDecodeSilentPaymentAddress(addr: string): SilentPaymentAddress | null {
  try {
    return decodeSilentPaymentAddress(addr);
  } catch {
    return null;
  }
}

/** Re-export the cheap check so callers don't have to reach into `silentPayments`. */
export { validateSilentPaymentAddress };

/**
 * Build an unsigned PSBT v2 + BIP-375 transaction paying a single silent
 * payment recipient.
 *
 * The PSBT carries the recipient as a `PSBT_OUT_SP_V0_INFO` (no
 * `PSBT_OUT_SCRIPT`), plus a regular change output to the sender. The
 * signer (any of nsec, NIP-07, NIP-46 — all of which we route through
 * `BtcSigner.signPsbt`) is expected to:
 *
 *   1. derive the recipient's per-transaction P2TR output from the SP
 *      address and the input set's ECDH share,
 *   2. write the result into `PSBT_OUT_SCRIPT`,
 *   3. sign each input (SIGHASH_ALL only, per BIP-375),
 *   4. return a finalized PSBT v2 we can extract with
 *      {@link extractTxFromSignedPsbtV2}.
 *
 * BIP-375 forbids inputs with witness version > 1. 2140.wtf's wallet only
 * spends from the sender's own P2TR (witness v1) UTXOs, so we never hit
 * that constraint, but the check is still applied here for safety.
 *
 * Mainnet only — the wallet doesn't support testnet UTXOs anywhere.
 *
 * @param senderPubkeyHex 32-byte hex x-only public key of the sender (used
 *                        for the change output and as the tapInternalKey).
 * @param spAddress       The recipient's `sp1…` silent payment address.
 * @param amountSats      Amount to send in satoshis.
 * @param utxos           Available UTXOs (all are consumed).
 * @param feeRate         Fee rate in sat/vB.
 */
export function buildUnsignedSilentPaymentPsbt(
  senderPubkeyHex: string,
  spAddress: string,
  amountSats: number,
  utxos: UTXO[],
  feeRate: number,
): UnsignedPsbt {
  if (!isValidPubkeyHex(senderPubkeyHex)) {
    throw new Error('Silent payment send: invalid sender pubkey.');
  }
  if (utxos.length === 0) {
    throw new Error('Silent payment send: no UTXOs available.');
  }
  if (!Number.isFinite(amountSats) || !Number.isInteger(amountSats) || amountSats < 546) {
    throw new Error(`Silent payment send: amount must be an integer amount of at least 546 sats (got ${amountSats}).`);
  }
  if (!Number.isFinite(feeRate) || feeRate < 1 || feeRate > MAX_FEE_RATE_SATS_PER_VB) {
    throw new Error(
      `Silent payment send: fee rate must be between 1 and ${MAX_FEE_RATE_SATS_PER_VB} sat/vB. Got ${feeRate}.`,
    );
  }

  // ── 1. Decode the silent payment address ──
  const sp = decodeSilentPaymentAddress(spAddress);
  if (sp.network !== 'mainnet') {
    throw new Error('Silent payment send: testnet addresses are not supported.');
  }
  if (sp.version !== 0) {
    // Forward-compat: the BIP defines v0 today; v1+ are reserved for future
    // upgrades and we refuse them rather than silently truncating the
    // payload (which is what the BIP allows for v1-v30 receivers).
    throw new Error(`Silent payment send: address version ${sp.version} is not yet supported.`);
  }

  const internalPubkey = hexToBytes(senderPubkeyHex);
  const senderPayment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
  const changeAddress = senderPayment.address;
  if (!changeAddress) throw new Error('Silent payment send: failed to derive change address.');
  const senderScript = senderPayment.script;

  // The change scriptPubKey (also P2TR) goes into the change output if any.
  const changeScript = senderScript;

  // ── 2. Fee + change calculation (mirrors buildUnsignedPsbtMulti) ──
  const totalInput = utxos.reduce((s, u) => s + u.value, 0);
  const feeWithChange = estimateFee(utxos.length, 2, feeRate);
  const changeWithBoth = totalInput - amountSats - feeWithChange;
  const hasChange = changeWithBoth >= DUST_LIMIT;
  const numOutputs = hasChange ? 2 : 1;
  const fee = estimateFee(utxos.length, numOutputs, feeRate);
  const change = totalInput - amountSats - fee;
  if (change < 0) {
    throw new Error(
      `Insufficient funds. Need ${(amountSats + fee).toLocaleString()} sats, have ${totalInput.toLocaleString()} sats.`,
    );
  }

  // ── 3. PSBT v2 input set ──
  const psbtInputs: PsbtV2Input[] = utxos.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    witnessUtxo: { amount: BigInt(u.value), script: senderScript },
    tapInternalKey: internalPubkey,
  }));

  // ── 4. Outputs: SP recipient (no script) + optional change (script) ──
  const psbtOutputs: PsbtV2Output[] = [
    {
      type: 'sp',
      amount: BigInt(amountSats),
      scanPubKey: sp.scanPubKey,
      spendPubKey: sp.spendPubKey,
    },
  ];
  if (hasChange) {
    psbtOutputs.push({
      type: 'script',
      amount: BigInt(change),
      script: changeScript,
    });
  }

  const psbtHex = encodePsbtV2({
    inputs: psbtInputs,
    outputs: psbtOutputs,
  });

  return { psbtHex, fee };
}

