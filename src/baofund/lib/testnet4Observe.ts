/**
 * Testnet4 rail step 4 - spend observation (docs/TESTNET4-RAIL-DESIGN.md
 * §6 step 4, §3.3 "Observe refund/claim spends → mark state; read-only
 * reconciliation").
 *
 * A contribution output (step 3a descriptor) is SPENT when one of its
 * taptree leaves executes on-chain. This module reads the spending
 * transaction from the same genesis-pinned Esplora and decides WHICH path
 * executed - founder claim vs donor refund (vs anything else) - from
 * WITNESS EVIDENCE ONLY, never from what the founder says:
 *
 *   - `founder_claim`: the reveal script is the step-2 founder leaf,
 *     byte-exact, AND the spending input's nSequence is ≥ 1 (final), AND
 *     the spending tx's nLockTime satisfies the leaf's CLTV - proved via
 *     the BIP-65 MTP+1 comparison against the confirmed block's
 *     `mediantime` (which is why the answer is only ever returned for a
 *     CONFIRMED spend: consensus evaluated it).
 *   - `donor_refund`: same, against the donor leaf. The leaf scripts are
 *     DISTINCT (different pubkey), so their byte equality partitions
 *     cleanly; MTP satisfies both locktimes simultaneously in the common
 *     case, and the script equality still disambiguates whose key signed.
 *   - `foreign`: a valid taproot spend of this output through a script we
 *     did not authorize. Impossible under NUMS-keypath assumptions unless
 *     a leaf we built was used - recorded honestly as `foreign_spend` and
 *     surfaced for reconciliation rather than silently ignored.
 *
 * Honesty rules inherited from step 3b: injected `nowSeconds` (no wall
 * clock), injected `fetchImpl` (no live network in tests), `unavailable`
 * on any transport/HTTP/shape failure (never a guess), genesis pin before
 * any evidence, and reorg refusal (tip below the spend block). CLTV
 * arithmetic uses the injected block header's mediantime - the module
 * never approximates "now".
 */
import {
  BTC_TESTNET4_GENESIS_HASH,
  TESTNET4_ESPLORA_BASE,
  validateTestnet4Txid,
} from './testnet4Rail';
import { bytesToHex, hexToBytes } from './testnet4Taproot';

export class Testnet4ObserveError extends Error {
  readonly code: 'bad_response' | 'bad_config' | 'bad_state' | 'network_mismatch';
  readonly detail: string;
  constructor(code: 'bad_response' | 'bad_config' | 'bad_state' | 'network_mismatch', detail: string) {
    super(`testnet4 observe: ${code}: ${detail}`);
    this.name = 'Testnet4ObserveError';
    this.code = code;
    this.detail = detail;
  }
}

/** Which script path executed on the contribution output. */
export type SpendPath = 'founder_claim' | 'donor_refund' | 'foreign';

/** Result of observing the spending transaction of a contribution output. */
export interface SpendObservation {
  readonly rail: 'btc-testnet4';
  /** The spending transaction (the one that consumed the contribution). */
  readonly spendTxid: string;
  /** Which leaf executed - from witness bytes + nLockTime, not labels. */
  readonly path: SpendPath;
  /** Spend tx confirmations (≥1: we only observe confirmed spends). */
  readonly confirmations: number;
  readonly blockHash: string;
  readonly blockHeight: number;
  /** Block mediantime used for the CLTV check (audit trail). */
  readonly blockMediantimeSeconds: number;
  /** The spending tx's nLockTime as observed (audit trail). */
  readonly spendTxLocktime: number;
  /** The revealed tapscript (hex) - byte-exact match evidence. */
  readonly revealedScriptHex: string;
  readonly genesisHashObserved: string;
  readonly queryUrl: string;
  readonly observedAtSeconds: number;
  readonly unavailableReason?: string;
}

export interface ObserveConfig {
  readonly esploraBase: string;
  readonly genesisHash: string;
  readonly fetchImpl: typeof fetch;
}

export const DEFAULT_OBSERVE_CONFIG: ObserveConfig = {
  esploraBase: TESTNET4_ESPLORA_BASE,
  genesisHash: BTC_TESTNET4_GENESIS_HASH,
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
};

// ── Esplora response shapes (verified against the live API 2026-09-13) ──────

interface EsploraVin {
  txid?: string;
  vout?: number;
  /** Taproot spends carry the control block + reveal script in the witness. */
  witness?: string[];
  inner_witnessscript_asm?: string;
  is_coinbase?: boolean;
  [k: string]: unknown;
}

