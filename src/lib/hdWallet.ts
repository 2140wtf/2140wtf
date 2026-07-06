/**
 * HD wallet derivation for 2140.wtf.
 *
 * 2140.wtf's original model derived a single Taproot address directly from the
 * Nostr public key. This file introduces a proper BIP-32/BIP-86 HD wallet that
 * is derived from the same secret material but uses separate derivation paths,
 * so the Bitcoin wallet can rotate receive/change addresses without reusing the
 * Nostr identity key as a spending key.
 *
 * Derivation scheme (nsec-based logins):
 *
 *   nsec_bytes = decoded Nostr private key (32 bytes)
 *   wallet_seed = HKDF-SHA256(nsec_bytes, salt='', info='2140:btc:seed:v1', 64 bytes)
 *   root = HDKey.fromMasterSeed(wallet_seed)
 *   bitcoin_wallet = root.derive("m/86'/0'/0'")
 *     receive address i  -> m/86'/0'/0'/0/i
 *     change address i   -> m/86'/0'/0'/1/i
 *
 * This is a 2140.wtf-specific convention, not a published NIP. It preserves
 * the zero-setup "log in with nsec" UX while fixing address reuse and UTXO
 * management. Users who want full portability can export/import their nsec and
 * re-derive the same wallet addresses.
 *
 * For BIP-39 mnemonic logins (future), the same paths are used directly from
 * the mnemonic seed.
 */

import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { esploraFetch } from './esplora';
import { DUST_LIMIT, estimateFee } from './feeEstimation';
import { encodeSilentPaymentAddress } from './silentPayments';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** BIP-86 Taproot account path for Bitcoin mainnet. */
export const BITCOIN_WALLET_PATH = "m/86'/0'/0'";

/** BIP-352 silent-payment spend path. */
export const SILENT_PAYMENT_SPEND_PATH = "m/352'/0'/0'/0'/0";

/** BIP-352 silent-payment scan path. */
export const SILENT_PAYMENT_SCAN_PATH = "m/352'/0'/0'/1'/0";

/** External (receive) chain index. */
export const RECEIVE_CHAIN = 0;

/** Internal (change) chain index. */
export const CHANGE_CHAIN = 1;

/** HKDF info string used to derive a BIP-32-compatible seed from a raw nsec. */
const HKDF_INFO_NSEC_TO_WALLET_SEED = new TextEncoder().encode('2140:btc:seed:v1');

/** Gap limit for address discovery (BIP-44 convention). */
export const DEFAULT_GAP_LIMIT = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A derived Bitcoin address with its derivation metadata. */
export interface DerivedAddress {
  /** The Bitcoin address (mainnet Taproot). */
  address: string;
  /** BIP-32 derivation path, e.g. "m/86'/0'/0'/0/5". */
  path: string;
  /** 32-byte hex x-only public key. */
  pubkeyHex: string;
  /** Address index within the chain. */
  index: number;
  /** 0 for external (receive), 1 for internal (change). */
  chain: number;
}

/** A UTXO owned by a specific derived address. */
export interface HdUtxo {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
  /** The address that owns this UTXO. */
  address: string;
  /** BIP-32 derivation path for the owning address. */
  path: string;
  /** 32-byte hex x-only public key. */
  pubkeyHex: string;
}

// ---------------------------------------------------------------------------
// Seed / root derivation
// ---------------------------------------------------------------------------

/**
 * Derive a BIP-32-compatible 64-byte seed from a raw Nostr private key.
 *
 * This lets users keep the zero-setup nsec login while gaining a proper HD
 * Bitcoin wallet. The derived seed is deterministic and cannot be linked to the
 * Nostr identity without knowing the nsec.
 */
export function deriveWalletSeedFromNsec(nsecBytes: Uint8Array): Uint8Array {
  if (nsecBytes.length !== 32) {
    throw new Error('Invalid nsec length: expected 32 bytes.');
  }
  return hkdf(sha256, nsecBytes, new Uint8Array(0), HKDF_INFO_NSEC_TO_WALLET_SEED, 64);
}

