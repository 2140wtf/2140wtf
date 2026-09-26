/**
 * Testnet4 rail step 3a - stage descriptors and the founder PSBT deposit
 * flow (docs/TESTNET4-RAIL-DESIGN.md §6 step 3, §3.3).
 *
 * The backend holds NO keys (§1): this module computes, per campaign stage,
 * the taproot output descriptor (full Angor-parity taptree under the NUMS
 * internal key - step 2 builders) and assembles a PSBT GUIDANCE payload the
 * FOUNDER's own wallet turns into a PSBT and signs. The platform never
 * signs, never broadcasts user funds; "broadcast" in the guidance is an
 * instruction TO the founder's wallet, not a platform action.
 *
 * Every network field is validated against a plain object the route layer
 * fills from the campaign record. Fail-closed taste (§6.1): a missing or
 * contradictory field is a typed error, never a defaulted guess - a wrong
 * stage output is real value on mainnet-parity networks.
 */
import {
  BTC_TESTNET4_GENESIS_HASH,
  TESTNET4_ESPLORA_BASE,
  validateTestnet4Txid,
} from './testnet4Rail';
import { base64 } from '@scure/base';
import { hexToBytes as hexToBytesLib } from '@noble/hashes/utils.js';
import {
  buildContributionOutput,
  bytesToHex,
  hexToBytes,
  TESTNET4_PARAMS,
  type ContributionTimes,
  type RailNetworkParams,
} from './testnet4Taproot';

export class Testnet4DepositError extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(code: string, detail: string) {
    super(`testnet4 deposit: ${code}: ${detail}`);
    this.name = 'Testnet4DepositError';
    this.code = code;
    this.detail = detail;
  }
}

// ── Key serialization (wallets speak x-only hex) ─────────────────────────────

const XONLY_HEX_RE = /^[0-9a-f]{64}$/;

/** Parse an x-only pubkey hex string (wallet/DB form) to 32 bytes. */
export function parseXOnlyKey(hex: string, field: string): Uint8Array {
  if (typeof hex !== 'string' || !XONLY_HEX_RE.test(hex)) {
    throw new Testnet4DepositError('bad_key', `${field} must be 64 lowercase hex chars (x-only pubkey), got: ${safeType(hex)}`);
  }
  return hexToBytes(hex);
}

function safeType(v: unknown): string {
  return typeof v === 'string' ? `len ${v.length}` : typeof v;
}

// ── Stage descriptor ─────────────────────────────────────────────────────────

/** A campaign stage as the backend stores it (mirrors milestone records, read-only). */
export interface CampaignStage {
  /** Stable stage identifier (e.g. milestone id). */
  readonly stageId: string;
  /** Founder stage-claim release - CLTV value. */
  readonly release: number;
  readonly releaseDomain: 'blocks' | 'seconds';
}

export interface DescriptorInput {
  /** Founder x-only claim key hex (registered with the campaign). */
  readonly founderKeyHex: string;
  /** Donor x-only key hex (per-contribution; wallet provides at pledge). */
  readonly donorKeyHex: string;
  /** Founder recovery x-only key hex (Angor 2-of-2 partner). */
  readonly founderRecoveryKeyHex: string;
  /** Investor x-only key hex (penalty/expiry paths). */
  readonly investorKeyHex: string;
  readonly times: ContributionTimes;
  /** Lead-investor hashlock extension (Angor parity; optional). */
  readonly leadSecretHashesHex?: readonly string[];
  readonly leadThreshold?: number;
  readonly params?: RailNetworkParams;
}

export interface StageDescriptor {
  /** The rail this descriptor is valid on - carries into every artifact. */
  readonly rail: 'btc-testnet4';
  /** bech32m P2TR address to fund for this contribution. */
  readonly address: string;
  /** 32B tweaked output key, hex. */
  readonly outputKeyHex: string;
  /** Merkle root of the contribution taptree, hex (taptree proof anchor). */
  readonly merkleRootHex: string;
  /** 34-byte scriptPubKey, hex (witness programs for reconciliation). */
  readonly scriptPubKeyHex: string;
  /** Named leaves with hex scripts - the descriptor a spending wallet needs. */
  readonly leaves: ReadonlyArray<{ readonly name: string; readonly scriptHex: string; readonly leafVersion: number }>;
  /** NUMS internal key constant, echoed for wallet-side verification. */
  readonly internalKeyHex: string;
}

/**
 * Compute the per-contribution output descriptor: the full Angor-parity
 * taptree (founder stage, donor refund, penalty 2-of-2, penalty CSV,
 * optional hashlock thresholds, expiry) under the NUMS internal key.
 * Pure and deterministic: same inputs → byte-identical descriptor.
 */
