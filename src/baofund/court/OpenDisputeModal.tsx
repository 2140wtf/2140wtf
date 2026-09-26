/**
 * OpenDisputeModal - S1 (COURT-GUI-WIRING-DESIGN.md §2).
 *
 * Preconditions run through the PURE gate (canOpenDispute) before any publish:
 * one live dispute per escrow; refund-race refusal with ROLE-SPECIFIC copy
 * (round-3). Evidence stays local (round-2): files are hashed with SHA-256 and
 * ONLY the hashes enter the public kind-38025 event; nothing uploads. Publish
 * goes through the caller-provided signer + relay sender - this modal never
 * touches key material and never talks to an API.
 */
import React, { useMemo, useRef, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { buildDisputeEvent } from '@/baofund/court-core';
import { escrowMarketId } from '../lib/court/escrowCourt';
import { canOpenDispute, refundRaceCopy, type FoldedDispute } from '../lib/court/disputeStatus';

export interface OpenDisputeModalProps {
  escrowId: string;
  /** Both escrow parties (the signer must be one of them). */
  partyAPubkey: string;
  partyBPubkey: string;
  /** The escrow's anchor event id (goes into the `['e', …, 'root']` tag). */
  marketEventId: string;
  /** Viewing user's pubkey (hex); determines role copy. */
  myPubkey: string;
  /** Whether the user is the donor (pledge side) or founder (claim side). */
  myRole: 'donor' | 'founder';
  /** Refund-locktime budget bookkeeping: seconds elapsed since escrow lock. */
  secondsSinceEscrowLock: number;
  /** An already-live dispute blocks opening (fetched by the caller). */
  existingDispute: FoldedDispute | null;
  /** Auth signer (NIP-07 / seed / NIP-46 via useAuth). */
  signEvent: (t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<{ id: string; pubkey: string; sig: string }>;
  /** Relay sender (fire-and-forget; the hook resubscribes for confirmation). */
  sendEvent: (e: { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }) => void;
  onPublished: (disputeId: string) => void;
  onClose: () => void;
}

const MAX_EVIDENCE_FILES = 64;

export function OpenDisputeModal(props: OpenDisputeModalProps) {
  const {
    escrowId, partyAPubkey, partyBPubkey, marketEventId, myPubkey, myRole,
    secondsSinceEscrowLock, existingDispute, signEvent, sendEvent, onPublished, onClose,
  } = props;
  const [proposedWinner, setProposedWinner] = useState<string>('');
  const [evidenceHashes, setEvidenceHashes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const gate = useMemo(
    () => canOpenDispute({ elapsedSeconds: secondsSinceEscrowLock, existingDispute }),
    [secondsSinceEscrowLock, existingDispute],
  );

  // Round-2 evidence privacy: hash locally; only hashes are published.
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const hashes: string[] = [];
      for (const f of Array.from(files).slice(0, MAX_EVIDENCE_FILES)) {
        const buf = await f.arrayBuffer();
        hashes.push(bytesToHex(sha256(new Uint8Array(buf))));
      }
      setEvidenceHashes((prev) => [...prev, ...hashes].slice(0, MAX_EVIDENCE_FILES));
    } catch (err) {
      setError(`Could not hash evidence: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  const publish = async () => {
    if (gate.ok === false || !proposedWinner) return;
    setBusy(true);
    setError(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      // The dispute id is assigned by the builder as a random 32-byte hex;
      // the EVENT id (which the fold freezes as disputeId) comes from signing.
      const template = buildDisputeEvent({
        marketId: escrowMarketId(escrowId),
        marketEventId,
        disputeId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
        originalOutcome: myRole === 'donor' ? partyBPubkey : partyAPubkey,
        proposedOutcome: proposedWinner,
        challengerPubkey: myPubkey,
        evidenceHashes,
        disputeDeadline: now + 20 * 3600,
        publisherPubkey: myPubkey,
      });
      const signed = await signEvent(template);
      sendEvent(signed as never);
      onPublished(signed.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  };

  if (gate.ok === false) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal dispute-modal" onClick={(e) => e.stopPropagation()}>
          <h3>Cannot open a dispute</h3>
          {gate.code === 'dispute_already_open' ? (
            <p>A dispute is already open for this escrow - one live dispute per escrow.</p>
          ) : (
            <p role="alert">⏱ A court verdict can no longer arrive before the refund locktime. {refundRaceCopy(myRole)}</p>
          )}
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dispute-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Open a court dispute</h3>
        <p className="dispute-modal-sub">
          A stake-backed jury (FROST) will decide who wins this escrow. The dispute is a public
          evidence event; your evidence files stay on your device - only their SHA-256 hashes are published.
        </p>

        <label>Proposed winner</label>
        <div className="dispute-winner-row">
          <label className={proposedWinner === partyAPubkey ? 'sel' : ''}>
            <input type="radio" name="winner" checked={proposedWinner === partyAPubkey} onChange={() => setProposedWinner(partyAPubkey)} />
            <code>{partyAPubkey.slice(0, 12)}…</code>
          </label>
          <label className={proposedWinner === partyBPubkey ? 'sel' : ''}>
            <input type="radio" name="winner" checked={proposedWinner === partyBPubkey} onChange={() => setProposedWinner(partyBPubkey)} />
            <code>{partyBPubkey.slice(0, 12)}…</code>
          </label>
        </div>

        <label>Evidence (files stay local; hashes only)</label>
        <input ref={fileInput} type="file" multiple onChange={(e) => void onFiles(e.target.files)} />
        {evidenceHashes.length > 0 && (
          <ul className="dispute-evidence-list">
            {evidenceHashes.map((h) => (
              <li key={h}><code>{h.slice(0, 16)}…</code></li>
            ))}
          </ul>
        )}

        <label>Note (optional, published)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={280} placeholder="What went wrong?" />

        {error && <div className="dispute-modal-error" role="alert">{error}</div>}

        <div className="dispute-modal-actions">
          <button type="button" disabled={busy || !proposedWinner} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish dispute'}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