/**
 * Create an HD root from a BIP-39 mnemonic seed or from a seed produced by
 * {@link deriveWalletSeedFromNsec}.
 */
export function hdRootFromSeed(seed: Uint8Array): HDKey {
  return HDKey.fromMasterSeed(seed);
}

/**
 * Derive the Bitcoin wallet account node from an HD root.
 */
export function deriveBitcoinWalletNode(root: HDKey): HDKey {
  return root.derive(BITCOIN_WALLET_PATH);
}

/**
 * Convenience: get the Bitcoin wallet account node directly from nsec bytes.
 */
export function bitcoinWalletNodeFromNsec(nsecBytes: Uint8Array): HDKey {
  const seed = deriveWalletSeedFromNsec(nsecBytes);
  const root = hdRootFromSeed(seed);
  return deriveBitcoinWalletNode(root);
}

// ---------------------------------------------------------------------------
// Silent Payments key derivation (BIP-352)
// ---------------------------------------------------------------------------

/**
 * Derive the BIP-352 silent-payment spend and scan keys from an HD root.
 *
 * The spend private key is used to sign/spend discovered outputs. The scan
 * private key is used to find them. The encoded address contains the two
 * corresponding compressed public keys.
 */
export function deriveSilentPaymentKeysFromRoot(root: HDKey): {
  /** 32-byte scan private key scalar. */
  scanPrivKey: Uint8Array;
  /** 33-byte compressed scan public key. */
  scanPubKey: Uint8Array;
  /** 32-byte spend private key scalar. */
  spendPrivKey: Uint8Array;
  /** 33-byte compressed spend public key. */
  spendPubKey: Uint8Array;
} {
  const scanNode = root.derive(SILENT_PAYMENT_SCAN_PATH);
  const spendNode = root.derive(SILENT_PAYMENT_SPEND_PATH);

  if (!scanNode.privateKey || !spendNode.privateKey) {
    throw new Error('Failed to derive silent-payment keys.');
  }
  if (!scanNode.publicKey || !spendNode.publicKey) {
    throw new Error('Failed to derive silent-payment public keys.');
  }

  return {
    scanPrivKey: scanNode.privateKey,
    scanPubKey: scanNode.publicKey,
    spendPrivKey: spendNode.privateKey,
    spendPubKey: spendNode.publicKey,
  };
}

/**
 * Derive the BIP-352 silent-payment spend and scan keys from nsec bytes.
 */
export function deriveSilentPaymentKeysFromNsec(nsecBytes: Uint8Array): {
  scanPrivKey: Uint8Array;
  scanPubKey: Uint8Array;
  spendPrivKey: Uint8Array;
  spendPubKey: Uint8Array;
} {
  const seed = deriveWalletSeedFromNsec(nsecBytes);
  const root = hdRootFromSeed(seed);
  return deriveSilentPaymentKeysFromRoot(root);
}

/**
 * Derive the static sp1… silent-payment receive address from nsec bytes.
 */
export function deriveSilentPaymentAddressFromNsec(nsecBytes: Uint8Array): {
  address: string;
  scanPubKey: Uint8Array;
  spendPubKey: Uint8Array;
} {
  const keys = deriveSilentPaymentKeysFromNsec(nsecBytes);
  const address = encodeSilentPaymentAddress({
    scanPubKey: keys.scanPubKey,
    spendPubKey: keys.spendPubKey,
    network: 'mainnet',
    version: 0,
  });
  return { address, scanPubKey: keys.scanPubKey, spendPubKey: keys.spendPubKey };
}

// ---------------------------------------------------------------------------
// Address derivation
// ---------------------------------------------------------------------------

/**
 * Derive a single Taproot address at a specific chain and index under the
 * Bitcoin wallet account node.
 */
