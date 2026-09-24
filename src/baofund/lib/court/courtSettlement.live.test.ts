// @vitest-environment node
//
// WS1 LIVE acceptance drill - the two-phase Cashu escrow settlement against
// the deployed Fund API, with a real contribution on a FREE test mint
// (testnut.cashu.space, cdk FakeWallet: no real money).
//
// This is the executable half of `docs/ESCROW-ACCEPTANCE.md`. It is OPT-IN and
// never runs in CI (BAO_COURT_LIVE=1 required). It drives the exact client code
// the Court tab's Execute uses:
//
//   1. mint preflight: lock 100 sats 2-of-3 SIG_ALL and spend them back with
//      two keys (proves the mint supports the escrow flow before any real
//      deposit; hard rule 4 in docs/ESCROW-ACCEPTANCE.md);
//   2. deposit: lock the state token 2-of-3 (project, donor, LIVE oracle) and
//      POST /v1/fundraisers/:id/contribute as the donor;
//   3. release initiate: POST .../milestones/:mid/release as the project -
//      the API attaches the oracle co-signature (the operator oracle);
//   4. client co-sign: parseEscrowSwapForCompletion + signEscrowSwapForParty
//      (the SHIPPED helper) add the project witness over the SIG_ALL digest;
//   5. complete: POST .../release/complete - the API re-verifies both
//      signatures, executes the swap at the mint and records the release;
//   6. verify: the milestone reads `released` on a fresh public GET, the
//      mint-signed payout proofs unblind and the mint reports them UNSPENT.
//
// REFUND FALLBACK (the deployed API's release gate blocks a throwaway
// campaign: the milestone's market is not resolved YES). When the release
// initiate is refused, the donor-side refund runs instead:
//   a. POST .../contributions/:cid/refund as the donor - when the API's own
//      refund gate is open (campaign cancelled / market NO / failed verdict /
//      30-day refund period) the oracle co-signs, the donor witness is added
//      with the SHIPPED helper and POST .../refund/complete settles it;
//   b. otherwise, once the escrow CLTV has passed, the donor refund key
//      (n_sigs_refund = 1) spends the locked proofs back at the mint - the
//      same 2-of-3 SIG_ALL lock, no API co-signature needed. The deposit
//      locktime is built at the deployed API's 24h minimum (escrowDrill.ts),
//      so this phase can only complete after that CLTV.
//
// State (0600, gitignored): ~/.escrow-acceptance/state-signet.json - donor/
// project keys, the base token, the accepted contribution and the settled
// payout. Every money artifact is persisted BEFORE the next network step, so
// a crash can never orphan a token. NEVER printed by this suite.
//
// Fund the state token from a free test mint (the harness only reads
// state.baseToken): testnut.cashu.space NUT-04 quotes are auto-paid by its
// FakeWallet. Do NOT use the BAO signet Nutshell mint
// (relay.bao.network/cashu) for this drill: Nutshell 0.18.2 still signs the
// pre-2024 SIG_ALL message (secret+B_ only), so a 2-of-3 SIG_ALL spend signed
// by this client is rejected there (docs/ESCROW-ACCEPTANCE.md).
//
// Run:
//   BAO_COURT_LIVE=1 \
//   VITE_BAO_FUND_API_URL=https://app.bao.network/fund-api \
//   FUNDRAISER_ORACLE_PUBKEY=<live oracle x-only hex> \
//   ESCROW_ACCEPTANCE_STATE=~/.escrow-acceptance/state-signet.json \
//   npx vitest run src/lib/court/courtSettlement.live.test.ts --testTimeout=600000
//
import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import {
  getDecodedToken,
  getEncodedToken,
  hashToCurve,
  OutputData,
  pointFromHex,
  unblindSignature,
  type MintKeys,
  type Proof,
} from 'cashu-ts3';
import { fetchContributions, fetchFundraiser, releaseMilestone, type SignerLike } from '../baoFundraising';
import { fundFetch, FundHttpError } from '../fundHttp';
import { parseMultisigLockSecret } from '../cashu/escrowMultisig';
import {
  buildSigAllMessage,
  parseEscrowSwapForCompletion,
  signEscrowSwapForParty,
  signSigAllDigest,
  type EscrowSwapOutputWire,
  type EscrowSwapWire,
} from '../cashu/escrowSwapComplete';
import {
  API_ORACLE_MIN_LOCKTIME_SECONDS,
  ESCROW_DEPOSIT_LOCKTIME_SECONDS,
  donorMintRefundReady,
  escrowLocktimeFromProofs,
} from './escrowDrill';
import { resolveDonorContributionId } from './donorContribution';

const LIVE = process.env.BAO_COURT_LIVE === '1';
const STATE_FILE = process.env.ESCROW_ACCEPTANCE_STATE ?? join(homedir(), '.escrow-acceptance', 'state.json');
const ORACLE_PUBKEY = (process.env.FUNDRAISER_ORACLE_PUBKEY ?? '').toLowerCase();
/** Deposit locktime: the deployed API requires every escrow proof to lock at
 *  least 24h out (`ORACLE_SIGN_MIN_LOCKTIME_MARGIN_SECONDS`); the drill locks
 *  10 minutes beyond it. The donor-side refund phase waits for this CLTV. */