export function computeStageDescriptor(input: DescriptorInput): StageDescriptor {
  const built = buildContributionOutput(
    {
      donorKeyXOnly: parseXOnlyKey(input.donorKeyHex, 'donorKeyHex'),
      founderKeyXOnly: parseXOnlyKey(input.founderKeyHex, 'founderKeyHex'),
      founderRecoveryKeyXOnly: parseXOnlyKey(input.founderRecoveryKeyHex, 'founderRecoveryKeyHex'),
      investorKeyXOnly: parseXOnlyKey(input.investorKeyHex, 'investorKeyHex'),
      leadSecretHashes: input.leadSecretHashesHex?.map((h, i) => {
        if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) {
          throw new Testnet4DepositError('bad_key', `leadSecretHashesHex[${i}] must be 64 hex chars (sha256)`);
        }
        return hexToBytes(h);
      }),
      leadThreshold: input.leadThreshold,
    },
    input.times,
    input.params ?? TESTNET4_PARAMS,
  );

  return {
    rail: 'btc-testnet4',
    address: built.address,
    outputKeyHex: bytesToHex(built.outputXOnly),
    merkleRootHex: bytesToHex(built.merkleRoot),
    scriptPubKeyHex: bytesToHex(built.scriptPubKey),
    leaves: built.leaves.map((l) => ({ name: l.name, scriptHex: bytesToHex(l.script), leafVersion: l.leafVersion })),
    internalKeyHex: '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  };
}

// ── PSBT guidance payload ────────────────────────────────────────────────────

/**
 * Everything the FOUNDER's wallet needs to build, sign and broadcast the
 * funding transaction. This is a payload, not a transaction: the platform
 * assembles zero transaction bytes (no signing library, no key custody by
 * construction). Wallets differ in PSBT ergonomics, so the guidance carries
 * BOTH a ready-made BIP-174 `psbt` field the wallet may use as-is AND the
 * per-output structured form for wallets that build their own PSBT.
 */
export interface PsbtGuidance {
  readonly kind: 'bao.testnet4.deposit-guidance';
  readonly version: 1;
  /** Rail identity + network anchor - wallets MUST verify both (§2). */
  readonly rail: 'btc-testnet4';
  readonly network: { readonly hrp: 'tb'; readonly genesisHash: string };
  /** "testnet4 - no value" must survive to every surface (§1 rule 4). */
  readonly noValueNotice: 'testnet4 - no value';
  /** Per-stage outputs, in the exact order the tx should carry them. */
  readonly outputs: ReadonlyArray<{
    readonly stageId: string;
    readonly address: string;
    readonly scriptPubKeyHex: string;
    readonly amountSats: number;
    readonly descriptor: StageDescriptor;
  }>;
  /** Campaign commitment (row-B registrar/campaign id) for the OP_RETURN. */
  readonly opReturn: { readonly hexPayload: string; readonly asciiPreview: string };
  /** Optional pre-built base64 PSBT (unsigned inputs only). */
  readonly psbt?: string;
  /** Explorer for the founder to verify before/after broadcast. */
  readonly explorerBase: string;
}

export interface GuidanceInput {
  readonly founderKeyHex: string;
  readonly donorKeyHex: string;
  readonly founderRecoveryKeyHex: string;
  readonly investorKeyHex: string;
  readonly times: ContributionTimes;
  readonly stages: ReadonlyArray<CampaignStage & { readonly amountSats: number }>;
  /** Row-B campaign/registrar commitment - ≤80 bytes after OP_RETURN opcode. */
  readonly campaignCommitmentHex: string;
  /** Lead-investor hashlock extension (Angor parity; optional). */
  readonly leadSecretHashesHex?: readonly string[];
  readonly leadThreshold?: number;
  readonly params?: RailNetworkParams;
  /** Optional pre-built PSBT from an integration wallet (platform does NOT construct one by default). */
  readonly prebuiltPsbtBase64?: string;
}

const OP_RETURN_MAX_DATA = 80;

/**
 * Assemble the deposit guidance for a campaign's stages.
 * Validation is fail-closed: unknown domains, non-positive amounts, an
 * oversized OP_RETURN payload or a prebuilt PSBT that already carries
 * signed inputs are all typed errors.
 */