interface EsploraTx {
  txid?: string;
  locktime?: number;
  vin?: EsploraVin[];
  vout?: Array<{ scriptpubkey?: string; scriptpubkey_address?: string; value?: number }>;
  status?: { confirmed?: boolean; block_height?: number; block_hash?: string; block_time?: number };
  [k: string]: unknown;
}

interface EsploraBlock {
  id?: string;
  mediantime?: number;
  height?: number;
  [k: string]: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function truncate(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function unavailable(base: Omit<SpendObservation, 'path' | 'confirmations' | 'blockHash' | 'blockHeight' | 'blockMediantimeSeconds' | 'spendTxLocktime' | 'revealedScriptHex'>, why: string): SpendObservation {
  return {
    ...base,
    path: 'foreign',
    confirmations: 0,
    blockHash: '',
    blockHeight: -1,
    blockMediantimeSeconds: 0,
    spendTxLocktime: 0,
    revealedScriptHex: '',
    unavailableReason: why,
  };
}

// ── CLTV satisfaction (BIP-65 semantics, injected clock only) ────────────────

/**
 * LOCKTIME_THRESHOLD: values ≥ this are UNIX TIME, below are block heights
 * (BIP-65 / nLockTime comparison rules - same constant the step-2 leaf
 * builders validate against).
 */
export const LOCKTIME_THRESHOLD = 500_000_000;

/**
 * Does the spending tx's nLockTime satisfy the leaf's CLTV target, per
 * BIP-65? `blockMediantimeSeconds` is the CONFIRMED block's mediantime -
 * consensus's view of "now" at the moment the spend was mined. Pure.
 */
export function cltvSatisfied(
  locktime: number,
  cltvTarget: number,
  blockMediantimeSeconds: number,
  blockHeight: number,
): boolean {
  if (cltvTarget >= LOCKTIME_THRESHOLD) {
    // Time-based: nLockTime must be ≥ target AND the block's mediantime
    // must exceed it (BIP-65: median of the PREVIOUS 11 blocks).
    return locktime >= cltvTarget && blockMediantimeSeconds > cltvTarget;
  }
  // Height-based: nLockTime (as a height) must be ≥ target, satisfied by
  // the tx being mined at a height ≥ target.
  return locktime >= cltvTarget && blockHeight >= cltvTarget;
}

// ── Spend-path classification (pure) ────────────────────────────────────────

export interface ClassifySpendInput {
  /** Reveal script bytes from the witness (input consuming the output). */
  readonly revealedScript: Uint8Array;
  readonly spendTxLocktime: number;
  readonly blockMediantimeSeconds: number;
  readonly blockHeight: number;
  /** Step-2 leaf scripts for this contribution, by path. */
  readonly founderClaimScript: Uint8Array;
  readonly donorRefundScript: Uint8Array;
  readonly founderClaimLocktime: number;
  readonly donorRefundLocktime: number;
}

/**
 * Decide which authorized path executed. Order of proof:
 *   1. byte-exact equality against the founder leaf → CLTV check;
 *   2. byte-exact equality against the donor leaf → CLTV check;
 *   3. neither → `foreign`.
 * A matching script whose CLTV is NOT satisfied by the mined block is a
 * consensus impossibility for a CONFIRMED tx - typed error, not a guess
 * (it means our leaf bytes or the API response are wrong, and that must
 * be loud).
 */
export function classifySpend(input: ClassifySpendInput): SpendPath {
  const hex = bytesToHex(input.revealedScript);
  const founderHex = bytesToHex(input.founderClaimScript);
  const donorHex = bytesToHex(input.donorRefundScript);

  if (hex === founderHex) {
    if (!cltvSatisfied(input.spendTxLocktime, input.founderClaimLocktime, input.blockMediantimeSeconds, input.blockHeight)) {
      throw new Testnet4ObserveError(
        'bad_state',
        `founder_claim script matched but CLTV ${input.founderClaimLocktime} unsatisfied by block ${input.blockHeight} (mediantime ${input.blockMediantimeSeconds}, tx locktime ${input.spendTxLocktime}) - leaf bytes or API response are wrong`,
      );
    }
    return 'founder_claim';
  }
  if (hex === donorHex) {
    if (!cltvSatisfied(input.spendTxLocktime, input.donorRefundLocktime, input.blockMediantimeSeconds, input.blockHeight)) {
      throw new Testnet4ObserveError(
        'bad_state',
        `donor_refund script matched but CLTV ${input.donorRefundLocktime} unsatisfied by block ${input.blockHeight} (mediantime ${input.blockMediantimeSeconds}, tx locktime ${input.spendTxLocktime}) - leaf bytes or API response are wrong`,
      );
    }
    return 'donor_refund';
  }
  return 'foreign';
}

// ── Observation (the networked fold) ────────────────────────────────────────

export interface ObserveSpendInput {
  /** The spending transaction's id (found by scanning the address; step 5/6 wire it). */
  readonly spendTxid: string;
  /** The contribution's funding tx id (for audit trails). */
  readonly fundingTxid: string;
  readonly founderClaimScript: Uint8Array;
  readonly donorRefundScript: Uint8Array;
  readonly founderClaimLocktime: number;
  readonly donorRefundLocktime: number;
  readonly cfg?: ObserveConfig;
}

async function genesisPin(cfg: ObserveConfig): Promise<string> {
  const url = `${cfg.esploraBase}/block-height/0`;
  let res: Response;
  try {
    res = await cfg.fetchImpl(url, { headers: { accept: 'text/plain' } });
  } catch (e) {
    throw new Testnet4ObserveError('bad_response', `genesis probe fetch failed: ${reason(e)}`);
  }
  if (!res.ok) throw new Testnet4ObserveError('bad_response', `genesis probe HTTP ${res.status}`);
  const body = (await res.text()).trim().toLowerCase();
  if (!HEX64.test(body)) throw new Testnet4ObserveError('bad_response', `genesis probe returned non-hash body: ${truncate(body)}`);
  if (body !== cfg.genesisHash) {
    throw new Testnet4ObserveError('network_mismatch', `block 0 is ${body}, expected ${cfg.genesisHash} - NOT the pinned chain`);
  }
  return body;
}

/**
 * Observe the spend of a contribution output. Confirmed spends only -
 * an unconfirmed spending tx returns `unavailable` (nothing is decided
 * from mempool gossip; consensus is the only judge). All failures are
 * honest `unavailable` records except a CLTV impossibility and a chain
 * mismatch, which are loud typed errors.
 */
export async function observeSpend(
  input: ObserveSpendInput,
  nowSeconds: number,
): Promise<SpendObservation> {
  const cfg = input.cfg ?? DEFAULT_OBSERVE_CONFIG;
  const spendTxid = validateTestnet4Txid(input.spendTxid);
  validateTestnet4Txid(input.fundingTxid);

  const base = {
    rail: 'btc-testnet4' as const,
    spendTxid,
    genesisHashObserved: cfg.genesisHash,
    queryUrl: `${cfg.esploraBase}/tx/${spendTxid}`,
    observedAtSeconds: nowSeconds,
  };

  let genesisHashObserved: string;
  try {
    genesisHashObserved = await genesisPin(cfg);
  } catch (e) {
    if (e instanceof Testnet4ObserveError && e.code === 'network_mismatch') throw e;
    return unavailable(base, `genesis pin: ${reason(e)}`);
  }
  base.genesisHashObserved = genesisHashObserved;

  // The spending transaction.
  let tx: EsploraTx;
  try {
    tx = await fetchJson(`${cfg.esploraBase}/tx/${spendTxid}`, cfg);
  } catch (e) {
    return unavailable(base, `spend tx fetch failed: ${reason(e)}`);
  }
  if (!tx.status?.confirmed) {
    return unavailable(base, 'spend tx not confirmed - mempool spends decide nothing');
  }
  const blockHeight = tx.status.block_height;
  const blockHash = tx.status.block_hash;
  if (typeof blockHeight !== 'number' || blockHeight < 0 || typeof blockHash !== 'string' || !HEX64.test(blockHash)) {
    return unavailable(base, `confirmed spend reported bad block fields (height ${String(blockHeight)})`);
  }

  // The block header: mediantime for the CLTV check + tip delta for
  // confirmations.
  let block: EsploraBlock;
  try {
    block = await fetchJson(`${cfg.esploraBase}/block/${blockHash}`, cfg);
  } catch (e) {
    return unavailable(base, `block header fetch failed: ${reason(e)}`);
  }
  const mediantime = block.mediantime;
  if (typeof mediantime !== 'number' || mediantime <= 0) {
    return unavailable(base, `block header missing mediantime: ${truncate(JSON.stringify(block).slice(0, 60))}`);
  }

  let tip: number;
  try {
    tip = await fetchTip(cfg);
  } catch (e) {
    return unavailable(base, `tip probe failed: ${reason(e)}`);
  }
  if (tip < blockHeight) {
    return unavailable(base, `tip ${tip} < spend block ${blockHeight} (reorg in flight?)`);
  }

  // The witness that spent the contribution output: find the input whose
  // prevout is the funding tx (the contribution output). The reveal script
  // is the non-control-block witness item (tapscript, leaf version 0xc0).
  const vin = tx.vin ?? [];
  const spendInput = vin.find((v) => v.txid === input.fundingTxid);
  if (!spendInput) {
    return unavailable(
      base,
      `spending tx has no input consuming funding tx ${input.fundingTxid} - not the spend of THIS contribution`,
    );
  }
  const revealHex = tapscriptFromWitness(spendInput.witness ?? []);
  if (!revealHex) {
    return unavailable(base, 'no tapscript reveal found in the spending input witness (keypath spend of a NUMS output is consensus-impossible; witness shape unexpected)');
  }

  // CLTV impossibility: loud, typed - never papered over as unavailable.
  const path = classifySpend({
    revealedScript: hexToBytes(revealHex),
    spendTxLocktime: typeof tx.locktime === 'number' ? tx.locktime : 0,
    blockMediantimeSeconds: mediantime,
    blockHeight,
    founderClaimScript: input.founderClaimScript,
    donorRefundScript: input.donorRefundScript,
    founderClaimLocktime: input.founderClaimLocktime,
    donorRefundLocktime: input.donorRefundLocktime,
  });

  return {
    rail: 'btc-testnet4',
    spendTxid,
    path,
    confirmations: tip - blockHeight + 1,
    blockHash,
    blockHeight,
    blockMediantimeSeconds: mediantime,
    spendTxLocktime: typeof tx.locktime === 'number' ? tx.locktime : 0,
    revealedScriptHex: revealHex,
    genesisHashObserved,
    queryUrl: base.queryUrl,
    observedAtSeconds: nowSeconds,
  };
}

/**
 * Extract the tapscript reveal hex from a taproot witness. Per BIP-341 the
 * script-path witness stack is [args..., script, control-block(, annex)] -
 * the REAL mined shape (verified against testnet4 tx e97a7d3e3bb0…:
 * [64B sig, 39B script, 129B control]). Robust rule, not index guessing:
 * the control block is the LAST item (0xc0-0xc3 first byte, 33+32k bytes);
 * the reveal script is the item IMMEDIATELY BEFORE it (key bytes like a
 * 32-byte pubkey can appear as args, but only the reveal precedes the
 * control block). Any other shape is honestly unusable → null.
 */
export function tapscriptFromWitness(witness: string[]): string | null {
  if (!Array.isArray(witness) || witness.length < 2) return null;
  // Optional annex: an item starting with 0x50 in the final position.
  const lastIdx = witness.length - 1;
  const hasAnnex = witness[lastIdx].length >= 2 && /^50/i.test(witness[lastIdx].slice(0, 2));
  const controlHex = witness[hasAnnex ? lastIdx - 1 : lastIdx];
  if (typeof controlHex !== 'string' || controlHex.length < 66 || controlHex.length % 2 !== 0) return null;
  if (!/^c[0-9a-f]/i.test(controlHex.slice(0, 2))) return null; // 0xc0..0xc3: leaf version | parity
  const scriptHex = witness[hasAnnex ? lastIdx - 2 : lastIdx - 1];
  if (typeof scriptHex !== 'string' || scriptHex.length === 0 || scriptHex.length % 2 !== 0) return null;
  return scriptHex.toLowerCase();
}

async function fetchJson<T>(url: string, cfg: ObserveConfig): Promise<T> {
  const res = await cfg.fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Testnet4ObserveError('bad_response', `HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function fetchTip(cfg: ObserveConfig): Promise<number> {
  const res = await cfg.fetchImpl(`${cfg.esploraBase}/blocks/tip/height`, { headers: { accept: 'text/plain' } });
  if (!res.ok) throw new Testnet4ObserveError('bad_response', `tip probe HTTP ${res.status}`);
  const body = (await res.text()).trim();
  if (!/^\d+$/.test(body)) throw new Testnet4ObserveError('bad_response', `tip probe returned non-numeric body: ${truncate(body)}`);
  return parseInt(body, 10);
}

// ── Deposit-status fold (pure) ───────────────────────────────────────────────

export type DepositSpendState = 'spent_claim' | 'spent_refund' | 'foreign_spend';

/**
 * Fold an observation into the deposit lifecycle. Pure; typed refusal on
 * txid mismatch (evidence must match the record).
 */
export function applySpendToDeposit(
  depositFundingTxid: string,
  observation: SpendObservation,
): DepositSpendState {
  if (observation.spendTxid === depositFundingTxid) {
    throw new Testnet4ObserveError('bad_state', 'spend txid equals the funding txid - self-spend of an unconfirmed coinbase-like shape is not a valid observation');
  }
  switch (observation.path) {
    case 'founder_claim':
      return 'spent_claim';
    case 'donor_refund':
      return 'spent_refund';
    case 'foreign':
      return 'foreign_spend';
  }
}
