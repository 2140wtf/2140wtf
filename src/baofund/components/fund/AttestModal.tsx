/**
 * AttestModal - milestone delivery + AI verification (MilestoneEvidenceV1).
 *
 * Structured evidence (delivered commit, archive sha256, workflow hash)
 * is submitted to the scoring job (→ signed kind-38060 verdict, read from
 * the relay) and the milestone is then released with the proof event id.
 */
import React, { useEffect, useRef, useState } from 'react';
import { baoRelayUrl, scoreMilestone } from '../../lib/baoFundraising';
import { executeFounderRelease, payoutOutcomeNote } from '../../lib/court/executeCourtSettlement';
import { fetchMilestoneVerdicts, verdictVerifierPubkey, type MilestoneVerdict } from '../../relay/verdictFeed';
import { useAuth } from '../../auth/useAuth';
import '../../theme/newspaperTheme.css';
import { errorMessage } from '../../lib/errors';
import { encodeMilestoneEvidence, type EncodedMilestoneEvidence } from '../../lib/evidence/attestationEvidence';
import { deriveEvidenceMaster, encodePrivateMilestoneEvidence } from '../../lib/evidence/encryptedEvidence';
import { hexToBytes } from '@noble/hashes/utils.js';

export interface AttestCandidate {
  frId: string;
  milestoneId: string;
  label: string;
}

