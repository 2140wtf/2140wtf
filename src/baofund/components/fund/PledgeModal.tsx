/**
 * PledgeModal - fund a campaign.
 *
 *  - TESTNET (default): Bitcoin testnet4 or Liquid testnet - NO VALUE coins
 *    from the public faucets, paid to the campaign's scripted escrow address;
 *    the donor commits the txid and the confirmation probe verifies it on-chain.
 *  - MAINNET CASHU (campaign `network: 'mainnet'`, or the legacy
 *    [rail:mainnet-cashu] description marker): issues
 *    a REAL ecash token from the donor's mainnet wallet. The token goes
 *    straight to the founder (off-ledger, no custody) - shown to the donor
 *    for delivery (copy / campaign chat).
 *
 *  - RAIL MATCHING: the picker offers only the rails the campaign itself is
 *    configured for. Unsupported campaign rails (cashu on testnet, lightning,
 *    …) fail closed with an explanation instead of silently funding over a
 *    different rail than the founder chose.
 *
 * RECOVERY NOTE (2026-08-22): rebuilt after the rm -rf incident. All logic
 * (state, submit, commitTxid, idempotency, wallet interplay) is verbatim
 * from the pre-loss session; the render JSX below the form fields is a
 * behavioral reconstruction - section order/styling may differ cosmetically
 * from the original newspaper-theme layout.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  fetchContributions,
  fetchVerificationModels,
  railLabel,
  type BaoRail,
  type VerificationModel,
} from '../../lib/baoFundraising';
import { createGuestSigner, getGuestPubkeyHex } from '../../relay/guestIdentity';
import { useAuth } from '../../auth/useAuth';
import { sendNutzap } from '../../wallet/nip61';
import { baoRelayUrl } from '../../lib/baoFundraising';
import { completeLightningTopUp, createLightningTopUp, loadPendingTopUp, loadStoredWallet, spendFromStoredWallet, sumProofs } from '../../wallet/cashuWallet';
import { checkTokenProofsSpent, decodeCashuToken, normalizeProofWitnessForEncode } from '../../lib/cashu/tokenUtils';
import { getEncodedToken } from 'cashu-ts3';
import { LightningInvoice } from '../../wallet/LightningInvoice';
import { awaitingAddresses, confirmedPledgeFor, submitPledge, type PledgeAwaitingPayment } from './pledgeFlow';
import { EscrowAddressQR } from './EscrowAddressQR';
import { MilestoneBreakdownList } from './MilestoneBreakdownList';
import { waterfallAllocation } from './waterfall';
import type { CampaignBreakdown } from './campaignBreakdown';
import { errorMessage } from '../../lib/errors';
import { safeExplorerHref } from '../../lib/safeUrl';
import { BTC_TESTNET4_RAIL, TESTNET4_NO_VALUE_BADGE } from '../../lib/testnet4Rail';
import '../../theme/newspaperTheme.css';

/**
 * UI rails this modal can execute for a campaign's configured settlement
 * rails. The API names the on-chain testnet rails 'l1'/'liquid'; the picker
 * uses the testnet names. No rail metadata at all (older relay-only cards)
 * keeps the full testnet picker; rails with no executable path are returned
 * as `unsupported` so the caller can fail closed.
 */
export function pledgeRailsFor(campaignRails?: readonly string[] | null): {
  rails: BaoRail[];
  unsupported: string[];
} {
  const configured = (campaignRails ?? []).filter((r): r is string => typeof r === 'string' && r.length > 0);
  if (configured.length === 0) return { rails: ['btc-testnet4', 'liquid-testnet'], unsupported: [] };
  const rails: BaoRail[] = [];
  const unsupported: string[] = [];
  for (const raw of configured) {
    const r = raw.toLowerCase();
    const ui: BaoRail | null =
      r === 'l1' || r === 'btc-testnet4' ? BTC_TESTNET4_RAIL
        : r === 'liquid' || r === 'liquid-testnet' ? 'liquid-testnet'
          : null;
    if (ui) {
      if (!rails.includes(ui)) rails.push(ui);
    } else if (!unsupported.includes(r)) {
      unsupported.push(r);
    }
  }
  return { rails, unsupported };
}

