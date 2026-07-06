/**
 * BIP-352 receiver-side tweak scanner.
 *
 * Consumes per-block "tweak data" from a BlindBit Oracle v2-compatible indexer
 * (see {@link src/lib/sp/indexer.ts}) and checks each tweak against the
 * wallet's scan private key (`b_scan`) and spend public key (`B_spend`). The
 * indexer pre-computes the public per-transaction point `input_hash · A`, so
 * the wallet only needs to complete the ECDH locally with `b_scan`. `b_scan`
 * MUST NEVER leave the device.
 *
 * Label support is deliberately omitted: the receive-only wallet never produces
 * labeled change, and we don't hand out labeled receive addresses. BIP-352's
 * "every receiving wallet should scan for the change label" rule only applies
 * to wallets that may have spent their own SP UTXOs.
 */

import {
  Point,
  bytesToScalar,
  concatBytes,
  equalBytes,
  pointFromBytes,
  taggedHash,
  u32be,
  SECP_N,
} from '../silentPayments';

/**
 * One unit of scanner work: a public tweak plus the set of candidate Taproot
 * outputs it may have produced.
 *
 * Each output carries its own txid because BlindBit's `GET /tweaks/:height`
 * endpoint does not return a tweak ↔ txid mapping — the wallet pairs every
 * tweak in a block against the block's full SP-eligible UTXO set and lets the
 * BIP-352 math pick the right output.
 */
export interface ScanTweakEntry {
  /** Block height the tweak (and its candidate outputs) belongs to. */
  height: number;
  /** Per-tx public tweak: 33-byte compressed `input_hash · A`. */
  tweak: Uint8Array;
  /**
   * Candidate Taproot outputs. Each output carries its txid so the matched
   * UTXO can be attributed correctly even when the indexer pools outputs
   * from multiple txs against the same tweak.
   */
  outputs: ReadonlyArray<{
    txid: string;
    vout: number;
    xonlyPk: Uint8Array;
    value: number;
    spent?: boolean;
  }>;
}

/** A UTXO the scanner determined belongs to us. */
export interface SPMatchedUtxo {
  txid: string;
  vout: number;
  /** Output value in satoshis. */
  value: number;
  /** Block height at which the UTXO was mined. */
  height: number;
  /** Per-output BIP-352 tweak `t_k` (32 bytes). Needed at spend time. */
  tweak: Uint8Array;
  /** Output index within the transaction's SP output set (k = 0, 1, …). */
  k: number;
  /**
   * True if the matching candidate output was marked spent by the indexer
   * at scan time. The orchestrator uses this to route the match into the
   * archive instead of the active set.
   */
  spent?: boolean;
}

/**
 * Check one tweak entry's outputs against the user's SP keys and return every
 * matching UTXO.
 *
 * Per BIP-352 the receiver iterates `k = 0, 1, …` until no output matches the
 * current `k`; we track which outputs have already been claimed so each output
 * matches at most one `k`.
 *
 * Never throws on malformed wire-level inputs — they produce an empty result.
 * Length checks for keys/tweaks are enforced (anything else is a programmer
 * error).
 */
export function scanTweakEntry(
  entry: ScanTweakEntry,
  scanPrivKey: Uint8Array,
  spendPubKey: Uint8Array,
): SPMatchedUtxo[] {
  if (scanPrivKey.length !== 32) throw new Error('scanPrivKey must be 32 bytes');
  if (spendPubKey.length !== 33) throw new Error('spendPubKey must be 33-byte compressed');
  if (entry.tweak.length !== 33) throw new Error('entry.tweak must be 33-byte compressed');

  const scanScalar = bytesToScalar(scanPrivKey);
  if (scanScalar === 0n || scanScalar >= SECP_N) {
    throw new Error('Invalid scan private key.');
  }

  // shared = b_scan · tweak  ==  b_scan · (input_hash · A)  ==  input_hash · a · B_scan
  // — the same shared secret the sender computed.
  const tweakPoint = pointFromBytes(entry.tweak);
  const shared = tweakPoint.multiply(scanScalar).toBytes(true);

  if (entry.outputs.length === 0) return [];

  const spendPoint = pointFromBytes(spendPubKey);
  const remaining = new Set<number>(entry.outputs.map((_, i) => i));
  const matches: SPMatchedUtxo[] = [];

  let k = 0;
  const MAX_K = 2323; // BIP-352 suggested upper bound for wallet scanning.

  while (remaining.size > 0 && k < MAX_K) {
    const tK = taggedHash('BIP0352/SharedSecret', concatBytes(shared, u32be(k)));
    const tScalar = bytesToScalar(tK);
    if (tScalar === 0n || tScalar >= SECP_N) {
      k++;
      continue;
    }

    const P = spendPoint.add(Point.BASE.multiply(tScalar));
    const Paff = P.toAffine();
    if (Paff.x === 0n && Paff.y === 0n) {
      k++;
      continue;
    }
    const xonly = P.toBytes(true).subarray(1, 33);

    let matchedIdx: number | null = null;
    for (const i of remaining) {
      if (equalBytes(entry.outputs[i].xonlyPk, xonly)) {
        matchedIdx = i;
        break;
      }
    }
    if (matchedIdx === null) break;

    const o = entry.outputs[matchedIdx];
    matches.push({
      txid: o.txid,
      vout: o.vout,
      value: o.value,
      height: entry.height,
      tweak: tK,
      k,
      ...(o.spent ? { spent: true } : {}),
    });
    remaining.delete(matchedIdx);
    k++;
  }

  return matches;
}

interface ScanBatchOptions {
  /** Yield to the event loop every N processed entries. Default: 64. */
  yieldEvery?: number;
  /** Called after each yield with the highest height fully processed. */
  onProgress?: (height: number) => void;
  /** Abort signal — when triggered, the scanner returns whatever it has so far. */
  signal?: AbortSignal;
}

/**
 * Walk a batch of tweak entries, scanning each against the user's SP keys.
 * Yields to the event loop periodically so a long scan doesn't freeze the UI.
 *
 * Entries SHOULD be sorted by (height, position) so `onProgress` reports
 * monotonic heights. Malformed entries are skipped silently.
 */
export async function scanBatch(
  entries: ReadonlyArray<ScanTweakEntry>,
  scanPrivKey: Uint8Array,
  spendPubKey: Uint8Array,
  opts: ScanBatchOptions = {},
): Promise<SPMatchedUtxo[]> {
  const yieldEvery = opts.yieldEvery ?? 64;
  const matches: SPMatchedUtxo[] = [];
  let lastReportedHeight = -1;
  let processedSinceYield = 0;

  for (const entry of entries) {
    if (opts.signal?.aborted) break;

    try {
      const hit = scanTweakEntry(entry, scanPrivKey, spendPubKey);
      if (hit.length > 0) matches.push(...hit);
    } catch {
      // Malformed entry — skip rather than abort the whole batch.
    }

    if (entry.height > lastReportedHeight) {
      lastReportedHeight = entry.height;
    }

    processedSinceYield += 1;
    if (processedSinceYield >= yieldEvery) {
      processedSinceYield = 0;
      opts.onProgress?.(lastReportedHeight);
      // Yield to the macrotask queue so React renders + user input can run.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (lastReportedHeight >= 0) {
    opts.onProgress?.(lastReportedHeight);
  }

  return matches;
}
