/**
 * OnchainReleaseSection - owner-only milestone release for on-chain escrow.
 *
 * Flow: prepare (API returns per-input sighashes + oracle co-signatures) →
 * the owner schnorr-signs each sighash with their key → submit → the API
 * returns the raw release transaction for the owner to broadcast. The API
 * never broadcasts and never marks the milestone released.
 */
import React, { useState } from 'react';
import { Copy, Check, Hammer } from 'lucide-react';

import {
  releaseOnchainMilestone,
  type OnchainReleasePlan,
  type OnchainReleaseTx,
  type SignerLike,
} from '../../lib/baoFundraising';
import { errorMessage } from '../../lib/errors';
import { safeExplorerHref } from '../../lib/safeUrl';

export function OnchainReleaseSection({
  fundraiserId,
  milestoneId,
  signer,
  milestoneLabel,
  onRoomNote,
}: {
  fundraiserId: string;
  milestoneId: string;
  signer: SignerLike | null;
  /** Milestone title for the campaign-room note (display only). */
  milestoneLabel?: string;
  /** Best-effort note posted to the campaign room when the release tx is
   *  assembled. MUST NOT throw, and MUST NOT block or disturb the money
   *  flow: a false/null result just skips the confirmation chip. */
  onRoomNote?: (text: string) => Promise<boolean>;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<OnchainReleasePlan | null>(null);
  const [tx, setTx] = useState<OnchainReleaseTx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The campaign-room note was posted (best-effort confirmation chip). */
  const [noted, setNoted] = useState(false);

  const canSignRaw = Boolean(signer?.signSchnorr);

  const prepare = async () => {
    if (!signer) return;
    setBusy(true);
    setError(null);
    try {
      const out = await releaseOnchainMilestone(signer, fundraiserId, milestoneId);
      setPlan(out as OnchainReleasePlan);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!signer?.signSchnorr || !plan) return;
    setBusy(true);
    setError(null);
    try {
      const signatures: string[] = [];
      for (const input of plan.inputs) {
        signatures.push(await signer.signSchnorr(input.sighash));
      }
      const out = await releaseOnchainMilestone(signer, fundraiserId, milestoneId, signatures);
      setTx(out as OnchainReleaseTx);
      // Fire-and-forget the campaign-room note (contributors in the room see
      // the milestone progress). Quiet by contract: failure only skips the
      // chip, never touches the money flow.
      const noteTx = out as OnchainReleaseTx;
      if (onRoomNote) {
        void onRoomNote(
          `Milestone "${milestoneLabel ?? milestoneId}" release transaction assembled — txid ${noteTx.txid.slice(0, 12)}… · awaiting founder broadcast (the API never broadcasts)`,
        ).then((ok) => { if (ok) setNoted(true); }).catch(() => { /* note is best-effort */ });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border p-2" style={{ borderColor: 'var(--np-accent-2)' }} data-testid="onchain-release">
      {!plan && !tx && (
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={busy || !canSignRaw}
          className="border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-50"
          style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)', background: 'transparent' }}
          title={canSignRaw ? 'Prepare the on-chain release transaction' : 'This signer cannot schnorr-sign raw hashes - use a seed login or a NIP-07 extension with signSchnorr'}
        >
          <Hammer size={10} className="mr-1 inline" />
          {busy ? 'Preparing…' : 'Release (on-chain)'}
        </button>
      )}

      {plan && !tx && (
        <div className="text-[10px]" style={{ fontFamily: 'var(--np-font-mono)' }} data-testid="onchain-release-plan">
          <p>
            {plan.inputs.length} input{plan.inputs.length === 1 ? '' : 's'} · in {plan.total_in_sats.toLocaleString()} sats ·
            fee {plan.fee_sats.toLocaleString()} · payout {plan.payout_sats.toLocaleString()} sats ({plan.rail})
          </p>
          <p className="mt-1" style={{ color: 'var(--np-muted)' }}>
            The oracle already co-signed each input. Sign the same sighashes with your owner key to assemble the release transaction.
          </p>
          <button
            type="button"
            onClick={() => void finalize()}
            disabled={busy}
            className="mt-2 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] disabled:opacity-50"
            style={{ borderColor: 'var(--np-rule)', background: 'var(--np-ink)', color: 'var(--np-bg)' }}
          >
            {busy ? 'Signing…' : 'Sign & assemble'}
          </button>
        </div>
      )}

      {tx && (
        <div className="text-[10px]" style={{ fontFamily: 'var(--np-font-mono)' }} data-testid="onchain-release-tx">
          <p>
            Release transaction assembled - txid <b>{tx.txid.slice(0, 12)}…</b>
          </p>
          <p className="mt-1 break-all" style={{ color: 'var(--np-muted)' }}>{tx.raw_tx.slice(0, 80)}…</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(tx.raw_tx);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { /* clipboard unavailable */ }
              }}
              className="border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em]"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
            >
              {copied ? <Check size={10} className="mr-1 inline" /> : <Copy size={10} className="mr-1 inline" />}
              {copied ? 'Copied' : 'Copy raw tx'}
            </button>
            {tx.explorer_tx_url && (
              <a href={safeExplorerHref(tx.explorer_tx_url) ?? '#'} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--np-accent-2)' }}>
                explorer
              </a>
            )}
          </div>
          <p className="mt-1" style={{ color: 'var(--np-muted)' }}>
            Broadcast it from your own wallet - the API never broadcasts.
          </p>
          {noted && (
            <p className="mt-1" style={{ color: 'var(--np-success, #1b7f4d)' }} data-testid="release-room-note">
              Noted in the campaign room.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-[10px]" style={{ color: 'var(--np-danger, #b3261e)' }}>{error}</p>}
    </div>
  );
}
