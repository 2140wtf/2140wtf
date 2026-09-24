/**
 * testnet4Refund - the testnet4 donor_refund spend builder (WS-3).
 *
 * Ported from `scripts/testnet4-claim.ts` so the live runner and the tested
 * core share ONE implementation. Every byte is re-derived and cross-checked
 * against the saved descriptor BEFORE any signature exists; any mismatch
 * throws a typed error and nothing is broadcast. The signing key is the
 * DONOR's key (the donor_refund leaf pays the donor back) - no platform key
 * participates (TESTNET4-RAIL-DESIGN.md §1, §3).
 */
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import {
  bytesToHex,
  hexToBytes,
  p2trScriptPubKey,
  taptreeRoot,
  tweakOutputKey,
  type TapTree,
} from './testnet4Taproot';

export type Testnet4RefundErrorCode =
  | 'descriptor_mismatch'
  | 'utxo_mismatch'
  | 'cltv_mismatch';

export class Testnet4RefundError extends Error {
  readonly code: Testnet4RefundErrorCode;
  constructor(code: Testnet4RefundErrorCode, message: string) {
    super(message);
    this.name = 'Testnet4RefundError';
    this.code = code;
  }
}

export interface SavedContributionDescriptor {
  readonly address: string;
  readonly outputKeyHex: string;
  readonly merkleRootHex: string;
  readonly scriptPubKeyHex: string;
  readonly internalKeyHex: string;
  readonly leaves: ReadonlyArray<{ readonly name: string; readonly scriptHex: string; readonly leafVersion: number }>;
}

export interface BuildRefundSpendInput {
  /** The stage under refund (id/vout/amount/scriptPubKey/refundUnlock). */
  readonly stage: {
    readonly depositTxid: string;
    readonly vout: number;
    readonly amountSats: number;
    readonly scriptPubKeyHex: string;
    readonly refundUnlock: number;
  };
  readonly descriptor: SavedContributionDescriptor;
  /** Donor's taproot secret key hex (the donor_refund leaf signer). */
  readonly donorSecretKeyHex: string;
  /** Deposit tx outputs in order (from the chain adapter's /tx fetch). */
  readonly depositVouts: ReadonlyArray<{ readonly scriptpubkey: string; readonly value: number }>;
  readonly feeSats: number;
}

export interface BuiltRefundSpend {
  readonly rawTxHex: string;
  readonly cltvHeight: number;
  readonly destination: string;
  readonly feeSats: number;
}

