/**
 * Liquid-testnet rail steps 3–6 - stage descriptors and PSBT guidance
 * composed with the SHARED taproot builders (design §6, the "steps 2–6
 * reuse the Testnet4 builders" parameterization plan).
 *
 * The ONE structural change this rail requires: RailNetworkParams.rail is
 * a 'btc-testnet4' literal, and StageDescriptor/PsbtGuidance embed rail
 * strings from the bitcoin module. Rather than fork those types, this
 * module composes at the builder level (buildContributionOutput + the
 * taptree/address math via computeStageDescriptor with a Liquid params
 * object) and re-maps the RESULT into Liquid-typed artifacts with the
 * correct rail id, network anchors and no-value notice:
 *
 *   - LIQUID_TESTNET_PARAMS extends the shared params shape with the
 *     liquid-testnet facts: rail 'liquid-testnet', hrp 'tex', the live
 *     genesis pin, and the SAME timelock defaults as testnet4 (the owner's
 *     mainnet-parity ruling: nothing dropped between rails).
 *   - computeLiquidStageDescriptor → StageDescriptor-shaped artifact with
 *     rail: 'liquid-testnet' and tex addresses, byte-identical scripts to
 *     the shared builders (same NUMS key, same leaf set, same fold).
 *   - buildLiquidDepositGuidance → guidance with the Liquid network
 *     anchors, the liquid no-value notice, and the liquid Esplora base.
 *
 * Fail-closed inherits from the shared module: bad keys, bad times, an
 * oversized OP_RETURN and a signed prebuilt PSBT are all typed refusals
 * BEFORE any artifact exists. Times semantics (locktime threshold rule)
 * are enforced by the shared leaf builders.
 *
 * Steps 4–6 coverage (same modules, Liquid params):
 *   - step 4 (spend observation): testnet4Observe.ts is byte-equality
 *     over THIS rail's leaf scripts - works unchanged because leaves are
 *     pure functions of (key, locktime) with no network bytes in them;
 *   - step 5 (pledge modal): the frontend surface ships with the rail id
 *     + badge + explorer links from liquidTestnetRail.ts;
 *   - step 6 (agent path): agentContribution passes req.rail through the
 *     gate, which now admits 'liquid-testnet' behind BAO_LQ_ENABLED=1.
 */
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
// No sibling imports from the bitcoin module are needed: the builders live
// in testnet4Taproot (shared math) and the result mapping is local.
import {
  buildContributionOutput,
  NUMS_INTERNAL_XONLY,
  TESTNET4_PARAMS,
  type ContributionTimes,
  type RailNetworkParams,
} from './testnet4Taproot';
import { parseXOnlyKey, validateUnsignedPsbt } from './testnet4Deposit';
import {
  LEAF_VERSION_ELEMENTS,
  taptreeRootE,
  treeFromLeavesE,
  tweakOutputKeyE,
} from './elementsTaproot';
import {
  p2trAddress,
  p2trScriptPubKey,
} from './testnet4Taproot';
import {
  LIQUID_TESTNET_ESPLORA_BASE,
  LIQUID_TESTNET_GENESIS_HASH,
  LIQUID_TESTNET_HRP,
  LIQUID_TESTNET_NATIVE_ASSET_ID,
  LIQUID_TESTNET_NO_VALUE_BADGE,
} from './liquidTestnetRail';