export function deriveAddress(
  accountNode: HDKey,
  chain: number,
  index: number,
): DerivedAddress {
  if (chain !== RECEIVE_CHAIN && chain !== CHANGE_CHAIN) {
    throw new Error(`Invalid chain: ${chain}. Use 0 (receive) or 1 (change).`);
  }
  if (!Number.isFinite(index) || index < 0 || index > 0x7fffffff) {
    throw new Error(`Invalid address index: ${index}`);
  }

  const child = accountNode.deriveChild(chain).deriveChild(index);
  const publicKey = child.publicKey;
  if (!publicKey) {
    throw new Error('Failed to derive public key.');
  }

  // publicKey from HDKey is 33-byte compressed. For Taproot we need the
  // 32-byte x-only pubkey (compressed key without the 02/03 prefix).
  const xOnlyPubkey = publicKey.slice(1, 33);
  const payment = btc.p2tr(xOnlyPubkey, undefined, btc.NETWORK);
  const address = payment.address;
  if (!address) {
    throw new Error('Failed to derive Taproot address.');
  }

  return {
    address,
    path: `${BITCOIN_WALLET_PATH}/${chain}/${index}`,
    pubkeyHex: hex.encode(xOnlyPubkey),
    index,
    chain,
  };
}

/** Derive a receive address. */
export function deriveReceiveAddress(accountNode: HDKey, index: number): DerivedAddress {
  return deriveAddress(accountNode, RECEIVE_CHAIN, index);
}

/** Derive a change address. */
export function deriveChangeAddress(accountNode: HDKey, index: number): DerivedAddress {
  return deriveAddress(accountNode, CHANGE_CHAIN, index);
}

// ---------------------------------------------------------------------------
// Address discovery
// ---------------------------------------------------------------------------

/**
 * Derive a range of addresses for discovery/scanning.
 */
export function deriveAddressRange(
  accountNode: HDKey,
  chain: number,
  startIndex: number,
  count: number,
): DerivedAddress[] {
  const out: DerivedAddress[] = [];
  for (let i = 0; i < count; i++) {
    out.push(deriveAddress(accountNode, chain, startIndex + i));
  }
  return out;
}

/**
 * Find the next unused address index for a chain.
 *
 * `isUsed` is a predicate that returns true if the address has any history
 * (balance, txs, or UTXOs). The function scans from `startIndex` and returns
 * the first index for which `isUsed` is false and the following `gapLimit - 1`
 * addresses are also unused.
 */
