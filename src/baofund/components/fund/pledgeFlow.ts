/**
 * pledgeFlow - the claim → contribute orchestration behind PledgeModal,
 * extracted so the wiring is unit-testable without a DOM.
 *
 * Semantics (testnet):
 * - Only the legacy cashu rail claims the faucet and forwards the token as
 *   `cashu_token` - the live API's containment gate rejects every other rail
 *   on mainnet, and on the testnet network non-cashu rails are recorded without
 *   any token, so claiming for them would just burn the 24h faucet allowance.
 * - The idempotency key is composed by the caller (stable per checkout
 *   intent) so a retry after a network timeout dedupes server-side instead of
 *   double-recording the contribution.
 */
import {
  contributeToFundraiser,
  contributionErrorHint,
  type BaoContribution,
  type BaoRail,
} from '../../lib/baoFundraising';
import { errorMessage } from '../../lib/errors';
import { BTC_TESTNET4_RAIL, TESTNET4_EXPLORER_BASE } from '../../lib/testnet4Rail';

export interface PledgeRequest {
  fundraiserId: string;
  amountSats: number;
  rail: BaoRail;
  /** Donor's sats-weighted AI judge-model vote (counts for pledges ≥ 1,000 sats). */
  judgeModel?: string;
  /** Stable per checkout intent - retries of the same pledge reuse it. */
  idempotencyKey: string;
  /** Cashu lane: the donor-supplied ecash token. The old testnet HTTP faucet was
   *  removed - the pledge path now has no external write dependency. */
  cashuToken?: string;
  /** On-chain rails (l1/liquid): the donor's payment txid, attached on the
   * second step after the deposit address was shown. */
  txid?: string;
  /** Split pledge (on-chain rails): one tx, one milestone-bound output per
   * funded milestone. Requires a stable idempotencyKey. */
  split?: boolean;
  /** Group id returned by the split intent; set on the txid-commit call. */
  splitGroup?: string;
}

export interface PledgeDeps {
  signer: Parameters<typeof contributeToFundraiser>[0];
  pubkey: string;
}

export interface PledgeSplitOutput {
  milestoneId: string;
  address: string;
  amountSats: number;
  explorerUrl: string;
}

export interface PledgeAwaitingPayment {
  /** Primary address (first output for split pledges; the sole output otherwise). */
  address: string;
  amountSats: number;
  explorerUrl: string;
  rail: BaoRail;
  /** Split pledge: every milestone output funded by the SAME transaction. */
  splitGroup?: string;
  outputs?: PledgeSplitOutput[];
}

export interface PledgeResult {
  ok: boolean;
  /** Success summary for onDone, or the user-facing error text. */
  message: string;
  /** Sats the faucet granted for this attempt (0 on non-cashu rails or claim failure). */
  claimed: number;
  /** Set when the pledge is declared but the on-chain payment is outstanding
   * - the modal shows the deposit address and watches for the payment. */
  awaitingPayment?: PledgeAwaitingPayment;
}

/** Every escrow address this pledge pays (split outputs, or the single
 *  address). The payment watcher matches confirmed contributions against
 *  these. Pure. */
export function awaitingAddresses(a: PledgeAwaitingPayment): string[] {
  const outputs = a.outputs?.map((o) => o.address).filter((x): x is string => Boolean(x)) ?? [];
  return outputs.length > 0 ? outputs : [a.address];
}

/** The confirmed contribution paying one of this pledge's escrow addresses,
 *  when the API has already detected/confirmed it. The donor never has to
 *  supply the txid: the backend watches the address. Pure. */
export function confirmedPledgeFor(
  contributions: readonly BaoContribution[],
  addresses: readonly string[],
): BaoContribution | null {
  const wanted = new Set(addresses);
  return contributions.find(
    (c) => c.status === 'confirmed' && typeof c.deposit_address === 'string' && wanted.has(c.deposit_address),
  ) ?? null;
}

const ONCHAIN_RAILS: ReadonlySet<string> = new Set(['l1', 'liquid', BTC_TESTNET4_RAIL]);

/** UI rail ids → API rail ids. The picker offers testnet-named rails
 *  ('btc-testnet4', 'liquid-testnet'); the API contract names the same rails
 *  'l1' and 'liquid' (the fund API predates the testnet rename). Sending the
 *  UI value verbatim was rejected with "body/rail must be equal to one of the
 *  allowed values". */
export function apiRailFor(rail: BaoRail): BaoRail {
  if (rail === BTC_TESTNET4_RAIL) return 'l1';
  if (rail === 'liquid-testnet') return 'liquid';
  return rail;
}