export class LiquidDepositError extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(code: string, detail: string) {
    super(`liquid deposit: ${code}: ${detail}`);
    this.name = 'LiquidDepositError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Liquid-testnet network parameters. Extends the shared shape's VALUES
 * (rail/hrp/genesis) while keeping the owner's timelock defaults - the
 * mainnet-parity ruling applies between rails too: nothing dropped.
 */
export const LIQUID_TESTNET_PARAMS: Readonly<
  Omit<RailNetworkParams, 'rail' | 'hrp'> & { rail: 'liquid-testnet'; hrp: typeof LIQUID_TESTNET_HRP }
> = {
  rail: 'liquid-testnet',
  hrp: LIQUID_TESTNET_HRP,
  genesisHash: LIQUID_TESTNET_GENESIS_HASH,
  minConfirmations: TESTNET4_PARAMS.minConfirmations, // owner call 2 twin
  refundLocktimeBlocks: TESTNET4_PARAMS.refundLocktimeBlocks, // 72 ≈ 1h at 60s blocks
  penaltyLocktimeBlocks: TESTNET4_PARAMS.penaltyLocktimeBlocks, // 144 ≈ 2.5h at 60s blocks
};

/** A campaign stage as the backend stores it (mirrors the testnet4 shape). */
export interface LiquidCampaignStage {
  readonly stageId: string;
  readonly release: number;
  readonly releaseDomain: 'blocks' | 'seconds';
}

export interface LiquidDescriptorInput {
  readonly founderKeyHex: string;
  readonly donorKeyHex: string;
  readonly founderRecoveryKeyHex: string;
  readonly investorKeyHex: string;
  readonly times: ContributionTimes;
  readonly leadSecretHashesHex?: readonly string[];
  readonly leadThreshold?: number;
}

export interface LiquidStageDescriptor {
  readonly rail: 'liquid-testnet';
  readonly address: string;
  readonly outputKeyHex: string;
  readonly merkleRootHex: string;
  readonly scriptPubKeyHex: string;
  readonly leaves: ReadonlyArray<{ readonly name: string; readonly scriptHex: string; readonly leafVersion: number }>;
  readonly internalKeyHex: string;
}

/**
 * Per-contribution output descriptor on liquid-testnet: the FULL
 * Angor-parity leaf set under the NUMS internal key - the same scripts a
 * testnet4 descriptor would carry (taproot math is chain-agnostic), only
 * the ADDRESS encoding differs (tex HRP). Deterministic: same inputs →
 * byte-identical output.
 */
export function computeLiquidStageDescriptor(input: LiquidDescriptorInput): LiquidStageDescriptor {
  // Script BYTES come from the shared builders (single source of scripts).
  // The HASH DOMAIN is ELEMENTS (see elementsTaproot.ts header): leaf
  // version 0xc4 and /elements tagged hashes. Using Bitcoin-domain math
  // here produced a real on-chain loss (50k testnet sats, 2026-09-13):
  // the funded output's control-block commitment can never verify under
  // Elements sighash - 'Witness program hash mismatch' at broadcast.
  let built;
  try {
    // The shared builder is rail-agnostic except for params.hrp; the rail
    // LITERAL inside RailNetworkParams is never read by it (only hrp is),
    // so the shared params object would encode a tb address - we pass
    // Liquid params and re-map the rail below. Root/output key are then
    // RE-DERIVED in the Elements domain; scripts are reused verbatim.
    built = buildContributionOutput(
      {
        donorKeyXOnly: parseXOnlyKey(input.donorKeyHex, 'donorKeyHex'),
        founderKeyXOnly: parseXOnlyKey(input.founderKeyHex, 'founderKeyHex'),
        founderRecoveryKeyXOnly: parseXOnlyKey(input.founderRecoveryKeyHex, 'founderRecoveryKeyHex'),
        investorKeyXOnly: parseXOnlyKey(input.investorKeyHex, 'investorKeyHex'),
        leadSecretHashes: input.leadSecretHashesHex?.map((h, i) => {
          if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) {
            throw new LiquidDepositError('bad_key', `leadSecretHashesHex[${i}] must be 64 hex chars (sha256)`);
          }
          return hexToBytes(h);
        }),
        leadThreshold: input.leadThreshold,
      },
      input.times,
      { ...TESTNET4_PARAMS, hrp: LIQUID_TESTNET_HRP } as unknown as Parameters<typeof buildContributionOutput>[2],
    );
  } catch (err) {
    // Re-label bitcoin-module errors as this rail's typed errors (codes
    // and details are preserved - audit continuity), never silent.
    if (err instanceof Error && err.name === 'Testnet4DepositError') {
      throw new LiquidDepositError((err as unknown as { code: string }).code, err.message);
    }
    if (err instanceof Error && err.name === 'TaprootRailError') {
      throw new LiquidDepositError('bad_tree', err.message);
    }
    throw err;
  }

  // ELEMENTS-domain re-derivation over the SAME script bytes.
  const eTree = treeFromLeavesE(built.leaves.map((l) => ({ scriptHex: bytesToHex(l.script), leafVersion: LEAF_VERSION_ELEMENTS })));
  const eRoot = taptreeRootE(eTree);
  const eOutputKey = tweakOutputKeyE(hexToBytes(NUMS_INTERNAL_XONLY), eRoot);
  return {
    rail: 'liquid-testnet',
    address: p2trAddress(eOutputKey, LIQUID_TESTNET_HRP),
    outputKeyHex: bytesToHex(eOutputKey),
    merkleRootHex: bytesToHex(eRoot),
    scriptPubKeyHex: bytesToHex(p2trScriptPubKey(eOutputKey)),
    leaves: built.leaves.map((l) => ({ name: l.name, scriptHex: bytesToHex(l.script), leafVersion: LEAF_VERSION_ELEMENTS })),
    internalKeyHex: NUMS_INTERNAL_XONLY,
  };
}

/** Guidance payload for the founder's wallet - Liquid-typed (§3.3 pattern). */
export interface LiquidPsbtGuidance {
  readonly kind: 'bao.liquid-testnet.deposit-guidance';
  readonly version: 1;
  readonly rail: 'liquid-testnet';
  readonly network: { readonly hrp: typeof LIQUID_TESTNET_HRP; readonly genesisHash: string };
  readonly nativeAssetId: string;
  /** No-value notice - the Liquid badge text, never styled like mainnet. */
  readonly noValueNotice: typeof LIQUID_TESTNET_NO_VALUE_BADGE;
  readonly outputs: ReadonlyArray<{
    readonly stageId: string;
    readonly address: string;
    readonly scriptPubKeyHex: string;
    readonly amountSats: number;
    readonly descriptor: LiquidStageDescriptor;
  }>;
  readonly opReturn: { readonly hexPayload: string; readonly asciiPreview: string };
  readonly psbt?: string;
  readonly explorerBase: string;
}