export function PledgeModal({
  fundraiserId,
  title,
  mainnetCashu = false,
  ownerPubkey,
  campaignRails,
  breakdown,
  nowSec,
  onDone,
  onClose,
}: {
  fundraiserId: string;
  title: string;
  /** True when the campaign is marked [rail:mainnet-cashu] - real money flow. */
  mainnetCashu?: boolean;
  /** Founder's Nostr pubkey (hex) - enables direct NIP-61 nutzap delivery. */
  ownerPubkey?: string;
  /** Settlement rail(s) the campaign is configured for (API or UI ids). The
   *  picker offers only executable matches; a campaign with rails this app
   *  cannot execute fails closed instead of funding over a different rail. */
  campaignRails?: readonly string[];
  /** Campaign breakdown: the popup then opens on the milestones step, whose
   *  bottom button leads into the pledge form - one window, not two. */
  breakdown?: CampaignBreakdown;
  /** Injected clock for milestone deadlines; null/missing hides them. */
  nowSec?: number | null;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('1000');
  // Milestones first when the caller supplied the breakdown (card → Fund).
  const [step, setStep] = useState<'milestones' | 'pledge'>(breakdown ? 'milestones' : 'pledge');
  // On-chain rails with several milestones: one tx, one escrow output each.
  const [splitPledge, setSplitPledge] = useState(true);
  const canSplit = !mainnetCashu && (breakdown?.milestones.length ?? 0) > 1;
  // Rail matching: only the campaign's own executable rails are offered. The
  // modal is mounted fresh per pledge target, so the first match is a safe
  // initial state; 'cashu' needs a donor token and is not executable here.
  const { rails: configuredRails, unsupported: unsupportedRails } = pledgeRailsFor(campaignRails);
  const [rail, setRail] = useState<BaoRail>(configuredRails[0] ?? 'btc-testnet4');
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const [models, setModels] = useState<VerificationModel[]>([]);
  const [judgeModel, setJudgeModel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetchVerificationModels()
      .then((r) => {
        if (cancelled) return;
        setModels(r.models);
        setJudgeModel((prev) => prev || r.defaultModel);
      })
      .catch(() => {
        /* registry unreachable - contribution proceeds with server default */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [deliveredAsNutzap, setDeliveredAsNutzap] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [awaiting, setAwaiting] = useState<PledgeAwaitingPayment | null>(null);
  const [txidInput, setTxidInput] = useState('');
  /** Payment watcher: while a deposit address is outstanding, poll the
   *  campaign's contribution book - the API detects the on-chain payment
   *  from the address itself, so the donor never has to paste a txid. */
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  // One UUID per modal open - the idempotency key derives from it plus the
  // pledge parameters, so retrying the same pledge reuses the key (the server
  // dedupes replays) while changing amount/rail intentionally starts a new intent.
  const [intentUuid] = useState(() => crypto.randomUUID());
  // External-wallet path (mainnet cashu): a Lightning top-up QR mints sats
  // into the built-in wallet; a pasted token is delivered as-is.
  const [topUp, setTopUp] = useState<{ quoteId: string; invoice: string; amountSats: number; mintUrl: string } | null>(null);
  const [topUpMsg, setTopUpMsg] = useState('');
  const [pastedToken, setPastedToken] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const [delivering, setDelivering] = useState(false);
  // Ref guard: two clicks in one tick both see the stale `delivering` state.
  const deliveringRef = useRef(false);

  // Resume a top-up quote that survived a reload/close (NUT-04 has no
  // auto-refund: a paid invoice whose quote id is lost strands the sats).
  useEffect(() => {
    const pending = loadPendingTopUp();
    if (!pending) return;
    // Deferred to a microtask: external-system sync without a reachable
    // synchronous setState in the effect body.
    void Promise.resolve().then(() => {
      setTopUp({ quoteId: pending.quoteId, invoice: pending.invoice, amountSats: pending.amountSats, mintUrl: pending.mintUrl });
      setTopUpMsg(`Invoice for ${pending.amountSats.toLocaleString()} sats is still open - pay it and the sats mint automatically.`);
    });
  }, []);

  // Poll a pledge top-up quote until the mint sees the payment; the wallet
  // store then holds the sats and the normal "Issue real token" flow works.
  useEffect(() => {
    if (!topUp) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await completeLightningTopUp(topUp.quoteId, topUp.mintUrl);
        if (cancelled) return;
        if (res.state === 'paid') {
          setTopUpMsg(`Paid - minted ${res.minted.toLocaleString()} sats. Now press "Issue real token".`);
          setTopUp(null);
        }
      } catch {
        /* keep polling - transient mint errors are expected */
      }
    };
    const iv = setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [topUp]);

  const createPledgeTopUp = async (): Promise<void> => {
    // One open quote at a time: replacing it would orphan a paid invoice.
    if (topUp) return;
    const sats = Math.round(Number(amount));
    if (!Number.isFinite(sats) || sats <= 0) {
      setTopUpMsg('Enter an amount in sats first.');
      return;
    }
    setTopUpMsg('');
    try {
      const quote = await createLightningTopUp(sats);
      setTopUp(quote);
      setTopUpMsg(`Invoice for ${quote.amountSats.toLocaleString()} sats - scan it or copy it into any Lightning wallet.`);
    } catch (err) {
      setTopUpMsg(errorMessage(err));
    }
  };

  /** Deliver a token issued by ANY wallet as the pledge (nutzap + copy). */
  const deliverPastedToken = async (): Promise<void> => {
    if (deliveringRef.current) return;
    deliveringRef.current = true;
    setPasteMsg('');
    try {
      const entries = decodeCashuToken(pastedToken.trim());
      if (!entries || entries.length !== 1) {
        setPasteMsg('That is not a single-mint Cashu token - check you copied the whole token.');
        return;
      }
      // The token must cover exactly the pledge the donor typed: silently
      // delivering 1,000 sats for a 250,000-sat pledge (or the reverse) is a
      // money error with no server-side cross-check on the mainnet path.
      const pledged = Math.round(Number(amount));
      if (!Number.isFinite(pledged) || pledged <= 0) {
        setPasteMsg('Enter the pledge amount in sats first.');
        return;
      }
      if (entries[0].amount !== pledged) {
        setPasteMsg(`This token holds ${entries[0].amount.toLocaleString()} sats but the pledge is ${pledged.toLocaleString()} sats - set the amount to match or use a different token.`);
        return;
      }
      setDelivering(true);
      // Deliver the VALIDATED entry, not the raw paste: decodeCashuToken
      // drops malformed proofs, and the raw token would deliver them too
      // (the mint then rejects the whole batch).
      const token = getEncodedToken({
        mint: entries[0].mintUrl,
        proofs: (entries[0].proofs as never[]).map(normalizeProofWitnessForEncode),
        unit: 'sat',
      });
      // Never deliver proofs that are already spent at the mint.
      const spent = await checkTokenProofsSpent(token);
      if (spent === true) {
        setPasteMsg('These proofs are already spent at the mint - nothing was delivered.');
        return;
      }
      setIssuedToken(token);
      if (ownerPubkey && auth.signer) {
        try {
          const sent = await sendNutzap({
            recipientPubkey: ownerPubkey,
            token,
            mint: entries[0].mintUrl,
            signer: auth.signer,
            relays: [baoRelayUrl()],
            memo: `Pledge for "${title}"`,
          });
          setDeliveredAsNutzap(sent.eventId.slice(0, 12));
        } catch {
          // Delivery failed - the token is still shown for manual handoff.
        }
      }
    } finally {
      deliveringRef.current = false;
      setDelivering(false);
    }
  };

  /**
   * Signing identity for the pledge. REAL money (mainnet) requires a
   * signed-in user key - no silent guest fallback on the mainnet rail.
   * Playground pledges may ride the per-browser guest identity.
   */
  const pledgeSigner = () => {
    if (mainnetCashu && !auth.signer) {
      throw new Error('Sign in to pledge real sats - mainnet pledges need your key (no guest fallback).');
    }
    return {
      signer: auth.signer ?? createGuestSigner(),
      pubkey: auth.pubkey ?? getGuestPubkeyHex(),
    };
  };
  /** Stable per-intent idempotency key (server dedupes replays). */
  const idempotencyKey = (amountSats: number) =>
    `baofund:${fundraiserId}:${rail}:${amountSats}:${intentUuid}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!mainnetCashu && configuredRails.length === 0) {
        throw new Error(
          `This campaign settles on ${unsupportedRails.map(railLabel).join(' / ') || 'a rail this app does not support'} - no pledge was recorded.`,
        );
      }
      if (mainnetCashu) {
        // Fail closed BEFORE any real-money work: the mainnet branch never
        // records a NIP-98 contribution, so this guard is the only place the
        // signed-in requirement is enforced (no guest fallback, no anonymous
        // issue from the local hot wallet).
        pledgeSigner();
        // REAL money: mint a token from the donor's mainnet wallet.
        const sats = Math.round(Number(amount));
        if (!Number.isFinite(sats) || sats <= 0) throw new Error('Enter an amount in sats.');
        // Read-only UX pre-check (the authoritative check runs inside the
        // serialized spend below).
        const balance = sumProofs(loadStoredWallet().proofs);
        if (balance < sats) {
          throw new Error(
            `Mainnet wallet balance is ${balance.toLocaleString()} sats - top up with Lightning below or paste a token from your own wallet.`,
          );
        }
        // Atomic load→swap→persist inside the wallet's serialized queue - a
        // manual loadStoredWallet/saveStoredWallet sandwich here lost any
        // concurrent writer's proofs during the mint round-trip.
        const { token, mintUrl } = await spendFromStoredWallet(sats);
        setIssuedToken(token);
        // Direct NIP-61 delivery: publish the proofs as a nutzap addressed
        // to the founder so their wallet's claim loop picks it up with no
        // copy/paste. The token above remains visible as the manual fallback.
        if (ownerPubkey && auth.signer) {
          try {
            const sent = await sendNutzap({
              recipientPubkey: ownerPubkey,
              token,
              mint: mintUrl,
              signer: auth.signer,
              relays: [baoRelayUrl()],
              memo: `Pledge for "${title}"`,
            });
            setDeliveredAsNutzap(sent.eventId.slice(0, 12));
          } catch {
            // Delivery failed - the token is still intact for manual handoff.
          }
        }
        return; // keep modal open so the donor can verify or copy the token
      }
      const amountSats = Math.round(Number(amount));
      const result = await submitPledge(pledgeSigner(), {
        fundraiserId,
        amountSats,
        rail,
        judgeModel,
        idempotencyKey: idempotencyKey(amountSats),
        ...(canSplit && splitPledge ? { split: true } : {}),
      });
      if (result.ok && result.awaitingPayment) {
        setAwaiting(result.awaitingPayment);
      } else if (result.ok) onDone(result.message);
      else setError(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Check now: read the campaign's contribution book and look for a
   * CONFIRMED deposit paying one of this pledge's escrow addresses. The
   * backend detects the payment from the address, so no txid is needed.
   * Returns true when the payment is found (caller can close/report).
   */
  const checkPayment = async (opts: { auto?: boolean } = {}): Promise<boolean> => {
    if (!awaiting) return false;
    if (!opts.auto) setError(null);
    setChecking(true);
    try {
      const rows = await fetchContributions(fundraiserId);
      const addresses = awaitingAddresses(awaiting);
      const hit = confirmedPledgeFor(rows, addresses);
      if (!hit) {
        if (!opts.auto) {
          setCheckNote('No confirmed payment found yet - it can take a minute after broadcast. We keep checking automatically.');
        }
        return false;
      }
      // Split pledge: one tx, one escrow output per milestone. The pledge is
      // only fully paid when EVERY output's address shows a confirmation -
      // closing on the first one would drop the remaining milestones.
      if (addresses.length > 1) {
        const confirmedAddrs = new Set(
          rows.filter((c) => c.status === 'confirmed' && typeof c.deposit_address === 'string').map((c) => c.deposit_address as string),
        );
        if (!addresses.every((a) => confirmedAddrs.has(a))) {
          setCheckNote('Part of the transaction confirmed - waiting for the remaining milestone outputs…');
          return false;
        }
      }
      const total = rows
        .filter((c) => c.status === 'confirmed' && typeof c.deposit_address === 'string' && addresses.includes(c.deposit_address as string))
        .reduce((acc, c) => acc + (c.amount_sats ?? 0), 0);
      onDone(
        `Pledge confirmed on-chain · ${(total > 0 ? total : hit.amount_sats).toLocaleString()} sats · rail ${hit.rail}` +
        (hit.explorer_tx_url ? ` · ${hit.explorer_tx_url}` : ''),
      );
      return true;
    } catch (err) {
      if (!opts.auto) setError(errorMessage(err));
      return false;
    } finally {
      setChecking(false);
    }
  };

  // Auto-watch: while the deposit address is outstanding, poll the book
  // (12 × 10s). The backend confirms from the address; the modal closes on
  // its own once the payment lands. A manual "check now" is always present.
  useEffect(() => {
    if (!awaiting) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      const found = await checkPayment({ auto: true });
      if (cancelled || found) return;
      if (attempts >= 12) {
        setCheckNote('Still no confirmed payment - check the address on the explorer, then press "Check payment".');
        return;
      }
      timer = setTimeout(tick, 10_000);
    };
    timer = setTimeout(tick, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkPayment is derived from `awaiting`; re-arming on it is enough
  }, [awaiting]);

  // Optional fallback for wallets that only expose the txid: commit it and
  // let the API verify it. The primary flow is the watcher above.
  const commitTxid = async (e: React.FormEvent) => {
    e.preventDefault();
    const isT4 = rail === BTC_TESTNET4_RAIL;
    if (!awaiting || !/^[0-9a-f]{64}$/.test(txidInput.trim())) {
      setError(isT4
        ? 'Paste the 64-character lowercase hex transaction id from your testnet4 wallet.'
        : 'Paste the 64-character transaction id from your Liquid testnet wallet.');
      return;
    }
    setBusy(true);
    setError(null);
    const amountSats = Math.round(Number(amount));
    const result = await submitPledge(pledgeSigner(), {
      fundraiserId,
      amountSats,
      rail,
      judgeModel,
      txid: txidInput.trim(),
      idempotencyKey: idempotencyKey(amountSats),
      ...(awaiting?.splitGroup ? { splitGroup: awaiting.splitGroup } : {}),
    });
    setBusy(false);
    if (result.ok) {
      // The txid is recorded, not verified: a well-formed txid that does not
      // pay the escrow must not be reported as a completed pledge. Keep the
      // watcher running (still armed on `awaiting`) and surface the state.
      setCheckNote('Transaction id submitted - verifying on the explorer. We keep checking the address for you.');
      setTxidInput('');
    } else {
      setError(result.message);
    }
  };

  /** Close is refused while a mainnet operation is in flight: unmounting
   *  after spendFromStoredWallet commits but before the token is shown would
   *  destroy the only copy of real sats. */
  const requestClose = (): void => {
    if (busy) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={requestClose}>
      <div
        role="dialog"
        aria-label={`Fund ${title}`}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto border bg-[var(--np-bg)] p-5"
        style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-serif)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {/* NOTE: no text-transform here - the E2E scripts assert the exact
              mixed-case strings via innerText.includes(). */}
          <h2 className="text-lg font-bold tracking-wide" style={{ color: 'var(--np-ink)', fontFamily: 'var(--np-font-serif)' }}>
            {mainnetCashu ? 'Fund with real Cashu (mainnet)' : 'Fund this project (testnet)'}
          </h2>
          <button type="button" onClick={requestClose} aria-label="Close"
            className="border px-2 py-0.5 text-xs uppercase tracking-widest"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
            ✕
          </button>
        </div>
        <p className="mb-3 text-[11px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          {title}
        </p>

        {mainnetCashu && (
          <p className="mb-3 border p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--np-success)', color: 'var(--np-ink)', background: 'var(--np-bg)' }}>
            <b>Real money.</b> This creates a mainnet Cashu token from YOUR wallet. Whoever redeems
            it owns the sats - deliver it to the founder (copy it, or paste it in the campaign chat).
          </p>
        )}

        {!awaiting && !issuedToken && step === 'milestones' && breakdown && (
          <div>
            {breakdown.description && (
              <p className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
                {breakdown.description}
              </p>
            )}
            <div className="mb-1 flex items-baseline justify-between text-[11px]" style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}>
              <span>
                {breakdown.raisedSats.toLocaleString()} / {breakdown.goalSats.toLocaleString()} sats
              </span>
              <span>{breakdown.goalSats > 0 ? Math.min(100, Math.round((breakdown.raisedSats / breakdown.goalSats) * 100)) : 0}%</span>
            </div>
            <div className="mb-4 h-[3px] w-full" style={{ background: 'var(--np-rule)' }}>
              <div
                className="h-full"
                style={{
                  width: `${breakdown.goalSats > 0 ? Math.min(100, Math.round((breakdown.raisedSats / breakdown.goalSats) * 100)) : 0}%`,
                  background: 'var(--np-accent)',
                }}
              />
            </div>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              Milestones · {breakdown.milestones.length}
            </h3>
            <MilestoneBreakdownList campaign={breakdown} nowSec={nowSec ?? null} canFund={false} />
            <button
              type="button"
              onClick={() => setStep('pledge')}
              className="mt-4 w-full border px-4 py-2 text-xs font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}
            >
              {mainnetCashu ? 'Fund with real Cashu (mainnet)' : 'Fund this project (testnet)'}
            </button>
          </div>
        )}

        {!awaiting && !issuedToken && step === 'pledge' && (
          <form onSubmit={submit}>
            {breakdown && (
              <button
                type="button"
                onClick={() => setStep('milestones')}
                className="mb-3 text-[10px] uppercase tracking-widest underline"
                style={{ color: 'var(--np-muted)' }}
              >
                ← Milestones
              </button>
            )}
            <label className="mb-3 block">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Amount (sats)</span>
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required
                disabled={Boolean(awaiting)}
                className="mt-1 w-full border px-2 py-1.5 text-sm outline-none disabled:opacity-50" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }} />
              {awaiting && <span className="mt-1 block text-[10px]" style={{ color: 'var(--np-muted)' }}>Locked while this payment is outstanding - the escrow address was derived from this amount.</span>}
            </label>
            {mainnetCashu && (
              <div className="mb-3 border p-3" style={{ borderColor: 'var(--np-rule)' }} data-testid="external-payment-panel">
                <p className="mb-2 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                  No balance? Pay from another wallet
                </p>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void createPledgeTopUp()}
                    disabled={busy || Boolean(topUp)}
                    data-testid="pledge-topup"
                    className="rounded border px-3 py-1.5 text-xs"
                    style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                  >
                    Top up with Lightning (QR)
                  </button>
                  <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
                    Mints {amount || '0'} sats into your wallet at the active mint.
                  </span>
                </div>
                {topUp && (
                  <div className="mb-2">
                    <LightningInvoice
                      invoice={topUp.invoice}
                      amountSats={topUp.amountSats}
                      caption="Scan with any Lightning wallet"
                      status={topUpMsg}
                      size={168}
                    />
                  </div>
                )}
                {!topUp && topUpMsg && <div className="mb-2 text-[10px]" style={{ color: 'var(--np-muted)' }}>{topUpMsg}</div>}
                <label className="mt-2 block">
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                    Or paste a Cashu token from your own wallet
                  </span>
                  <textarea
                    value={pastedToken}
                    onChange={(e) => setPastedToken(e.target.value)}
                    rows={2}
                    placeholder="cashuA… / cashuB… (cashu.me, Minibits, …)"
                    data-testid="pledge-token-input"
                    className="mt-1 w-full border px-2 py-1.5 text-[11px] outline-none"
                    style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void deliverPastedToken()}
                  disabled={busy || delivering || !pastedToken.trim()}
                  data-testid="pledge-token-deliver"
                  className="mt-2 rounded border px-3 py-1.5 text-xs disabled:opacity-50"
                  style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                >
                  Deliver token to founder
                </button>
                {pasteMsg && <div className="mt-1 text-[10px]" style={{ color: 'var(--np-danger, #b00)' }}>{pasteMsg}</div>}
              </div>
            )}
            {!mainnetCashu && (
              <>
                <label className="mb-3 block">
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Rail</span>
                  {configuredRails.length === 0 ? (
                    <span
                      data-testid="rail-unsupported"
                      className="mt-1 block border p-2 text-[11px] leading-relaxed"
                      style={{ borderColor: 'var(--np-danger, #b00)', color: 'var(--np-ink)' }}
                    >
                      This campaign settles on {unsupportedRails.map(railLabel).join(' / ') || 'a rail this app does not support'}.
                      Donations for that rail are not available yet - no pledge can be placed.
                    </span>
                  ) : (
                    <select value={rail} onChange={(e) => setRail(e.target.value as BaoRail)} disabled={Boolean(awaiting)}
                      data-testid="pledge-rail"
                      className="mt-1 w-full border px-2 py-1.5 text-sm outline-none disabled:opacity-50" style={{ borderColor: 'var(--np-rule)' }}>
                      {configuredRails.map((r) => (
                        <option key={r} value={r}>
                          {r === 'liquid-testnet'
                            ? 'Liquid testnet - NO VALUE (scripted escrow, zero platform keys)'
                            : 'Bitcoin testnet4 - TESTNET4 · NO VALUE (scripted escrow, zero platform keys)'}
                        </option>
                      ))}
                    </select>
                  )}
                  {configuredRails.length > 0 && rail === 'btc-testnet4' && (
                    <span
                      data-testid="t4-badge"
                      className="mt-1 inline-block border px-1.5 py-0.5 text-[10px] font-bold tracking-widest"
                      style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', background: 'var(--np-bg)' }}
                    >
                      {TESTNET4_NO_VALUE_BADGE}
                    </span>
                  )}
                  {configuredRails.length > 0 && (
                    <span className="mt-1 block text-[10px]" style={{ color: 'var(--np-muted)' }}>
                      Every pledge locks into the milestone tapscript escrow - released when the milestone verifies,
                      refunded to YOUR key when it fails (CLTV). The platform never holds keys. Verify every
                      output on the explorer{rail === 'liquid-testnet' ? ' (Liquid testnet blockstream.info/testnet)' : ' (mempool.space/testnet4)'}.
                    </span>
                  )}
                </label>
                {canSplit && (
                  <label className="mb-3 flex items-start gap-2 text-[11px]" style={{ color: 'var(--np-ink)' }}>
                    <input
                      type="checkbox"
                      checked={splitPledge}
                      onChange={(e) => setSplitPledge(e.target.checked)}
                      disabled={Boolean(awaiting)}
                      className="mt-0.5"
                      data-testid="split-pledge"
                    />
                    <span>
                      <b>Pay all milestones in one transaction</b> - one escrow output per
                      milestone ({breakdown?.milestones.length} outputs, same tx). Each output is
                      bound to its milestone and releases with it.
                    </span>
                  </label>
                )}
                <label className="mb-3 block">
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                    AI judge vote (pledges ≥ 1,000 sats)
                  </span>
                  <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)}
                    className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)' }}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px]" style={{ color: 'var(--np-muted)' }}>
                    Your sats-weighted vote picks which AI model verifies delivery.
                  </span>
                </label>
              </>
            )}
            {error && (
              <p className="mb-3 border p-2 text-xs" style={{ borderColor: 'var(--np-danger, #b00)', color: 'var(--np-ink)' }}>
                {error}
              </p>
            )}
            {breakdown && breakdown.milestones.length > 0 && (() => {
              // Waterfall preview: the single escrow fills milestones in order.
              const pledgeSats = Math.round(Number(amount));
              const rows = waterfallAllocation(breakdown.milestones, breakdown.raisedSats, pledgeSats);
              return (
                <div className="mb-3 border p-2" style={{ borderColor: 'var(--np-rule)' }} data-testid="waterfall-preview">
                  <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>This pledge fills</p>
                  <ul className="mt-1 space-y-0.5 text-[10px]" style={{ fontFamily: 'var(--np-font-mono)' }}>
                    {rows.map((r, i) => (
                      <li key={r.id} style={{ color: r.addedSats > 0 ? 'var(--np-ink)' : 'var(--np-muted)' }}>
                        {i + 1}. {r.title} - {r.complete
                          ? 'funded'
                          : r.addedSats > 0
                            ? `+${r.addedSats.toLocaleString()} of ${r.targetSats.toLocaleString()} sats`
                            : r.beforeSats > 0
                              ? `${r.beforeSats.toLocaleString()}/${r.targetSats.toLocaleString()} sats`
                              : 'not reached yet'}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>
                    Milestones fill in order - later ones fund once the earlier ones are covered.
                  </p>
                </div>
              );
            })()}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={requestClose}
                className="border px-3 py-1.5 text-xs uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
                Cancel
              </button>
              <button type="submit" disabled={busy || (!mainnetCashu && configuredRails.length === 0)}
                className="border px-4 py-1.5 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}>
                {busy ? 'Working…' : mainnetCashu ? 'Issue real token' : 'Pledge (testnet)'}
              </button>
            </div>
          </form>
        )}

        {issuedToken && (
          <div>
            <p className="mb-2 text-[11px]" style={{ color: 'var(--np-muted)' }}>
              {deliveredAsNutzap ? (
                <>
                  <b style={{ color: 'var(--np-success)' }}>⚡ Delivered to the founder's wallet as a nutzap ({deliveredAsNutzap}…)</b>{' '}
                  - it lands in their Wallet → Claim automatically.
                </>
              ) : (
                <>Token issued - deliver it to the founder (copy → paste in the campaign chat).{' '}<b>Anyone who holds it owns the sats.</b></>
              )}
            </p>
            <textarea readOnly value={issuedToken} rows={6}
              className="w-full border p-2 text-[10px] outline-none" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }} />
            {error && <p className="mt-2 text-xs" style={{ color: '#b00' }}>{error}</p>}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" disabled={copied}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issuedToken);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch { /* clipboard unavailable - donor can select manually */ }
                }}
                className="border px-4 py-1.5 text-xs font-bold uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}>
                {copied ? 'Copied ✓' : 'Copy token'}
              </button>
              <button type="button" onClick={() => onDone('Mainnet token issued - deliver it to the founder.')}
                className="border px-3 py-1.5 text-xs uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {awaiting && (
          <form onSubmit={commitTxid}>
            <p className="mb-2 border p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--np-accent)', background: 'var(--np-accent-dim, transparent)' }}>
              <b>Need testnet coins?</b>{' '}
              {awaiting.rail === 'liquid-testnet' ? (
                <>
                  Use the Liquid testnet faucet - search "Liquid testnet faucet" or visit{' '}
                  <a href="https://blockstream.info/liquidtestnet" target="_blank" rel="noreferrer" className="underline">blockstream.info/liquidtestnet</a>{' '}
                  for the current links - and paste this address to receive free LBTC (no value). Watch the deposit
                  land on{' '}
                  <a href={`https://blockstream.info/liquidtestnet/address/${awaiting.address}`} target="_blank" rel="noreferrer" className="underline">the explorer</a>.
                </>
              ) : (
                <>
                  Claim from the public Bitcoin testnet4 faucet{' '}
                  <a href="https://coinfaucet.eu/en/btc-testnet4/" target="_blank" rel="noreferrer" className="underline">coinfaucet.eu/en/btc-testnet4</a>{' '}
                  - paste this tb1p… address there and free sats arrive in seconds. Watch them land on{' '}
                  <a href={`https://mempool.space/testnet4/address/${awaiting.address}`} target="_blank" rel="noreferrer" className="underline">mempool.space/testnet4</a>.
                </>
              )}
            </p>
            {awaiting.outputs && awaiting.outputs.length > 0 && (
              <div className="mb-3 border p-2" style={{ borderColor: 'var(--np-rule)' }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                  One transaction · {awaiting.outputs.length} milestone escrow{awaiting.outputs.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1 space-y-1.5 text-[11px]" style={{ fontFamily: 'var(--np-font-mono)' }}>
                  {awaiting.outputs.map((o, i) => {
                    const title = breakdown?.milestones.find((m) => m.id === o.milestoneId)?.title ?? `Milestone ${i + 1}`;
                    return (
                      <li key={o.milestoneId} data-testid="split-output">
                        <b>{i + 1}. {title}</b> - {o.amountSats.toLocaleString()} sats
                        <br />
                        <code className="break-all" style={{ fontFamily: 'var(--np-font-mono)' }}>{o.address}</code>
                        {' '}
                        <EscrowAddressQR address={o.address} size={132} />
                        {o.explorerUrl && safeExplorerHref(o.explorerUrl) ? (
                          <>
                            {' '}·{' '}
                            <a href={safeExplorerHref(o.explorerUrl)!} target="_blank" rel="noreferrer" className="underline">explorer</a>
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>
                  Total <b>{awaiting.amountSats.toLocaleString()} sats</b> - pay every output in a SINGLE transaction from your wallet. We detect the payment automatically; the txid is optional.
                </p>
                {awaiting.rail === BTC_TESTNET4_RAIL && (
                  <span className="mt-1 block text-[10px] font-bold tracking-widest" data-testid="t4-badge-awaiting">
                    {TESTNET4_NO_VALUE_BADGE}
                  </span>
                )}
              </div>
            )}

            {(!awaiting.outputs || awaiting.outputs.length === 0) && (
              <p className="mb-3 border p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}>
              Pay <b>{awaiting.amountSats.toLocaleString()} sats</b> to the escrow address
              {awaiting.rail === 'liquid-testnet' ? ' (Liquid testnet - NO VALUE)' : ' (testnet4 - NO VALUE)'}:<br />
              <code className="break-all" style={{ fontFamily: 'var(--np-font-mono)' }}>{awaiting.address}</code>
              {awaiting.explorerUrl && safeExplorerHref(awaiting.explorerUrl) && (
                <>
                  {' '}·{' '}
                  <a
                    href={safeExplorerHref(awaiting.explorerUrl)!}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={awaiting.rail === 'btc-testnet4' ? 't4-explorer-address' : undefined}
                    className="underline"
                  >
                    explorer
                  </a>
                </>
              )}
              {awaiting.rail === 'btc-testnet4' && (
                <span className="mt-1 block text-[10px] font-bold tracking-widest" data-testid="t4-badge-awaiting">
                  {TESTNET4_NO_VALUE_BADGE}
                </span>
              )}
              </p>
            )}

            {(!awaiting.outputs || awaiting.outputs.length === 0) && (
              <div className="mb-3 flex justify-center">
                <EscrowAddressQR
                  address={awaiting.address}
                  size={168}
                  caption="Scan with your testnet wallet - no value"
                />
              </div>
            )}

            {(!awaiting.outputs || awaiting.outputs.length === 0) && (
              <div className="mb-3">
                <button
                  type="button"
                  data-testid="pledge-open-wallet"
                  onClick={() => window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', {
                    detail: {
                      tab: 'send',
                      rail: awaiting.rail === 'liquid-testnet' ? 'liquid' : 'l1',
                      to: awaiting.address,
                      sats: String(awaiting.amountSats),
                    },
                  }))}
                  className="w-full rounded border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
                >
                  Pay from your built-in {awaiting.rail === 'liquid-testnet' ? 'Liquid testnet' : 'Bitcoin testnet4'} wallet
                </button>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--np-muted)' }}>
                  Opens the wallet drawer with this escrow address and amount pre-filled; the pledge confirms the same
                  way (the escrow address is watched, the txid stays optional).
                </p>
              </div>
            )}

            <p
              data-testid="payment-watch"
              className="mb-3 border p-2 text-[11px] leading-relaxed"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <b>We check the address for you.</b> BAO watches the escrow address and confirms your
              pledge as soon as the payment is on-chain - no transaction id needed. You can close this
              window; the pledge appears in the campaign ledger.
            </p>
            {checkNote && (
              <p className="mb-3 text-[11px]" style={{ color: 'var(--np-muted)' }}>{checkNote}</p>
            )}
            <div className="mb-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => void checkPayment()} disabled={checking}
                className="border px-4 py-1.5 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}>
                {checking ? 'Checking…' : 'Check payment'}
              </button>
              <button type="button" onClick={requestClose}
                className="border px-3 py-1.5 text-xs uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
                Close
              </button>
            </div>

            <details className="mb-3">
              <summary className="cursor-pointer text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
                Have the transaction id? Commit it manually
              </summary>
              <label className="mt-2 block">
                <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Transaction id</span>
                <input type="text" value={txidInput} onChange={(e) => setTxidInput(e.target.value)}
                  placeholder="64-character txid"
                  className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }} />
              </label>
              <div className="mt-2 flex items-center justify-end">
                <button type="submit" disabled={busy}
                  className="border px-4 py-1.5 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                  style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', background: 'transparent' }}>
                  {busy ? 'Committing…' : 'Commit txid'}
                </button>
              </div>
            </details>
            {error && (
              <p className="mb-3 border p-2 text-xs" style={{ borderColor: '#b00', color: 'var(--np-ink)' }}>{error}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
