/**
 * BlindBit Oracle v2-compatible Silent Payments indexer client.
 *
 * The indexer pre-computes, for every block, the set of "tweaks" (public
 * points derived from transaction inputs) and the set of P2TR outputs. The
 * receiver uses its scan private key to perform ECDH against each tweak and
 * checks whether any derived output key matches a real output.
 *
 * Endpoints consumed:
 *   - GET /info          -> { blockHeight: number }
 *   - GET /tweaks/:height -> string[] (33-byte compressed pubkey hex)
 *   - GET /utxos/:height  -> UtxoRow[]
 */

import type { ScanTweakEntry } from './scanner';

export interface IndexerInfo {
  blockHeight: number;
}

export interface IndexerUtxoRow {
  txid: string;
  vout: number;
  value: number;
  scriptpubkey: string;
  /** True if the output has already been spent in a later block. */
  spent?: boolean;
}

export interface BlockScanEntry {
  height: number;
  tweaks: Uint8Array[];
  outputs: IndexerUtxoRow[];
}

const JSON_HEADERS = { Accept: 'application/json' };

/**
 * Fetch the current chain tip from the indexer.
 */
export async function fetchIndexerTipHeight(baseUrl: string, signal?: AbortSignal): Promise<number> {
  const url = `${baseUrl.replace(/\/$/, '')}/info`;
  const response = await fetch(url, { signal, headers: JSON_HEADERS });
  if (!response.ok) {
    throw new Error(`Indexer /info failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { blockHeight?: number; block_height?: number };
  const height = data.blockHeight ?? data.block_height;
  if (typeof height !== 'number' || !Number.isFinite(height)) {
    throw new Error('Indexer /info returned invalid blockHeight.');
  }
  return height;
}

/**
 * Fetch tweaks and UTXOs for a single block.
 */
export async function fetchIndexerBlock(
  baseUrl: string,
  height: number,
  signal?: AbortSignal,
  includeSpent = false,
): Promise<BlockScanEntry> {
  const root = baseUrl.replace(/\/$/, '');
  const [tweaksRes, utxosRes] = await Promise.all([
    fetch(`${root}/tweaks/${height}`, { signal, headers: JSON_HEADERS }),
    fetch(`${root}/utxos/${height}`, { signal, headers: JSON_HEADERS }),
  ]);

  if (!tweaksRes.ok) {
    throw new Error(`Indexer /tweaks/${height} failed: ${tweaksRes.status}`);
  }
  if (!utxosRes.ok) {
    throw new Error(`Indexer /utxos/${height} failed: ${utxosRes.status}`);
  }

  const tweakHexes = (await tweaksRes.json()) as string[];
  const rows = (await utxosRes.json()) as IndexerUtxoRow[];

  const tweaks = tweakHexes.map((h) => {
    if (!/^[0-9a-fA-F]{66}$/.test(h)) {
      throw new Error(`Indexer returned invalid tweak at height ${height}: ${h}`);
    }
    return hexToBytes(h);
  });

  const outputs = rows
    .filter((r) => includeSpent || r.spent !== true)
    .map((r) => {
      if (!/^[0-9a-fA-F]{64}$/.test(r.txid)) {
        throw new Error(`Indexer returned invalid txid at height ${height}: ${r.txid}`);
      }
      if (!Number.isInteger(r.vout) || r.vout < 0) {
        throw new Error(`Indexer returned invalid vout at height ${height}: ${r.vout}`);
      }
      if (!Number.isInteger(r.value) || r.value < 0) {
        throw new Error(`Indexer returned invalid value at height ${height}: ${r.value}`);
      }
      if (!/^[0-9a-fA-F]+$/.test(r.scriptpubkey)) {
        throw new Error(`Indexer returned invalid scriptpubkey at height ${height}: ${r.scriptpubkey}`);
      }
      return r;
    });

  return { height, tweaks, outputs };
}

/**
 * Convert a raw block scan result into tweak entries the scanner can consume.
 *
 * The indexer's `/tweaks/:height` returns one tweak per SP-eligible input in
 * the block, without txid attribution. We pair every tweak with the block's
 * full P2TR output set; the BIP-352 math identifies which (if any) outputs
 * belong to the wallet.
 */
export function blockScanEntryToTweakEntries(block: BlockScanEntry): ScanTweakEntry[] {
  if (block.tweaks.length === 0 || block.outputs.length === 0) return [];

  const outputs: ScanTweakEntry['outputs'] = block.outputs
    .filter((r) => r.scriptpubkey.length === 68 && r.scriptpubkey.toLowerCase().startsWith('5120'))
    .map((r) => ({
      txid: r.txid,
      vout: r.vout,
      xonlyPk: hexToBytes(r.scriptpubkey.slice(4)),
      value: r.value,
      ...(r.spent === true ? { spent: true } : {}),
    }));

  if (outputs.length === 0) return [];

  return block.tweaks.map((tweak) => ({
    height: block.height,
    tweak,
    outputs,
  }));
}

/**
 * Fetch the `ScanTweakEntry[]` for a single block.
 *
 * This is the primary entry point used by the wallet scanner: it fetches both
 * `/tweaks/:height` and `/utxos/:height`, validates the responses, and returns
 * tweak entries ready for {@link scanBatch}.
 */
export async function fetchBlockEntries(
  baseUrl: string,
  height: number,
  signal?: AbortSignal,
  includeSpent = false,
): Promise<ScanTweakEntry[]> {
  const root = baseUrl.replace(/\/$/, '');

  // Fetch tweaks first; if the block has no eligible SP inputs we can skip
  // the UTXO fetch entirely. Empty blocks are common, so this roughly halves
  // the request count on average.
  const tweaksRes = await fetch(`${root}/tweaks/${height}`, { signal, headers: JSON_HEADERS });
  if (!tweaksRes.ok) {
    throw new Error(`Indexer /tweaks/${height} failed: ${tweaksRes.status}`);
  }
  const tweakHexes = (await tweaksRes.json()) as string[];
  const tweaks = tweakHexes.map((h) => {
    if (!/^[0-9a-fA-F]{66}$/.test(h)) {
      throw new Error(`Indexer returned invalid tweak at height ${height}: ${h}`);
    }
    return hexToBytes(h);
  });
  if (tweaks.length === 0) return [];
  if (signal?.aborted) return [];

  const utxosRes = await fetch(`${root}/utxos/${height}`, { signal, headers: JSON_HEADERS });
  if (!utxosRes.ok) {
    throw new Error(`Indexer /utxos/${height} failed: ${utxosRes.status}`);
  }
  const rows = (await utxosRes.json()) as IndexerUtxoRow[];
  const outputs = rows
    .filter((r) => includeSpent || r.spent !== true)
    .map((r) => {
      if (!/^[0-9a-fA-F]{64}$/.test(r.txid)) {
        throw new Error(`Indexer returned invalid txid at height ${height}: ${r.txid}`);
      }
      if (!Number.isInteger(r.vout) || r.vout < 0) {
        throw new Error(`Indexer returned invalid vout at height ${height}: ${r.vout}`);
      }
      if (!Number.isInteger(r.value) || r.value < 0) {
        throw new Error(`Indexer returned invalid value at height ${height}: ${r.value}`);
      }
      if (!/^[0-9a-fA-F]+$/.test(r.scriptpubkey)) {
        throw new Error(`Indexer returned invalid scriptpubkey at height ${height}: ${r.scriptpubkey}`);
      }
      return r;
    });

  return blockScanEntryToTweakEntries({ height, tweaks, outputs });
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