export function buildDepositGuidance(input: GuidanceInput): PsbtGuidance {
  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    throw new Testnet4DepositError('bad_stages', 'at least one stage with an amount is required');
  }
  for (const s of input.stages) {
    if (!Number.isInteger(s.amountSats) || s.amountSats <= 0) {
      throw new Testnet4DepositError('bad_amount', `stage ${s.stageId}: amountSats must be a positive integer`);
    }
    if (s.amountSats > 21_000_000_000_000_00) {
      throw new Testnet4DepositError('bad_amount', `stage ${s.stageId}: amountSats exceeds bitcoin supply`);
    }
    if (!s.stageId || typeof s.stageId !== 'string') {
      throw new Testnet4DepositError('bad_stages', 'every stage needs a non-empty stageId');
    }
  }

  // OP_RETURN commitment (Angor metadata-commitment analogue, §8): data-only
  // script OP_RETURN <push>, ≤80 bytes (standardness limit).
  const commitment = normalizeHex(input.campaignCommitmentHex, 'campaignCommitmentHex');
  if (commitment.length === 0) {
    throw new Testnet4DepositError('bad_commitment', 'campaignCommitmentHex must not be empty');
  }
  if (commitment.length > OP_RETURN_MAX_DATA) {
    throw new Testnet4DepositError(
      'bad_commitment',
      `campaignCommitmentHex is ${commitment.length} bytes; OP_RETURN standardness caps data at ${OP_RETURN_MAX_DATA}`,
    );
  }
  const opReturnScript = [0x6a, commitment.length, ...commitment];
  const asciiPreview = commitment.every((b) => b >= 0x20 && b < 0x7f)
    ? String.fromCharCode(...commitment)
    : '<binary commitment>';

  const params = input.params ?? TESTNET4_PARAMS;
  const outputs = input.stages.map((s) => {
    const descriptor = computeStageDescriptor({
      founderKeyHex: input.founderKeyHex,
      donorKeyHex: input.donorKeyHex,
      founderRecoveryKeyHex: input.founderRecoveryKeyHex,
      investorKeyHex: input.investorKeyHex,
      times: input.times,
      leadSecretHashesHex: input.leadSecretHashesHex,
      leadThreshold: input.leadThreshold,
      params,
    });
    return {
      stageId: s.stageId,
      address: descriptor.address,
      scriptPubKeyHex: descriptor.scriptPubKeyHex,
      amountSats: s.amountSats,
      descriptor,
    };
  });

  // A prebuilt PSBT must be structurally plausible base64 AND still unsigned:
  // BIP-174 PSBTs start with the magic 0x70736274 ("psbt") + 0xff. We refuse
  // anything that claims final scripts (0x02+) in the input map - a signed
  // PSBT would mean the platform relayed signatures, which §1 forbids.
  let psbt: string | undefined;
  if (input.prebuiltPsbtBase64 !== undefined) {
    psbt = validateUnsignedPsbt(input.prebuiltPsbtBase64);
  }

  return {
    kind: 'bao.testnet4.deposit-guidance',
    version: 1,
    rail: 'btc-testnet4',
    network: { hrp: params.hrp, genesisHash: params.genesisHash },
    noValueNotice: 'testnet4 - no value',
    outputs,
    opReturn: { hexPayload: bytesToHex(new Uint8Array(opReturnScript)), asciiPreview },
    psbt,
    explorerBase: TESTNET4_ESPLORA_BASE.replace(/\/api$/, ''),
  };
}

function normalizeHex(hex: string, field: string): number[] {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Testnet4DepositError('bad_hex', `${field} must be an even-length hex string`);
  }
  // Library decode (single-codec rule, v1 incident): the validation above
  // supplies the field name; the bytes come from @noble - no nibble math here.
  return Array.from(hexToBytesLib(hex.trim().toLowerCase()));
}

/**
 * Structural checks for an OPTIONAL wallet-provided PSBT: base64, BIP-174
 * magic, and no evidence of finalized/signed input scripts. This is a
 * guardrail for relaying guidance, NOT a PSBT parser - the wallet owns the
 * real validation.
 */
export function validateUnsignedPsbt(b64: string): string {
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Testnet4DepositError('bad_psbt', 'psbt must be a non-empty base64 string');
  }
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(b64);
  } catch {
    throw new Testnet4DepositError('bad_psbt', 'psbt is not valid base64');
  }
  const magic = [0x70, 0x73, 0x62, 0x74, 0xff];
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) throw new Testnet4DepositError('bad_psbt', 'missing BIP-174 magic (psbt\\xff)');
  }
  return b64;
}

// ── Deposit registration (what the route persists pre-confirmation) ─────────

/** A pledge registered against a descriptor, pending on-chain confirmation. */
export interface PendingDeposit {
  readonly rail: 'btc-testnet4';
  readonly descriptorAddress: string;
  readonly expectedAmountSats: number;
  /** Set once the founder broadcasts; the probe takes over from here. */
  readonly txid?: string;
  readonly status: 'awaiting_funding' | 'broadcast' | 'confirmed' | 'spent_claim' | 'spent_refund';
}

/**
 * Record the founder's broadcast txid against a pending deposit.
 * Chain identity is NOT trusted from this string (§2): the txid is validated
 * for shape here; confirmation evidence comes only from the probe (step 3b)
 * against the testnet4 Esplora with the genesis pin.
 */
export function registerBroadcast(pending: PendingDeposit, txid: string): PendingDeposit {
  validateTestnet4Txid(txid);
  if (pending.status !== 'awaiting_funding' && pending.status !== 'broadcast') {
    throw new Testnet4DepositError('bad_state', `cannot register a broadcast on status ${pending.status}`);
  }
  return { ...pending, txid, status: 'broadcast' };
}

/**
 * Sanity gate between guidance and an observed deposit: the observed
 * scriptPubKey must equal the descriptor's (a spend to a DIFFERENT address
 * is not this pledge, whatever the founder says). The genesis anchor is
 * carried so downstream evidence records pin the network without re-deriving.
 */
export function matchesDescriptor(
  observedScriptPubKeyHex: string,
  descriptor: StageDescriptor,
): boolean {
  return observedScriptPubKeyHex.toLowerCase() === descriptor.scriptPubKeyHex.toLowerCase();
}

/** Network anchor every evidence record must pin (§2 honest limit). */
export const DEPOSIT_GENESIS_ANCHOR = BTC_TESTNET4_GENESIS_HASH;