export async function findNextUnusedAddressIndex(
  accountNode: HDKey,
  chain: number,
  isUsed: (address: string) => Promise<boolean> | boolean,
  startIndex = 0,
  gapLimit = DEFAULT_GAP_LIMIT,
): Promise<number> {
  let index = startIndex;

  while (true) {
    const addresses = deriveAddressRange(accountNode, chain, index, gapLimit);
    const usedFlags = await Promise.all(addresses.map((a) => isUsed(a.address)));

    // Find the first gap of `gapLimit` unused addresses.
    for (let i = 0; i < usedFlags.length; i++) {
      const chunk = usedFlags.slice(i, i + gapLimit);
      if (chunk.length < gapLimit) {
        // Ran past the scanned window; keep scanning from here.
        break;
      }
      if (chunk.every((used) => !used)) {
        return index + i;
      }
    }

    // If we found some used addresses, advance past them. Otherwise we scanned
    // `gapLimit` unused addresses and should already have returned.
    const lastUsed = usedFlags.lastIndexOf(true);
    if (lastUsed === -1) {
      // All scanned addresses are unused; return the first one.
      return index;
    }
    index += lastUsed + 1;
  }
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Parse a BIP-32 path string into an array of indices. */
export function parseBip32Path(path: string): number[] {
  const parts = path.replace(/^m\//, '').split('/');
  return parts.map((part) => {
    if (part.endsWith("'")) {
      return parseInt(part.slice(0, -1), 10) + HARDENED_OFFSET;
    }
    return parseInt(part, 10);
  });
}

/** Check whether a path belongs to the Bitcoin wallet receive chain. */
export function isReceivePath(path: string): boolean {
  return path.startsWith(`${BITCOIN_WALLET_PATH}/0/`);
}

/** Check whether a path belongs to the Bitcoin wallet change chain. */
export function isChangePath(path: string): boolean {
  return path.startsWith(`${BITCOIN_WALLET_PATH}/1/`);
}

/** Extract chain and index from a wallet path like "m/86'/0'/0'/0/5". */
export function pathToChainAndIndex(path: string): { chain: number; index: number } {
  const match = path.match(new RegExp(`^${BITCOIN_WALLET_PATH.replace(/'/g, "'")}/(\\d+)/(\\d+)$`));
  if (!match) {
    throw new Error(`Not a wallet address path: ${path}`);
  }
  return { chain: parseInt(match[1], 10), index: parseInt(match[2], 10) };
}

// ---------------------------------------------------------------------------
// Address scanning and UTXO discovery
// ---------------------------------------------------------------------------

/** True if the address has ever been used (any confirmed or mempool tx). */
export async function addressHasHistory(
  address: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await esploraFetch(baseUrls, `/address/${address}`, {
    signal,
    retryStatuses: [404],
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch address history for ${address}`);
  }
  const data = await response.json();
  return (
    (data.chain_stats?.tx_count ?? 0) > 0 ||
    (data.mempool_stats?.tx_count ?? 0) > 0
  );
}

/** Result of scanning an HD wallet account for used addresses and UTXOs. */
export interface HdWalletScan {
  /** Receive addresses that have history, in derivation order. */
  usedReceiveAddresses: DerivedAddress[];
  /** Change addresses that have history, in derivation order. */
  usedChangeAddresses: DerivedAddress[];
  /** Next unused receive address index. */
  nextReceiveIndex: number;
  /** Next unused change address index. */
  nextChangeIndex: number;
  /** All UTXOs discovered across used addresses. */
  utxos: HdUtxo[];
}

/**
 * Scan an HD wallet account for used addresses and their UTXOs.
 *
 * Discovers used receive and change addresses up to `gapLimit` consecutive
 * unused addresses, then fetches UTXOs for every used address. Returns the
 * next unused indices so callers can derive fresh receive/change addresses.
 */
export async function scanHdWallet(
  accountNode: HDKey,
  baseUrls: string[],
  gapLimit = DEFAULT_GAP_LIMIT,
  signal?: AbortSignal,
): Promise<HdWalletScan> {
  const [nextReceiveIndex, nextChangeIndex] = await Promise.all([
    findNextUnusedAddressIndex(
      accountNode,
      RECEIVE_CHAIN,
      (addr) => addressHasHistory(addr, baseUrls, signal),
      0,
      gapLimit,
    ),
    findNextUnusedAddressIndex(
      accountNode,
      CHANGE_CHAIN,
      (addr) => addressHasHistory(addr, baseUrls, signal),
      0,
      gapLimit,
    ),
  ]);

  const usedReceiveAddresses: DerivedAddress[] = [];
  for (let i = 0; i < nextReceiveIndex; i++) {
    usedReceiveAddresses.push(deriveReceiveAddress(accountNode, i));
  }

  const usedChangeAddresses: DerivedAddress[] = [];
  for (let i = 0; i < nextChangeIndex; i++) {
    usedChangeAddresses.push(deriveChangeAddress(accountNode, i));
  }

  const utxos = await fetchHdUtxos(
    [...usedReceiveAddresses, ...usedChangeAddresses],
    baseUrls,
    signal,
  );

  return {
    usedReceiveAddresses,
    usedChangeAddresses,
    nextReceiveIndex,
    nextChangeIndex,
    utxos,
  };
}

/**
 * Fetch UTXOs for a list of derived addresses and annotate them with their
 * derivation metadata.
 */
export async function fetchHdUtxos(
  addresses: DerivedAddress[],
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<HdUtxo[]> {
  const results = await Promise.all(
    addresses.map(async (addr) => {
      const response = await esploraFetch(baseUrls, `/address/${addr.address}/utxo`, {
        signal,
        retryStatuses: [404],
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch UTXOs for ${addr.address}`);
      }
      const utxos: Array<{
        txid: string;
        vout: number;
        value: number;
        status: HdUtxo['status'];
      }> = await response.json();
      return utxos.map((u) => ({
        ...u,
        address: addr.address,
        path: addr.path,
        pubkeyHex: addr.pubkeyHex,
      }));
    }),
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// Coin selection
// ---------------------------------------------------------------------------
/** Result of selecting UTXOs for a spend. */
export interface SelectedUtxos {
  /** UTXOs chosen to cover the spend. */
  selected: HdUtxo[];
  /** Fee in satoshis for the transaction using the selected inputs. */
  fee: number;
  /** Change amount in satoshis (0 if no change output is needed). */
  change: number;
  /** Number of outputs the transaction will have. */
  numOutputs: number;
}

/**
 * Select UTXOs to cover a target amount plus fee without sweeping the wallet.
 *
 * Uses a largest-first greedy strategy to minimize the number of inputs. If
 * the target cannot be covered, throws an error.
 *
 * @param utxos All available UTXOs.
 * @param targetSats Amount to send in satoshis.
 * @param feeRate Fee rate in sat/vB.
 * @param numRecipients Number of recipient outputs (default 1).
 */
export function selectUtxos(
  utxos: HdUtxo[],
  targetSats: number,
  feeRate: number,
  numRecipients = 1,
): SelectedUtxos {
  if (!Number.isFinite(targetSats) || targetSats < 0) {
    throw new Error(`Invalid target amount: ${targetSats}`);
  }
  if (!Number.isFinite(feeRate) || feeRate < 1) {
    throw new Error(`Invalid fee rate: ${feeRate}`);
  }
  if (numRecipients < 1) {
    throw new Error('At least one recipient output is required.');
  }

  // Largest-first: fewer inputs → smaller tx → lower fee.
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected: HdUtxo[] = [];

  for (const utxo of sorted) {
    if (selected.some((u) => u.txid === utxo.txid && u.vout === utxo.vout)) continue;

    selected.push(utxo);

    // Assume we need a change output, then decide if the change is dust.
    const feeWithChange = estimateFee(selected.length, numRecipients + 1, feeRate);
    const inputSum = selected.reduce((s, u) => s + u.value, 0);
    const changeWithChange = inputSum - targetSats - feeWithChange;

    if (changeWithChange >= DUST_LIMIT) {
      return {
        selected,
        fee: feeWithChange,
        change: changeWithChange,
        numOutputs: numRecipients + 1,
      };
    }

    // Try without a change output.
    const feeNoChange = estimateFee(selected.length, numRecipients, feeRate);
    const changeNoChange = inputSum - targetSats - feeNoChange;
    if (changeNoChange >= 0) {
      return {
        selected,
        fee: feeNoChange,
        change: 0,
        numOutputs: numRecipients,
      };
    }
  }

  const total = sorted.reduce((s, u) => s + u.value, 0);
  const feeForAll = estimateFee(sorted.length, numRecipients + 1, feeRate);
  throw new Error(
    `Insufficient funds. Need ${(targetSats + feeForAll).toLocaleString()} sats, have ${total.toLocaleString()} sats.`,
  );
}

// ---------------------------------------------------------------------------
// Private key derivation for signing
// ---------------------------------------------------------------------------

/**
 * Derive the 32-byte private key for a wallet address path.
 *
 * @param accountNode The Bitcoin wallet account node (m/86'/0'/0').
 * @param path BIP-32 path like "m/86'/0'/0'/0/5".
 */
export function derivePrivateKeyForPath(accountNode: HDKey, path: string): Uint8Array {
  const { chain, index } = pathToChainAndIndex(path);
  const child = accountNode.deriveChild(chain).deriveChild(index);
  if (!child.privateKey) {
    throw new Error(`Cannot derive private key for ${path}`);
  }
  return new Uint8Array(child.privateKey);
}

/**
 * Build a `tapBip32Derivation` entry for @scure/btc-signer.
 *
 * The entry binds the 32-byte x-only internal public key to a BIP-32 path
 * rooted at the account node. `hashes` is empty because we only support
 * key-path spends (no script tree).
 */
export function buildTapBip32Derivation(
  accountNode: HDKey,
  derived: DerivedAddress,
): [Uint8Array, { hashes: Uint8Array[]; der: { fingerprint: number; path: number[] } }] {
  const path = parseBip32Path(derived.path);
  return [
    hex.decode(derived.pubkeyHex),
    {
      hashes: [],
      der: {
        fingerprint: accountNode.fingerprint,
        path,
      },
    },
  ];
}

/** Return the x-only internal pubkey bytes for an HD-derived address. */
export function hdAddressToInternalPubkey(derived: DerivedAddress): Uint8Array {
  return hex.decode(derived.pubkeyHex);
}

/**
 * Derive the legacy single Taproot address directly from a raw Nostr private
 * key. This is the original 2140.wtf address model: the Nostr pubkey is used
 * as the Taproot internal key.
 */
export function legacyAddressFromNsec(nsecBytes: Uint8Array): string {
  if (nsecBytes.length !== 32) {
    throw new Error('Invalid nsec length: expected 32 bytes.');
  }
  const internalPubkey = btc.utils.pubSchnorr(nsecBytes);
  const payment = btc.p2tr(internalPubkey, undefined, btc.NETWORK);
  return payment.address ?? '';
}

/**
 * Fetch UTXOs for the legacy single-address wallet and tag them as legacy.
 */
export async function fetchLegacyUtxos(
  address: string,
  pubkeyHex: string,
  baseUrls: string[],
  signal?: AbortSignal,
): Promise<LegacyUtxo[]> {
  const response = await esploraFetch(baseUrls, `/address/${address}/utxo`, {
    signal,
    retryStatuses: [404],
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch legacy UTXOs for ${address}`);
  }
  const utxos: Array<{ txid: string; vout: number; value: number; status: HdUtxo['status'] }> =
    await response.json();
  return legacyUtxosFromAddressData(address, pubkeyHex, utxos);
}

/** Aggregate all UTXOs (HD + any externally-supplied legacy UTXOs). */
export function aggregateUtxos(hdUtxos: HdUtxo[], legacyUtxos: HdUtxo[] = []): HdUtxo[] {
  const seen = new Set<string>();
  const out: HdUtxo[] = [];
  for (const u of [...hdUtxos, ...legacyUtxos]) {
    const key = `${u.txid}:${u.vout}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy single-address compatibility
// ---------------------------------------------------------------------------

/**
 * A UTXO owned by the legacy single Taproot address derived directly from the
 * Nostr public key. These UTXOs are still spendable after the HD wallet is
 * introduced.
 */
export interface LegacyUtxo extends HdUtxo {
  path: 'legacy';
}

/**
 * Convert plain Esplora UTXOs for the legacy single-address wallet into
 * {@link LegacyUtxo} values.
 *
 * The legacy address is the original 2140.wtf model: a single P2TR output
 * whose internal key is the user's Nostr pubkey. Existing users with funds at
 * that address can spend them alongside HD-derived UTXOs.
 */
export function legacyUtxosFromAddressData(
  address: string,
  pubkeyHex: string,
  utxos: Array<{
    txid: string;
    vout: number;
    value: number;
    status: HdUtxo['status'];
  }>,
): LegacyUtxo[] {
  return utxos.map((u) => ({
    ...u,
    address,
    path: 'legacy',
    pubkeyHex,
  }));
}