const LOCKTIME_SECONDS = ESCROW_DEPOSIT_LOCKTIME_SECONDS;
const SELFTEST_SATS = 100;

interface SelftestState {
  /** The mint the probe was run against; a mint switch resets the preflight. */
  mintUrl?: string;
  keys: string[];
  lockedToken?: string;
  changeToken?: string;
  done?: boolean;
}

interface EscrowAcceptanceState {
  mintUrl: string;
  baseToken?: string;
  lockedToken?: string;
  lockedAmountSats?: number;
  donorPrivHex?: string;
  projectPrivHex?: string;
  campaignId?: string;
  milestoneId?: string;
  contributionId?: string;
  oraclePubkey?: string;
  releasedToken?: string;
  /** The token deposited into escrow (kept for the donor-side mint refund). */
  escrowedToken?: string;
  /** Set once the donor refund settled; the payout token is stored here. */
  refundToken?: string;
  refundVia?: 'api' | 'mint';
  refundAmountSats?: number;
  /** Journal of a pending donor-side mint refund, persisted BEFORE the mint
   *  swap (hard rule 1: a crash must never orphan the refund outputs). */
  mintRefundPending?: {
    mint: string;
    inputs: string;
    outputs: EscrowSwapOutputWire[];
    message: string;
    signatures: string[];
    fee: number;
    amount: number;
  };
  selftest?: SelftestState;
}

function loadState(): EscrowAcceptanceState {
  if (!existsSync(STATE_FILE)) throw new Error(`acceptance state missing: ${STATE_FILE}`);
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as EscrowAcceptanceState;
}