export function AttestModal({
  candidates,
  onDone,
  onClose,
}: {
  candidates: AttestCandidate[];
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [showEvidence, setShowEvidence] = useState(false);

  const [repository, setRepository] = useState('');
  const [delivered, setDelivered] = useState('');
  // A proof event id is a NOSTR EVENT id, never the delivered commit. Mixing
  // them stored a non-existent event id as provenance (or blocked release
  // when the commit was a normal 40-hex git hash).
  const [proofEventId, setProofEventId] = useState('');
  const [base, setBase] = useState('');
  const [archiveUrl, setArchiveUrl] = useState('');
  const [archiveSha, setArchiveSha] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [testCommand, setTestCommand] = useState('');
  const [evidenceEnc, setEvidenceEnc] = useState<EncodedMilestoneEvidence | null>(null);
  /** Private mode: the hosted artifact is ENCRYPTED before Bao encoding.
   * Requires a seed-identity master (NIP-07/passkey signers keep keys in
   * their own custody and cannot derive the artifact master here). */
  const [privateMode, setPrivateMode] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed kind-38060 verdict read from the relay (null until one lands).
  const [relayVerdict, setRelayVerdict] = useState<MilestoneVerdict | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);
  const auth = useAuth();
  const cand = candidates[idx];
  if (!cand) return null;

  const evidencePayload = () => ({
    version: 1 as const,
    contract_hash: workflow || 'pending',
    campaign_id: cand.frId,
    milestone_id: cand.milestoneId,
    repository_coordinate: repository || 'github:org/repo',
    base_commit: base || delivered || 'pending',
    delivered_commit: delivered || 'pending',
    delivered_tree: '',
    artifact_event_ids: [],
    criteria_hash: '',
    archive: { url: archiveUrl || '', sha256: archiveSha || '' },
    test_command: testCommand,
    workflow_hash: workflow,
    toolchain_hash: '',
    ...(evidenceEnc ? evidenceEnc.fields : {}),
  });

  /**
   * Owner-side Bao encoding: the artifact becomes a seekable encoding whose
   * root hash rides in the scored evidence payload (and on the proof event),
   * so attestors can spot-check slices of the hosted file against it.
   * The archive sha256 pins the ENCODING bytes that must be uploaded.
   */
  const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
  const attachArtifact = async (file: File | undefined) => {
    setEvidenceEnc(null);
    if (!file) return;
    try {
      setBusy(true);
      setError(null);
      if (file.size > MAX_ARTIFACT_BYTES) {
        throw new Error(`Evidence artifact exceeds the ${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)} MB in-browser encoding cap.`);
      }
      const raw = new Uint8Array(await file.arrayBuffer());
      let enc: EncodedMilestoneEvidence;
      if (privateMode) {
        if (!auth.signer) throw new Error('Sign in to encrypt a private evidence artifact.');
        const seedHex = auth.seedIdentityHex();
        if (!seedHex) {
          throw new Error('Private evidence needs a seed identity - NIP-07 / passkey / bunker signers keep keys out of app reach, so the artifact cannot be encrypted here (and could never be decrypted later).');
        }
        // The artifact master is DERIVED from the identity key (per the KDF
        // registry). Passing the raw identity key encrypted under a different
        // master than every documented decryptor derives.
        enc = await encodePrivateMilestoneEvidence(deriveEvidenceMaster(hexToBytes(seedHex)), raw);
      } else {
        enc = encodeMilestoneEvidence(raw);
      }
      setEvidenceEnc(enc);
      setArchiveSha(enc.archiveSha256Hex);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Relay-native verdict watch: poll the fund relay for the signed 38060
  // event instead of streaming an API job. No verifier pin → no trusted
  // verdict (the API result remains the only advisory signal then).
  const watchVerdict = async (target: AttestCandidate) => {
    const verifier = verdictVerifierPubkey();
    if (!verifier) return;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (cancelledRef.current) return;
      const verdicts = await fetchMilestoneVerdicts(baoRelayUrl(), { verifierPubkey: verifier });
      if (cancelledRef.current) return;
      const match = verdicts.find(
        (v) =>
          v.fundraiserId === target.frId &&
          (!v.milestoneId || v.milestoneId === target.milestoneId),
      );
      if (match) {
        setRelayVerdict(match);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      if (cancelledRef.current) return;
    }
  };

  const score = async () => {
    setBusy(true);
    setError(null);
    setRelayVerdict(null);
    try {
      if (!auth.signer) throw new Error('Sign in to attest - attestations carry your identity.');
      const res = await scoreMilestone(auth.signer, cand.frId, cand.milestoneId, {
        evidence: evidencePayload(),
        toolBudgetMsats: 50_000,
      });
      onDone(
        `Scoring job #${res.job_id} enqueued (${res.model}, ~${res.estimated_fee_msats / 1000} sats fee) - signed kind-38060 verdict follows on the relay`
      );
      void watchVerdict(cand);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      // proof_event_id means a NOSTR EVENT ID everywhere else in the
      // protocol - free text here fabricated garbage provenance. It is a
      // SEPARATE field from the delivered commit; when absent, omit it.
      const proofId = proofEventId.trim();
      if (proofId && !/^[0-9a-f]{64}$/.test(proofId)) {
        throw new Error('Proof event id must be a Nostr event id (64 hex chars).');
      }
      // TODO(security): gate release on scoreMilestone verdict === 'pass' AND
      // validateMilestoneEvidenceV1 (baoWorkContract) once the evidence
      // payload ships real contract hashes instead of placeholders.
      if (!auth.signer) throw new Error('Sign in first - milestone release is bound to your identity.');
      // Two-phase escrow: the API can answer with an INITIATE (oracle-signed
      // swap awaiting the project signature). Completing it needs the seed
      // identity; an unchecked initiate must never be reported as released.
      const result = await executeFounderRelease({
        signer: auth.signer,
        identityHex: auth.seedIdentityHex(),
        myPubkey: auth.pubkey ?? '',
        frId: cand.frId,
        milestoneId: cand.milestoneId,
        proofEventId: proofId || undefined,
        payoutReference: auth.pubkey ?? undefined,
      });
      if (result.status !== 'executed') {
        setError(result.message);
        return;
      }
      // The payout recovery sentence must reach the founder: a settled
      // release whose payout could not be stored is NOT a silent success.
      const payoutNote = payoutOutcomeNote(result.payout);
      if (result.releasedSats !== undefined) {
        onDone(`Attested & released: ${cand.label.slice(0, 40)} → ${result.milestoneStatus ?? 'released'} · ${result.releasedSats.toLocaleString()} sats released${payoutNote}`);
        return;
      }
      const releasedTitle = result.milestone?.title?.slice(0, 40) ?? cand.milestoneId;
      const releasedStatus = result.milestone?.status ?? 'submitted';
      onDone(`Attested & released: ${releasedTitle} → ${releasedStatus}${payoutNote}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    border: '1px solid var(--np-rule)',
    fontFamily: 'var(--np-font-mono)' as const,
    background: 'transparent',
    color: 'var(--np-ink)',
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'rgba(26,26,26,0.45)' }} onClick={onClose} />
      <form
        onSubmit={(e) => { e.preventDefault(); void score(); }}
        className="relative mx-auto mt-16 w-[min(94vw,34rem)] overflow-y-auto border p-5"
        style={{ background: 'var(--np-paper)', borderColor: 'var(--np-ink)', boxShadow: 'var(--np-shadow)' }}
      >
        <h2 className="mb-3 text-lg font-bold" style={{ fontFamily: 'var(--np-font-serif)', color: 'var(--np-ink)' }}>
          Deliver & attest a milestone
        </h2>
        <label className="mb-3 block">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Milestone</span>
          <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setEvidenceEnc(null); }}
            className="mt-1 w-full border px-2 py-1.5 text-sm outline-none" style={{ borderColor: 'var(--np-rule)' }}>
            {candidates.map((c, i) => (
              <option key={c.milestoneId} value={i}>{c.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setShowEvidence((v) => !v)}
          className="mb-2 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
        >
          {showEvidence ? '▾ Hide delivery evidence' : '▸ Delivery evidence (MilestoneEvidenceV1)'}
        </button>
        {showEvidence && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <input placeholder="repository (github:org/repo)" value={repository} onChange={(e) => setRepository(e.target.value)} className="col-span-2 border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="delivered commit" value={delivered} onChange={(e) => setDelivered(e.target.value)} className="col-span-2 border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="proof event id (64 hex, optional)" value={proofEventId} onChange={(e) => setProofEventId(e.target.value)} className="col-span-2 border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="base commit" value={base} onChange={(e) => setBase(e.target.value)} className="border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="workflow hash" value={workflow} onChange={(e) => setWorkflow(e.target.value)} className="border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="archive url" value={archiveUrl} onChange={(e) => setArchiveUrl(e.target.value)} className="border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="archive sha256" value={archiveSha} onChange={(e) => setArchiveSha(e.target.value)} className="border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <input placeholder="test command" value={testCommand} onChange={(e) => setTestCommand(e.target.value)} className="col-span-2 border px-2 py-1 text-xs outline-none" style={inputStyle} />
            <label className="col-span-2 flex items-center gap-2 text-[10px]" style={{ color: 'var(--np-muted)' }}>
              <input type="checkbox" checked={privateMode} onChange={(e) => { setPrivateMode(e.target.checked); setEvidenceEnc(null); setArchiveSha(''); }} />
              <span className="uppercase tracking-widest">Private (encrypt before Bao)</span>
              <input type="file" onChange={(e) => void attachArtifact(e.target.files?.[0])} className="text-xs" />
            </label>
            {evidenceEnc && (
              <p className="col-span-2 text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                {privateMode ? 'Private · ' : ''}Bao root {evidenceEnc.rootHashHex.slice(0, 16)}…{evidenceEnc.rootHashHex.slice(-8)} · {evidenceEnc.contentLength.toLocaleString()} bytes - upload the encoded file at the archive URL; attestors spot-check slices against this root{privateMode ? ' without any key' : ''}.
              </p>
            )}
          </div>
        )}

        {error && <p className="mb-3 text-xs" style={{ color: 'var(--np-danger)' }}>{error}</p>}
        {relayVerdict && (
          <p className="mb-3 text-[11px]" style={{ color: relayVerdict.verdict === 'pass' ? 'var(--np-success)' : 'var(--np-danger)', fontFamily: 'var(--np-font-mono)' }}>
            Relay verdict: {relayVerdict.verdict ?? 'unknown'}
            {relayVerdict.score !== null ? ` · score ${relayVerdict.score}` : ''}
            {relayVerdict.model ? ` · ${relayVerdict.model}` : ''}
            {relayVerdict.evidenceHash ? ` · evidence ${relayVerdict.evidenceHash.slice(0, 20)}…` : ''}
            {' '}(signed kind-38060, verifier-pinned)
          </p>
        )}
        <p className="mb-3 text-[11px]" style={{ color: 'var(--np-muted)' }}>
          Scoring enqueues the AI judge (advisory, signed kind-38060 read from the relay). Releasing marks delivery and opens the attestation resolution.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-[11px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
            Cancel
          </button>
          <button type="button" onClick={() => void release()} disabled={busy}
            className="px-4 py-1.5 text-[11px] uppercase tracking-widest"
            style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-ink)', border: '1px solid var(--np-ink)', background: 'transparent' }}>
            Attest & release
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest"
            style={{ fontFamily: 'var(--np-font-mono)', color: 'var(--np-on-accent)', background: 'var(--np-accent)', border: '1px solid var(--np-accent)' }}>
            {busy ? 'Working…' : 'Score evidence'}
          </button>
        </div>
      </form>
    </div>
  );
}