export async function submitPledge(deps: PledgeDeps, req: PledgeRequest): Promise<PledgeResult> {
  const claimed = 0;

  // Cashu lane: the escrowed token must equal the contribution amount, so the
  // donor supplies it (self-hosted mint, another wallet, or a nutzap).
  if (req.rail === 'cashu' && !req.cashuToken) {
    return {
      ok: false,
      claimed: 0,
      message:
        'Cashu pledges need a donor-supplied ecash token - paste a token from your wallet (the old testnet faucet was removed). No pledge was recorded.',
    };
  }

  try {
    const res = await contributeToFundraiser(deps.signer, req.fundraiserId, {
      amount_sats: Math.round(req.amountSats),
      preferredModel: req.amountSats >= 1000 ? req.judgeModel || undefined : undefined,
      rail: apiRailFor(req.rail),
      // The live API gate: the cashu rail only passes with a donor token.
      cashuToken: req.cashuToken,
      reference: req.txid,
      idempotencyKey: req.idempotencyKey,
      ...(req.split ? { split: true } : {}),
      ...(req.splitGroup ? { splitGroup: req.splitGroup } : {}),
    });

    // On-chain rails: the first call (no txid) returns the per-contribution
    // escrow deposit address - the donor pays it from their own wallet, then
    // re-submits with the txid. Testnet4 falls back to the public testnet4
    // explorer when the API omits the link (design §6 step 5).
    const pi = res.payment_instructions;

    // On-chain rails: without a committed txid the pledge is payable ONLY
    // through a deposit address the API just issued. A 2xx with missing or
    // malformed instructions must fail closed - reporting a successful pledge
    // would leave the donor unable to pay while the modal closes as if the
    // contribution landed.
    if (ONCHAIN_RAILS.has(apiRailFor(req.rail)) && !req.txid) {
      // Split pledge: one tx pays one milestone-bound escrow output each.
      // Every advertised output needs a real address or the donor cannot pay
      // it (an empty address also renders an empty QR).
      if (pi?.kind === 'addresses' && Array.isArray(pi.outputs) && pi.outputs.length > 0
        && pi.outputs.every((o) => Boolean(o) && typeof o.address === 'string' && o.address.length > 0)) {
        const outputs = pi.outputs.map((o) => ({
          milestoneId: o.milestone_id,
          address: o.address,
          amountSats: o.amount_sats ?? 0,
          explorerUrl:
            o.explorer_url ??
            (req.rail === BTC_TESTNET4_RAIL ? `${TESTNET4_EXPLORER_BASE}/address/${o.address}` : ''),
        }));
        return {
          ok: true,
          claimed,
          message: `One transaction pays ${outputs.length} milestone escrow${outputs.length === 1 ? '' : 's'}`,
          awaitingPayment: {
            address: outputs[0].address,
            amountSats: pi.total_sats ?? Math.round(req.amountSats),
            explorerUrl: outputs[0].explorerUrl,
            rail: req.rail,
            splitGroup: res.split_group ?? pi.intent_id,
            outputs,
          },
        };
      }

      if (pi?.kind === 'address' && typeof pi.address === 'string' && pi.address.length > 0) {
        const explorerUrl =
          pi.explorer_url ??
          (req.rail === BTC_TESTNET4_RAIL ? `${TESTNET4_EXPLORER_BASE}/address/${pi.address}` : '');
        return {
          ok: true,
          claimed,
          message: `Deposit address issued for ${req.amountSats.toLocaleString()} sats`,
          awaitingPayment: {
            address: pi.address,
            amountSats: pi.amount_sats ?? Math.round(req.amountSats),
            explorerUrl,
            rail: req.rail,
          },
        };
      }

      return {
        ok: false,
        claimed,
        message:
          `The API did not return a usable escrow deposit address for rail ${req.rail} - ` +
          'no pledge was recorded and nothing was paid. Retry, or contact the campaign owner.',
      };
    }

    return {
      ok: true,
      claimed,
      message:
        `Pledged ${res.replayed && !req.txid ? ' (replayed)' : ''} ${req.amountSats.toLocaleString()} sats` +
        ` · rail ${req.rail} · ${deps.pubkey.slice(0, 8)}` +
        (req.txid ? ' · tx committed - verifying on the explorer' : ''),
    };
  } catch (err) {
    const raw = errorMessage(err);
    const hint = contributionErrorHint(err);
    return { ok: false, claimed, message: hint ? `${hint} (${raw})` : raw };
  }
}