function saveState(state: EscrowAcceptanceState): void {
  mkdirSync(join(STATE_FILE, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
}

/** NIP-98 signer over a raw identity key (the client transport's SignerLike). */
function signerFromHex(privHex: string): SignerLike {
  return {
    signEvent: async (event) => finalizeEvent(event, hexToBytes(privHex)),
  };
}

const xonly = (v: string): string => v.toLowerCase().replace(/^0[23]/, '');

function keysetFromToken(proofs: Proof[]): string {
  const id = proofs[0]?.id;
  if (!id) throw new Error('token carries no proofs');
  if (!proofs.every((p) => p.id === id)) throw new Error('token mixes keysets');
  return id;
}

interface MintKeyset { id: string; unit: string; keys: Record<string, string>; input_fee_ppk?: number }

/**
 * Mint keysets with their NUT-02 input fee. Nutshell omits `input_fee_ppk`
 * from `/v1/keys` but reports it on `/v1/keysets` (the endpoint cashu-ts's
 * `getKeySets()` and therefore the Fund API read).
 */
async function fetchKeysets(mintUrl: string): Promise<MintKeyset[]> {
  const base = mintUrl.replace(/\/+$/, '');
  const [keysRes, keysetsRes] = await Promise.all([fetch(`${base}/v1/keys`), fetch(`${base}/v1/keysets`)]);
  if (!keysRes.ok) throw new Error(`mint /v1/keys failed: ${keysRes.status}`);
  const keys = (await keysRes.json()) as { keysets?: MintKeyset[] };
  const fees = keysetsRes.ok
    ? ((await keysetsRes.json()) as { keysets?: Array<{ id: string; input_fee_ppk?: number }> }).keysets ?? []
    : [];
  const feeById = new Map(fees.map((k) => [k.id, k.input_fee_ppk ?? 0]));
  return (keys.keysets ?? []).map((k) => ({ ...k, input_fee_ppk: feeById.get(k.id) ?? k.input_fee_ppk ?? 0 }));
}

/** NUT-02 input fee for a swap (same formula as the Fund API). */
function mintInputFeeSats(inputCount: number, keyset: MintKeyset): number {
  return Math.ceil((inputCount * (keyset.input_fee_ppk ?? 0)) / 1000);
}

/**
 * Raw NUT-03 swap (hard rule 1: never let a high-level Wallet own the call).
 * cdk-class mints require `witness` as a STRINGIFIED JSON object (NUT-11
 * P2PKWitness), so witnesses are stringified on the wire here; the Fund API
 * does the same through cashu-ts before it calls the mint.
 */
async function submitSwap(
  mintUrl: string,
  inputs: Proof[],
  outputs: ReturnType<typeof OutputData.createRandomData>,
): Promise<Array<{ amount: number; C_: string }>> {
  const res = await fetch(`${mintUrl.replace(/\/+$/, '')}/v1/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputs: inputs.map((p) => ({
        id: p.id,
        amount: p.amount,
        secret: p.secret,
        C: p.C,
        ...(p.witness
          ? { witness: typeof p.witness === 'string' ? p.witness : JSON.stringify(p.witness) }
          : {}),
      })),
      outputs: outputs.map((o) => o.blindedMessage),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint swap failed: ${res.status} ${text.slice(0, 240)}`);
  const json = JSON.parse(text) as { signatures?: Array<{ amount: number; C_: string }> };
  if (!json.signatures || json.signatures.length !== outputs.length) {
    throw new Error(`mint returned ${json.signatures?.length ?? 0} signature(s) for ${outputs.length} output(s)`);
  }
  return json.signatures;
}

/**
 * Unblind a swap's signatures into spendable proofs. The third argument to
 * cashu-ts's `unblindSignature(C_, r, A)` is the mint's PUBLIC KEY for the
 * amount (A = K), NOT hash_to_curve(secret): C = C_ - r*K. Passing Y here
 * produces proofs the mint rejects with "Token not verified".
 */
function unblindProofs(
  outputs: Array<{ blindedMessage: { id: string; amount: number; B_: string }; secret: string | Uint8Array; blindingFactor: string | bigint }>,
  signatures: Array<{ amount: number; C_: string }>,
  keyset: MintKeyset,
): Proof[] {
  return outputs.map((out, i) => {
    const secretBytes = typeof out.secret === 'string' ? hexToBytes(out.secret) : out.secret;
    const r = typeof out.blindingFactor === 'string' ? BigInt('0x' + out.blindingFactor) : out.blindingFactor;
    const amount = out.blindedMessage.amount;
    const K = keyset.keys[String(amount)];
    if (!K) throw new Error(`keyset ${keyset.id.slice(0, 16)}... has no key for amount ${amount}`);
    const C = unblindSignature(pointFromHex(signatures[i].C_), r, pointFromHex(K));
    const cHex = typeof (C as unknown as { toHex?: unknown }).toHex === 'function'
      ? (C as unknown as { toHex: (c?: boolean) => string }).toHex(true)
      : bytesToHex((C as unknown as { toBytes: (c?: boolean) => Uint8Array }).toBytes(true));
    return {
      id: out.blindedMessage.id,
      amount,
      secret: new TextDecoder().decode(secretBytes),
      C: cHex,
    } as Proof;
  });
}

/** Unblind the wire-shaped outputs of an initiate swap (blindingFactor hex). */
function unblindWireOutputs(outputs: EscrowSwapOutputWire[], signatures: Array<{ amount: number; C_: string }>, keyset: MintKeyset): Proof[] {
  return unblindProofs(outputs, signatures, keyset);
}

function total(proofs: Proof[]): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * The escrow P2PK outputs in the CONTRIBUTION convention: `data` is the
 * project key, `pubkeys` are the donor + oracle (sorted), the donor is the
 * sole refund key, n_sigs 2, refund n_sigs 1, and SIG_ALL binds the outputs
 * (cashu-ts 3.7.2's native `sigFlag`).
 */
function escrowOutputs(opts: {
  project: string;
  donor: string;
  oracle: string;
  amountSats: number;
  locktime: number;
  keyset: MintKeyset;
}): ReturnType<typeof OutputData.createRandomData> {
  const compressed = (k: string) => '02' + xonly(k);
  return OutputData.createP2PKData(
    {
      pubkey: [compressed(opts.project), ...([opts.donor, opts.oracle].sort().map(compressed))],
      locktime: opts.locktime,
      refundKeys: [compressed(opts.donor)],
      requiredSignatures: 2,
      sigFlag: 'SIG_ALL',
    },
    opts.amountSats,
    opts.keyset as MintKeys,
  );
}

/** A SIG_ALL witness on every input (the party signatures). */
function withWitness(proofs: Proof[], message: string, privHexes: string[]): Proof[] {
  const signatures = privHexes.map((hex) => signSigAllDigest(hex, message));
  return proofs.map((p) => ({ ...p, witness: { signatures } }));
}

/**
 * Validate the locked deposit token structurally with the shipped lock parser.
 * `validateMultisigEscrowDeposit` is NOT used here: its token decoder rejects
 * v2-keyset tokens without a keyset map (the same limitation that blocks the
 * deployed API - see docs/ESCROW-ACCEPTANCE.md), so this decodes WITH the
 * mint's keysets and re-checks the exact lock contract.
 */
function validateLockedEscrow(
  lockedToken: string,
  expected: { amountSats: number; project: string; donor: string; oracle: string; minLocktime: number },
  keysets: MintKeyset[],
): { valid: boolean; reason?: string } {
  const decoded = getDecodedToken(lockedToken, keysets);
  const proofs = decoded.proofs;
  const amount = total(proofs);
  if (amount !== expected.amountSats) return { valid: false, reason: `token amount ${amount} != ${expected.amountSats}` };
  const expectedKeys = [expected.project, expected.donor, expected.oracle].map(xonly).sort().join(',');
  const donor = xonly(expected.donor);
  for (const proof of proofs) {
    const lock = parseMultisigLockSecret(proof.secret);
    if (!lock) return { valid: false, reason: 'proof is not a multisig P2PK lock' };
    if (lock.lockKeys.length !== 3 || lock.lockKeys.join(',') !== expectedKeys) {
      return { valid: false, reason: 'proof lock keys are not exactly project+donor+oracle' };
    }
    if (lock.requiredSignatures !== 2) return { valid: false, reason: 'proof lock does not require 2-of-3' };
    if (lock.refundKeys.length !== 1 || lock.refundKeys[0] !== donor) {
      return { valid: false, reason: 'proof refund key is not the donor' };
    }
    if (lock.requiredRefundSignatures !== 1) return { valid: false, reason: 'proof refund path is not 1-of-1' };
    if (lock.locktime === undefined || lock.locktime < expected.minLocktime) {
      return { valid: false, reason: 'proof locktime is missing or too soon' };
    }
    let sigAll: boolean;
    try {
      const tags = (JSON.parse(proof.secret) as [string, { tags?: unknown }])[1]?.tags;
      sigAll = Array.isArray(tags) && tags.some((t) => Array.isArray(t) && t[0] === 'sigflag' && t[1] === 'SIG_ALL');
    } catch {
      sigAll = false;
    }
    if (!sigAll) return { valid: false, reason: 'proof lock does not carry sigflag SIG_ALL' };
  }
  return { valid: true };
}

/** NUT-07 Ys: the curve point of each proof's SECRET (not the proof's C). */
function proofYs(proofs: Proof[]): string[] {
  return proofs.map((p) => hashToCurve(new TextEncoder().encode(p.secret)).toHex(true));
}

async function checkUnspent(mintUrl: string, proofs: Proof[]): Promise<boolean> {
  const res = await fetch(`${mintUrl.replace(/\/+$/, '')}/v1/checkstate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Ys: proofYs(proofs) }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { states?: Array<{ state?: string }> };
  return Boolean(json.states?.length) && json.states!.every((s) => s.state === 'UNSPENT');
}

/** NUT-07 proof state must read SPENT at the mint (settlement proof). */
async function checkSpent(mintUrl: string, proofs: Proof[]): Promise<boolean> {
  const res = await fetch(`${mintUrl.replace(/\/+$/, '')}/v1/checkstate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Ys: proofYs(proofs) }),
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { states?: Array<{ state?: string }> };
  return Boolean(json.states?.length) && json.states!.every((s) => s.state === 'SPENT');
}

/** Compact raw-outcome string for a refused API call. */
function describeRefusal(err: unknown): string {
  if (err instanceof FundHttpError) return `HTTP ${err.status}${err.code ? ` ${err.code}` : ''} — ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

const describeLive = LIVE ? describe : describe.skip;

describeLive('court settlement live drill (WS1)', () => {
  it('deposits, releases and settles with no manual step', async () => {
    expect(process.env.VITE_BAO_FUND_API_URL, 'VITE_BAO_FUND_API_URL must point at the live Fund API').toBeTruthy();
    expect(ORACLE_PUBKEY, 'FUNDRAISER_ORACLE_PUBKEY must be the live oracle x-only hex').toMatch(/^[0-9a-f]{64}$/);

    const state = loadState();
    const mintUrl = state.mintUrl;
    expect(mintUrl).toMatch(/^https:\/\//);

    const keysets = await fetchKeysets(mintUrl);
    const projectPriv = state.projectPrivHex;
    const donorPriv = state.donorPrivHex;
    expect(projectPriv).toMatch(/^[0-9a-f]{64}$/);
    expect(donorPriv).toMatch(/^[0-9a-f]{64}$/);
    const projectPub = getPublicKey(hexToBytes(projectPriv!));
    const donorPub = getPublicKey(hexToBytes(donorPriv!));

    // Resolve the campaign: the state must name it, and the project key must
    // be its owner (the API enforces caller === owner on release).
    const campaignId = state.campaignId;
    expect(campaignId, 'state.campaignId is required').toBeTruthy();
    const campaign = await fetchFundraiser(campaignId!);
    const milestone = campaign.milestones[0];
    expect(milestone, 'campaign has no milestone').toBeTruthy();
    expect(campaign.fundraiser.owner_pubkey.toLowerCase()).toBe(projectPub.toLowerCase());
    const milestoneId = state.milestoneId ?? milestone.id;
    const oraclePubkey = state.oraclePubkey ?? ORACLE_PUBKEY;
    expect(oraclePubkey).toBe(ORACLE_PUBKEY);

    let contributionId = state.contributionId;

    // ── 0. mint preflight (hard rule 4) ─────────────────────────────────────
    // Lock 100 sats 2-of-3 SIG_ALL and spend them back with two keys. Every
    // artifact is persisted BEFORE the spend, so a crash cannot orphan them.
    if (state.selftest && state.selftest.mintUrl && state.selftest.mintUrl !== mintUrl) {
      // The persisted probe belongs to another mint - never reuse it.
      delete state.selftest;
      saveState(state);
    }
    if (!state.selftest?.done) {
      const selftest: SelftestState = state.selftest ?? {
        keys: [generateSecretKey(), generateSecretKey(), generateSecretKey()].map((k) => bytesToHex(k)),
      };
      selftest.mintUrl = mintUrl;
      state.selftest = selftest;
      saveState(state);
      const probePub = (privHex: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(privHex)));

      if (!selftest.lockedToken) {
        const baseToken = state.baseToken;
        expect(baseToken, 'state.baseToken is required for the preflight').toBeTruthy();
        const baseProofs = getDecodedToken(baseToken!, keysets).proofs;
        const baseTotal = total(baseProofs);
        const keysetId = keysetFromToken(baseProofs);
        const keyset = keysets.find((k) => k.id === keysetId || k.id.startsWith(keysetId));
        expect(keyset, `mint does not advertise keyset ${keysetId.slice(0, 16)}...`).toBeTruthy();
        const locktime = Math.floor(Date.now() / 1000) + LOCKTIME_SECONDS;
        const lockFee = mintInputFeeSats(baseProofs.length, keyset!);
        const probeOutputs = escrowOutputs({
          project: probePub(selftest.keys[0]),
          donor: probePub(selftest.keys[1]),
          oracle: probePub(selftest.keys[2]),
          amountSats: SELFTEST_SATS,
          locktime,
          keyset: keyset!,
        });
        const changeOutputs = OutputData.createRandomData(baseTotal - lockFee - SELFTEST_SATS, keyset! as MintKeys);
        const probeSignatures = await submitSwap(mintUrl, baseProofs, [...probeOutputs, ...changeOutputs]);
        const probeLocked = unblindProofs(probeOutputs as never, probeSignatures.slice(0, probeOutputs.length), keyset!);
        const change = unblindProofs(changeOutputs as never, probeSignatures.slice(probeOutputs.length), keyset!);
        expect(total(probeLocked)).toBe(SELFTEST_SATS);
        expect(total(change)).toBe(baseTotal - lockFee - SELFTEST_SATS);
        selftest.lockedToken = getEncodedToken({ mint: mintUrl, proofs: probeLocked });
        selftest.changeToken = getEncodedToken({ mint: mintUrl, proofs: change });
        state.baseToken = undefined;
        saveState(state);
      }

      const lockedProofs = getDecodedToken(selftest.lockedToken!, keysets).proofs;
      const lockedKeysetId = keysetFromToken(lockedProofs);
      const lockedKeyset = keysets.find((k) => k.id === lockedKeysetId || k.id.startsWith(lockedKeysetId));
      expect(lockedKeyset, 'the selftest keyset vanished from the mint').toBeTruthy();
      const refundFee = mintInputFeeSats(lockedProofs.length, lockedKeyset!);
      const refundOutputs = OutputData.createRandomData(SELFTEST_SATS - refundFee, lockedKeyset! as MintKeys);
      const message = buildSigAllMessage(
        lockedProofs as unknown as EscrowSwapWire['inputs'],
        refundOutputs as unknown as EscrowSwapOutputWire[],
      );
      const refund = await submitSwap(
        mintUrl,
        withWitness(lockedProofs, message, [selftest.keys[1], selftest.keys[2]]),
        refundOutputs,
      );
      const refunded = unblindProofs(refundOutputs as never, refund, lockedKeyset!);
      expect(total(refunded)).toBe(SELFTEST_SATS - refundFee);
      state.baseToken = getEncodedToken({
        mint: mintUrl,
        proofs: [...getDecodedToken(selftest.changeToken!, keysets).proofs, ...refunded],
      });
      selftest.done = true;
      selftest.lockedToken = undefined;
      selftest.changeToken = undefined;
      saveState(state);
      console.log(`[drill] mint preflight PASS (${SELFTEST_SATS} sats locked + 2-of-3 SIG_ALL spend accepted at ${mintUrl})`);
    }

    if (!contributionId && !state.lockedToken) {
      // ── 1. deposit ────────────────────────────────────────────────────────
      const baseToken = state.baseToken;
      expect(baseToken, 'state.baseToken is required for the deposit').toBeTruthy();
      const baseProofs = getDecodedToken(baseToken!, keysets).proofs;
      const baseTotal = total(baseProofs);
      const keysetId = keysetFromToken(baseProofs);
      const keyset = keysets.find((k) => k.id === keysetId || k.id.startsWith(keysetId));
      expect(keyset, `mint does not advertise keyset ${keysetId.slice(0, 16)}...`).toBeTruthy();

      const locktime = Math.floor(Date.now() / 1000) + LOCKTIME_SECONDS;
      const depositFee = mintInputFeeSats(baseProofs.length, keyset!);
      const lockedAmount = baseTotal - depositFee;
      expect(lockedAmount).toBeGreaterThan(0);
      const depositOutputs = escrowOutputs({
        project: projectPub,
        donor: donorPub,
        oracle: oraclePubkey,
        amountSats: lockedAmount,
        locktime,
        keyset: keyset!,
      });
      const depositSignatures = await submitSwap(mintUrl, baseProofs, depositOutputs);
      const lockedProofs = unblindProofs(depositOutputs as never, depositSignatures, keyset!);
      const lockedToken = getEncodedToken({ mint: mintUrl, proofs: lockedProofs });

      // Persist the locked token BEFORE it is validated or recorded anywhere:
      // a crash or a failed validation after the mint swap must not orphan it.
      state.lockedToken = lockedToken;
      state.lockedAmountSats = lockedAmount;
      saveState(state);
      console.log(`[drill] locked ${lockedAmount} sats to the escrow (mint fee ${depositFee}, token persisted)`);
    }

    if (!contributionId) {
      const lockedToken = state.lockedToken;
      expect(lockedToken, 'state has neither a contribution nor a locked token').toBeTruthy();
      expect(state.lockedAmountSats, 'state.lockedAmountSats is required').toBeGreaterThan(0);
      const depositCheck = validateLockedEscrow(lockedToken!, {
        amountSats: state.lockedAmountSats!,
        project: projectPub,
        donor: donorPub,
        oracle: oraclePubkey,
        // Mirror the deployed API's minimum: a token below it is rejected
        // server-side, so never POST one (escrowDrill.ts).
        minLocktime: Math.floor(Date.now() / 1000) + API_ORACLE_MIN_LOCKTIME_SECONDS,
      }, keysets);
      expect(depositCheck.valid, `locked deposit failed client validation: ${depositCheck.reason ?? ''}`).toBe(true);
      // The API's contribute response carries the campaign + milestones, NOT
      // the new contribution row (live shape, 2026-09-23) - resolve the
      // donor's escrowed contribution from the public list exactly like the
      // shipped court resolver does.
      await fundFetch<{ data: unknown }>(
        `/v1/fundraisers/${encodeURIComponent(campaignId!)}/contribute`,
        {
          method: 'POST',
          body: { amount_sats: state.lockedAmountSats, rail: 'cashu', cashu_token: lockedToken },
          signer: signerFromHex(donorPriv!),
        },
      );
      const resolvedContributionId = await resolveDonorContributionId(campaignId!, donorPub);
      expect(resolvedContributionId, 'the API accepted the deposit but the donor escrow is not visible on the public list').toMatch(/^[0-9]+$/);
      contributionId = resolvedContributionId!;
      state.baseToken = undefined;
      // Keep the escrowed token: the donor-side refund phase needs the exact
      // proofs to spend back after the CLTV (the API stores them, but the
      // donor must be able to settle without the API too).
      state.escrowedToken = lockedToken;
      state.lockedToken = undefined;
      state.contributionId = contributionId;
      state.milestoneId = milestoneId;
      state.oraclePubkey = oraclePubkey;
      saveState(state);
      console.log(`[drill] escrowed ${state.lockedAmountSats} sats, contribution ${contributionId}`);
    }

    // The milestone must have unlocked from the contribution (raised >= band).
    const unlocked = await fetchFundraiser(campaignId!);
    const unlockedMilestone = unlocked.milestones.find((m) => m.id === milestoneId);
    expect(['unlocked', 'released']).toContain(unlockedMilestone?.status);

    // ── 2. release initiate (the operator oracle co-signs) ──────────────────
    // The deployed API refuses a throwaway campaign here (its milestone market
    // is not resolved YES). A refusal is a raw outcome, not a harness crash:
    // record it and fall through to the donor-side refund.
    let releaseRefusal: string | null = null;
    if (!state.releasedToken && !state.refundToken) {
      try {
        const projectSigner = signerFromHex(projectPriv!);
        const initiated = await releaseMilestone(projectSigner, campaignId!, milestoneId, { payout_reference: projectPub });
        const escrow = (initiated as unknown as { escrow_release?: {
          swap: unknown;
          project_output_sats?: number;
          fee_sats?: number;
          mint_fee_sats?: number;
          verifier_pubkey?: string;
        } }).escrow_release;
        expect(escrow, 'release initiate returned no escrow_release swap (is BAO_CASHU_ESCROW_SETTLEMENT enabled?)').toBeTruthy();
        expect(typeof escrow!.project_output_sats).toBe('number');
        expect(typeof escrow!.fee_sats).toBe('number');
        expect(typeof escrow!.mint_fee_sats).toBe('number');
        expect(escrow!.verifier_pubkey?.toLowerCase()).toBe(oraclePubkey);
        console.log(`[drill] release initiate accepted: API oracle co-signed (project_output_sats=${escrow!.project_output_sats}, fee_sats=${escrow!.fee_sats}, mint_fee_sats=${escrow!.mint_fee_sats})`);

        // ── 3. client co-sign (the shipped helper) ─────────────────────────
        const parsed = parseEscrowSwapForCompletion(escrow!.swap, {
          mint: mintUrl,
          payoutPubkey: projectPub,
          payoutSats: escrow!.project_output_sats!,
          feePubkey: escrow!.verifier_pubkey,
          feeSats: escrow!.fee_sats,
          mintFeeSats: escrow!.mint_fee_sats,
          partyPubkey: projectPub,
          oraclePubkey: escrow!.verifier_pubkey,
        });
        const signed = signEscrowSwapForParty(parsed, projectPriv!);
        expect(signed.inputs.every((i) => Array.isArray((i.witness as { signatures?: string[] })?.signatures) && (i.witness as { signatures: string[] }).signatures.length >= 2)).toBe(true);

        // ── 4. complete (capture the mint signatures for the payout unblind)
        const completed = await fundFetch<{ data: {
          milestone?: { status?: string };
          released_sats?: number;
          swap_signatures?: Array<{ amount: number; C_: string }>;
        } }>(
          `/v1/fundraisers/${encodeURIComponent(campaignId!)}/milestones/${encodeURIComponent(milestoneId)}/release/complete`,
          { method: 'POST', body: { swap: signed }, signer: projectSigner },
        );
        expect(completed.data.milestone?.status, 'the API did not confirm the milestone release').toBe('released');
        expect(typeof completed.data.released_sats).toBe('number');
        expect(completed.data.swap_signatures?.length, 'the API returned no mint signatures for the payout').toBe(parsed.wire.outputs.length);

        // ── 5. verify the payout at the mint ───────────────────────────────
        const payoutKeysetId = parsed.wire.outputs[0]?.blindedMessage.id;
        const payoutKeyset = keysets.find((k) => k.id === payoutKeysetId || k.id.startsWith(payoutKeysetId ?? ''));
        expect(payoutKeyset, 'the release swap keyset vanished from the mint').toBeTruthy();
        const payoutProofs = unblindWireOutputs(parsed.wire.outputs, completed.data.swap_signatures!, payoutKeyset!);
        expect(total(payoutProofs)).toBe(escrow!.project_output_sats);
        expect(await checkUnspent(mintUrl, payoutProofs), 'the mint does not report the payout proofs UNSPENT').toBe(true);
        const payoutToken = getEncodedToken({ mint: mintUrl, proofs: payoutProofs });
        state.releasedToken = payoutToken;
        state.contributionId = contributionId;
        saveState(state);
        console.log(`[drill] released ${completed.data.released_sats} sats; payout token stored at ${STATE_FILE} (mint reports all proofs UNSPENT)`);
      } catch (err) {
        if (!(err instanceof FundHttpError)) throw err;
        releaseRefusal = describeRefusal(err);
        console.log(`[drill] release initiate refused: ${releaseRefusal}`);
      }
    }

    // ── 6. donor-side refund when the release is gated ─────────────────────
    if (!state.releasedToken && !state.refundToken) {
      expect(contributionId, 'state.contributionId is required for the refund path').toMatch(/^[0-9]+$/);
      const donorSigner = signerFromHex(donorPriv!);
      const donorPubkey = donorPub;

      // 6a. API refund initiate: when the API's own refund gate is open the
      // operator oracle co-signs and the donor completes through the API.
      let apiRefund: { swap: unknown; refundSats: number } | null = null;
      let apiRefusal: string | null = null;
      try {
        const initiated = await fundFetch<{ data?: { escrow_refund?: { swap?: unknown; refund_sats?: unknown } } }>(
          `/v1/fundraisers/${encodeURIComponent(campaignId!)}/contributions/${encodeURIComponent(contributionId!)}/refund`,
          { method: 'POST', body: {}, signer: donorSigner },
        );
        const escrow = initiated.data?.escrow_refund;
        if (!escrow || typeof escrow.refund_sats !== 'number') {
          throw new Error('refund initiate returned no usable escrow_refund swap');
        }
        apiRefund = { swap: escrow.swap, refundSats: escrow.refund_sats };
        console.log(`[drill] refund initiate accepted: API oracle co-signed a ${escrow.refund_sats}-sat refund swap`);
      } catch (err) {
        if (!(err instanceof FundHttpError)) throw err;
        apiRefusal = describeRefusal(err);
        console.log(`[drill] refund initiate refused: ${apiRefusal}`);
      }

      if (apiRefund) {
        const parsed = parseEscrowSwapForCompletion(apiRefund.swap, {
          mint: mintUrl,
          payoutPubkey: donorPubkey,
          payoutSats: apiRefund.refundSats,
          partyPubkey: donorPubkey,
        });
        const signed = signEscrowSwapForParty(parsed, donorPriv!);
        const completed = await fundFetch<{ data: {
          refunded?: boolean;
          contribution_id?: unknown;
          refund_sats?: number;
          swap_signatures?: Array<{ amount: number; C_: string }>;
        } }>(
          `/v1/fundraisers/${encodeURIComponent(campaignId!)}/contributions/${encodeURIComponent(contributionId!)}/refund/complete`,
          { method: 'POST', body: { swap: signed }, signer: donorSigner },
        );
        expect(completed.data.refunded, 'the API did not confirm the contribution refund').toBe(true);
        expect(String(completed.data.contribution_id)).toBe(contributionId);
        const payoutKeysetId = parsed.wire.outputs[0]?.blindedMessage.id;
        const payoutKeyset = keysets.find((k) => k.id === payoutKeysetId || k.id.startsWith(payoutKeysetId ?? ''));
        expect(payoutKeyset, 'the refund swap keyset vanished from the mint').toBeTruthy();
        const refundProofs = unblindWireOutputs(parsed.wire.outputs, completed.data.swap_signatures ?? [], payoutKeyset!);
        expect(total(refundProofs)).toBe(apiRefund.refundSats);
        expect(await checkUnspent(mintUrl, refundProofs), 'the mint does not report the refund payout proofs UNSPENT').toBe(true);
        state.refundToken = getEncodedToken({ mint: mintUrl, proofs: refundProofs });
        state.refundAmountSats = apiRefund.refundSats;
        state.refundVia = 'api';
        saveState(state);
        console.log(`[drill] refunded ${apiRefund.refundSats} sats to the donor via the API (oracle co-sign + donor witness; mint reports the payout UNSPENT)`);
      } else {
        // 6b. Donor-side mint refund: past the escrow CLTV the donor's refund
        // key spends the locked proofs alone (n_sigs_refund = 1).
        const escrowedToken = state.escrowedToken ?? state.lockedToken;
        expect(escrowedToken, 'state has no escrowed token for the donor-side refund').toBeTruthy();
        const escrowedProofs = getDecodedToken(escrowedToken!, keysets).proofs;
        const locktime = escrowLocktimeFromProofs(escrowedProofs);
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!donorMintRefundReady({ locktime, nowSeconds })) {
          throw new Error(
            `escrow NOT settled: release refused (${releaseRefusal ?? 'not attempted'}); `
            + `API refund refused (${apiRefusal ?? 'not attempted'}); `
            + `donor-side mint refund pending until ${locktime === null ? 'an unknown locktime' : new Date(locktime * 1000).toISOString()}`,
          );
        }
        const keysetId = keysetFromToken(escrowedProofs);
        const keyset = keysets.find((k) => k.id === keysetId || k.id.startsWith(keysetId));
        expect(keyset, `mint does not advertise keyset ${keysetId.slice(0, 16)}...`).toBeTruthy();
        const refundFee = mintInputFeeSats(escrowedProofs.length, keyset!);
        const refundAmount = total(escrowedProofs) - refundFee;
        expect(refundAmount).toBeGreaterThan(0);
        const refundOutputs = OutputData.createRandomData(refundAmount, keyset! as MintKeys);
        const wireOutputs = refundOutputs.map((o) => ({
          blindedMessage: o.blindedMessage,
          blindingFactor: (typeof o.blindingFactor === 'bigint' ? o.blindingFactor : BigInt(o.blindingFactor)).toString(16).padStart(64, '0'),
          secret: typeof o.secret === 'string' ? o.secret : bytesToHex(o.secret),
        }));
        const message = buildSigAllMessage(
          escrowedProofs as unknown as EscrowSwapWire['inputs'],
          wireOutputs as EscrowSwapOutputWire[],
        );
        const witness = [signSigAllDigest(donorPriv!, message)];
        // Persist the refund outputs BEFORE the mint swap (hard rule 1).
        state.mintRefundPending = {
          mint: mintUrl,
          inputs: escrowedToken!,
          outputs: wireOutputs as EscrowSwapOutputWire[],
          message,
          signatures: witness,
          fee: refundFee,
          amount: refundAmount,
        };
        saveState(state);
        const signatures = await submitSwap(mintUrl, withWitness(escrowedProofs, message, [donorPriv!]), refundOutputs);
        const refunded = unblindProofs(refundOutputs as never, signatures, keyset!);
        expect(total(refunded)).toBe(refundAmount);
        expect(await checkUnspent(mintUrl, refunded), 'the mint does not report the donor refund proofs UNSPENT').toBe(true);
        state.refundToken = getEncodedToken({ mint: mintUrl, proofs: refunded });
        state.refundAmountSats = refundAmount;
        state.refundVia = 'mint';
        state.mintRefundPending = undefined;
        saveState(state);
        console.log(`[drill] refunded ${refundAmount} sats to the donor at the mint (refund key after CLTV; API refund refused: ${apiRefusal})`);
      }
    }

    // ── 7. settled state on a fresh read + mint proof state ────────────────
    if (state.releasedToken) {
      const settled = await fetchFundraiser(campaignId!);
      const settledMilestone = settled.milestones.find((m) => m.id === milestoneId) as unknown as {
        status?: string;
        payout_reference?: string | null;
        escrow_released_sats?: number;
      };
      expect(settledMilestone?.status).toBe('released');
      expect(settledMilestone?.payout_reference).toBe('cashu-escrow-swap');
      expect(Number(settledMilestone?.escrow_released_sats ?? 0)).toBeGreaterThan(0);
      console.log(`[drill] SETTLED: milestone ${milestoneId} released, escrow_released_sats=${settledMilestone?.escrow_released_sats}`);
    } else if (state.refundToken) {
      const escrowedToken = state.escrowedToken ?? state.lockedToken;
      const escrowedProofs = getDecodedToken(escrowedToken!, keysets).proofs;
      expect(await checkSpent(mintUrl, escrowedProofs), 'the escrowed proofs are not SPENT at the mint after the refund').toBe(true);
      const rows = await fetchContributions(campaignId!);
      const row = rows.find((c) => String(c.id) === String(state.contributionId));
      expect(row, 'the refunded contribution is not on the public list').toBeTruthy();
      console.log(`[drill] SETTLED: contribution ${state.contributionId} refunded ${state.refundAmountSats} sats to the donor via ${state.refundVia}; escrowed proofs SPENT at the mint`);
    }
  }, 600_000);
});