/** Rebuild the repo's balanced tree shape from the saved (sorted) leaves. */
function treeFromLeaves(leaves: SavedContributionDescriptor['leaves']): TapTree {
  let level: TapTree[] = leaves
    .slice()
    .sort((a, b) => (a.scriptHex < b.scriptHex ? -1 : 1))
    .map((l) => ({ script: hexToBytes(l.scriptHex), leafVersion: l.leafVersion }) as TapTree);
  if (level.length === 0) throw new Testnet4RefundError('descriptor_mismatch', 'empty leaf set');
  while (level.length > 1) {
    const next: TapTree[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(level[i + 1] ? { l: level[i], r: level[i + 1] } : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Walk the tree from the root to the target leaf, collecting sibling subtree
 * roots nearest-first (BIP-341 control-block order). It CANNOT be derived by
 * re-folding "the other leaves" - it must be walked.
 */
function merklePathTo(tree: TapTree, targetScript: Uint8Array): Uint8Array[] {
  function walk(node: TapTree): Uint8Array[] | null {
    if ('script' in node) {
      return bytesToHex(node.script) === bytesToHex(targetScript) ? [] : null;
    }
    const left = walk(node.l);
    if (left) return [...left, taptreeRoot(node.r)];
    const right = walk(node.r);
    if (right) return [...right, taptreeRoot(node.l)];
    return null;
  }
  const path = walk(tree);
  if (!path) throw new Testnet4RefundError('descriptor_mismatch', 'donor_refund leaf not in the rebuilt tree');
  return path;
}

/**
 * Parse the CLTV height out of a leaf built as `<key> CHECKSIGVERIFY <h> CLTV`:
 * `20 <32B key> ad <push> <h LE> b1`. Only small pushes (≤75B) are accepted;
 * anything else fails closed rather than guessing.
 */
function extractCltvHeight(script: Uint8Array): number {
  if (script.length < 38 || script[0] !== 0x20) {
    throw new Testnet4RefundError('descriptor_mismatch', 'refund leaf: unexpected header');
  }
  if (script[33] !== 0xad) {
    throw new Testnet4RefundError('descriptor_mismatch', `refund leaf: expected OP_CHECKSIGVERIFY, got 0x${script[33].toString(16)}`);
  }
  const op = script[34];
  if (op < 0x01 || op > 0x4b) {
    throw new Testnet4RefundError('descriptor_mismatch', `refund leaf: CLTV push op 0x${op.toString(16)} not a small push`);
  }
  const n = op;
  if (script.length !== 34 + 1 + n + 1 || script[script.length - 1] !== 0xb1) {
    throw new Testnet4RefundError('descriptor_mismatch', 'refund leaf: expected <key> CHECKSIGVERIFY <h> OP_CLTV shape');
  }
  let h = 0;
  for (let i = 0; i < n; i++) h += script[35 + i] * 2 ** (8 * i);
  if (!Number.isSafeInteger(h) || h <= 0 || h >= 500_000_000) {
    throw new Testnet4RefundError('descriptor_mismatch', `refund leaf: implausible CLTV height ${h}`);
  }
  return h;
}

/** The donor_refund leaf's CLTV target, parsed from the saved descriptor. */
export function refundCltvHeight(descriptor: SavedContributionDescriptor): number {
  const leaf = descriptor.leaves.find((l) => l.name === 'donor_refund');
  if (!leaf) throw new Testnet4RefundError('descriptor_mismatch', 'saved descriptor has no donor_refund leaf');
  return extractCltvHeight(hexToBytes(leaf.scriptHex));
}

/**
 * Re-derive the contribution output, verify it against the saved descriptor
 * AND the funded UTXO, then build and sign the donor_refund script-path spend.
 * Throws `Testnet4RefundError` on any mismatch - the caller must not broadcast
 * unless this resolves.
 */
export function buildRefundSpend(input: BuildRefundSpendInput): BuiltRefundSpend {
  const { stage, descriptor } = input;
  const tree = treeFromLeaves(descriptor.leaves);
  const root = bytesToHex(taptreeRoot(tree));
  if (root !== descriptor.merkleRootHex) {
    throw new Testnet4RefundError('descriptor_mismatch', `taptree root mismatch: derived ${root}, saved ${descriptor.merkleRootHex}`);
  }
  const outputKey = bytesToHex(tweakOutputKey(hexToBytes(descriptor.internalKeyHex), hexToBytes(descriptor.merkleRootHex)));
  if (outputKey !== descriptor.outputKeyHex) {
    throw new Testnet4RefundError('descriptor_mismatch', `output key mismatch: derived ${outputKey}, saved ${descriptor.outputKeyHex}`);
  }
  const spkDerived = bytesToHex(p2trScriptPubKey(hexToBytes(outputKey)));
  if (spkDerived !== descriptor.scriptPubKeyHex.toLowerCase() || spkDerived !== stage.scriptPubKeyHex.toLowerCase()) {
    throw new Testnet4RefundError('descriptor_mismatch', `scriptPubKey mismatch: derived ${spkDerived}`);
  }

  const refundLeaf = descriptor.leaves.find((l) => l.name === 'donor_refund');
  if (!refundLeaf) throw new Testnet4RefundError('descriptor_mismatch', 'saved descriptor has no donor_refund leaf');
  const spendScriptBytes = hexToBytes(refundLeaf.scriptHex);
  const cltvHeight = extractCltvHeight(spendScriptBytes);
  if (cltvHeight !== stage.refundUnlock) {
    throw new Testnet4RefundError(
      'cltv_mismatch',
      `leaf CLTV ${cltvHeight} ≠ stage refundUnlock ${stage.refundUnlock}`,
    );
  }

  // Locate the funded output by exact script + value (fail closed).
  const idx = input.depositVouts.findIndex((o) => o.scriptpubkey.toLowerCase() === stage.scriptPubKeyHex.toLowerCase());
  if (idx < 0 || idx !== stage.vout) {
    throw new Testnet4RefundError('utxo_mismatch', `deposit tx has no output ${stage.vout} at the stage scriptPubKey`);
  }
  const value = input.depositVouts[idx].value;
  if (value !== stage.amountSats) {
    throw new Testnet4RefundError('utxo_mismatch', `stage value ${value} ≠ expected ${stage.amountSats} - refusing`);
  }
  if (input.feeSats <= 0 || input.feeSats >= value) {
    throw new Testnet4RefundError('utxo_mismatch', `fee ${input.feeSats} invalid for value ${value}`);
  }

  const merklePath = merklePathTo(tree, spendScriptBytes);
  const [, outputParity] = btc.utils.taprootTweakPubkey(
    hexToBytes(descriptor.internalKeyHex),
    hexToBytes(descriptor.merkleRootHex),
  );
  const spend = new btc.Transaction({ lockTime: cltvHeight, version: 2, allowUnknownInputs: true });
  spend.addInput({
    txid: stage.depositTxid,
    index: idx,
    sequence: 0xfffffffd, // non-final: required for height-based CLTV (BIP-65/342)
    witnessUtxo: { script: hexToBytes(stage.scriptPubKeyHex), amount: BigInt(value) },
    tapLeafScript: [
      [
        {
          // CB version byte carries leafVersion | outputParity.
          version: refundLeaf.leafVersion | outputParity,
          internalKey: hexToBytes(descriptor.internalKeyHex),
          merklePath,
        },
        // scure leaf form: script ‖ parity-free version byte.
        Uint8Array.from([...spendScriptBytes, refundLeaf.leafVersion]),
      ],
    ],
  });

  const signerKey = hexToBytes(input.donorSecretKeyHex);
  // Destination = the donor's OWN taproot address (self-refund), derived from
  // the signing key so funds can never leave to an unrelated party.
  const donorXOnly = btc.utils.pubSchnorr(signerKey);
  const donorPayment = btc.p2tr(donorXOnly, undefined, btc.TEST_NETWORK, true);
  const donorAddress = donorPayment.address;
  spend.addOutput({
    script: donorPayment.script,
    amount: BigInt(value - input.feeSats),
  });

  spend.sign(signerKey);
  spend.finalize();
  return {
    rawTxHex: hex.encode(spend.extract()),
    cltvHeight,
    destination: donorAddress,
    feeSats: input.feeSats,
  };
}