export interface LiquidGuidanceInput {
  readonly founderKeyHex: string;
  readonly donorKeyHex: string;
  readonly founderRecoveryKeyHex: string;
  readonly investorKeyHex: string;
  readonly times: ContributionTimes;
  readonly stages: ReadonlyArray<LiquidCampaignStage & { readonly amountSats: number }>;
  readonly campaignCommitmentHex: string;
  readonly leadSecretHashesHex?: readonly string[];
  readonly leadThreshold?: number;
  readonly prebuiltPsbtBase64?: string;
}

const OP_RETURN_MAX_DATA = 80;

/**
 * Assemble the liquid-testnet deposit guidance. Fail-closed validations
 * mirror the bitcoin module exactly (stages, amounts, OP_RETURN ≤80B,
 * unsigned-only prebuilt PSBT) - a guidance payload must never exist with
 * a wrong rail string or an oversized commitment.
 */
export function buildLiquidDepositGuidance(input: LiquidGuidanceInput): LiquidPsbtGuidance {
  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    throw new LiquidDepositError('bad_stages', 'at least one stage with an amount is required');
  }
  for (const s of input.stages) {
    if (!Number.isInteger(s.amountSats) || s.amountSats <= 0) {
      throw new LiquidDepositError('bad_amount', `stage ${s.stageId}: amountSats must be a positive integer`);
    }
    if (s.amountSats > 2_100_000_000_000_00) {
      throw new LiquidDepositError('bad_amount', `stage ${s.stageId}: amountSats exceeds bitcoin-supply scale`);
    }
    if (!s.stageId || typeof s.stageId !== 'string') {
      throw new LiquidDepositError('bad_stages', 'every stage needs a non-empty stageId');
    }
  }

  const commitment = normalizeHex(input.campaignCommitmentHex, 'campaignCommitmentHex');
  if (commitment.length === 0) {
    throw new LiquidDepositError('bad_commitment', 'campaignCommitmentHex must not be empty');
  }
  if (commitment.length > OP_RETURN_MAX_DATA) {
    throw new LiquidDepositError(
      'bad_commitment',
      `campaignCommitmentHex is ${commitment.length} bytes; OP_RETURN standardness caps data at ${OP_RETURN_MAX_DATA}`,
    );
  }
  const opReturnScript = [0x6a, commitment.length, ...commitment];
  const asciiPreview = commitment.every((b) => b >= 0x20 && b < 0x7f)
    ? String.fromCharCode(...commitment)
    : '<binary commitment>';

  const outputs = input.stages.map((s) => {
    const descriptor = computeLiquidStageDescriptor({
      founderKeyHex: input.founderKeyHex,
      donorKeyHex: input.donorKeyHex,
      founderRecoveryKeyHex: input.founderRecoveryKeyHex,
      investorKeyHex: input.investorKeyHex,
      times: input.times,
      leadSecretHashesHex: input.leadSecretHashesHex,
      leadThreshold: input.leadThreshold,
    });
    return {
      stageId: s.stageId,
      address: descriptor.address,
      scriptPubKeyHex: descriptor.scriptPubKeyHex,
      amountSats: s.amountSats,
      descriptor,
    };
  });

  let psbt: string | undefined;
  if (input.prebuiltPsbtBase64 !== undefined) {
    // Shared guardrail: BIP-174 magic + unsigned-inputs-only (a signed PSBT
    // would mean the platform relayed signatures - non-custody violation).
    psbt = validateUnsignedPsbt(input.prebuiltPsbtBase64);
  }

  return {
    kind: 'bao.liquid-testnet.deposit-guidance',
    version: 1,
    rail: 'liquid-testnet',
    network: { hrp: LIQUID_TESTNET_HRP, genesisHash: LIQUID_TESTNET_GENESIS_HASH },
    nativeAssetId: LIQUID_TESTNET_NATIVE_ASSET_ID,
    noValueNotice: LIQUID_TESTNET_NO_VALUE_BADGE,
    outputs,
    opReturn: { hexPayload: bytesToHex(new Uint8Array(opReturnScript)), asciiPreview },
    psbt,
    explorerBase: LIQUID_TESTNET_ESPLORA_BASE.replace(/\/api$/, ''),
  };
}

function normalizeHex(hex: string, field: string): number[] {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new LiquidDepositError('bad_hex', `${field} must be an even-length hex string`);
  }
  return Array.from(hexToBytes(hex.trim().toLowerCase()));
}
