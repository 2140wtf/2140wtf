/**
 * CourtPanel - S4 (juror candidacy) + S5 (court inbox) GUI
 * (COURT-GUI-WIRING-DESIGN.md §2 S4/S5).
 *
 * Placement (S4 round-3 review): a SECONDARY nav item, not a top-level tab -
 * court activity is contextual for donors and episodic for jurors. The panel
 * contains:
 *   - the first-run explainer (what bonds are for + the slashing table, from
 *     vendor/frost-court/escrow.ts ALPHA_* constants - never hand-copied);
 *   - open disputes with a per-dispute candidacy action (kind 39001 via the
 *     vendor builder; bond preview = calculateBondAmount(marketVolume, round));
 *   - my candidacies (verified fold of my own 39001 events + NIP-09 retract);
 *   - the court inbox (S5): kind-1059 gift wraps addressed to me, ingested
 *     into the engine's createCourtInbox and drained with the app's NIP-60
 *     signer (seed/passkey/NIP-07-with-nip44). Signer-less methods see the
 *     wraps as "locked" - an honest degradation, never a fake decrypt.
 *
 * Publishing/decrypting never touches key material here: everything goes
 * through the caller-provided signer (same rule as OpenDisputeModal).
 */
import React from 'react';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import {
  BAO_COURT_JUROR_CANDIDACY_KIND,
  BAO_COURT_VOTE_COMMIT_KIND,
  BAO_COURT_VOTE_REVEAL_KIND,
  BAO_COURT_SELECTION_KIND,
  buildJurorCandidacyEvent,
  parseJurorCandidacyEvent,
} from '@/baofund/court-core/events.js';
import {
  calculateBondAmount,
  ALPHA_INCOHERENT,
  ALPHA_NON_REVEAL,
  ALPHA_DOUBLE_VOTE,
} from '@/baofund/court-core/escrow.js';
import { createCourtInbox, COURT_GIFT_WRAP_KIND } from '@/baofund/court-core/courtInbox.js';
import type { CourtEventSigner } from '@/baofund/court-core/courtSigner.js';
import type { Nip60Signer } from '../wallet/nip60/identity.js';
import {
  foldVotes,
  revealWindow,
  commitTemplate,
  revealTemplate,
  type VoteView,
  type CourtEvent,
} from '../lib/court/jurorVote.js';
import { parseSelectionEvent } from '@/baofund/court-core/events.js';
import {
  appealWindowCopy,
  disputeLabel,
  disputeTransitionCopy,
  isTestDispute,
  type CampaignNameSource,
} from '../lib/court/disputeCopy';
import { TESTNET4_FAUCET_URL, TESTNET4_EXPLORER_BASE } from '../lib/testnet4Rail';
import './court.css';

const COURT_KIND_DISPUTE = 38025;

/** Module-level clock: keeps Date.now out of component scope (react-hooks
 *  purity lint) - handlers call this at event time, never render time. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface CourtPanelProps {
  /** Viewing user's pubkey (lowercase hex); null when signed out. */
  myPubkey: string | null;
  /** Full NIP-60 signer (needed for inbox drain + event signing). Null for
   *  NIP-07-without-nip44 / guest - the panel degrades honestly. */
  nip60Signer: Nip60Signer | null;
  /** Fallback event signer for candidacy publish when no NIP-60 signer.
   *  Returns the FULL signed event (id/pubkey/sig + kind/created_at/tags/content). */
  signEvent: ((t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<{ id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }>) | null;
  /** The fund's public relay (candidacies + disputes are PUBLIC court data). */
  relayUrl: string;
  /** Feed cards: escrow ref → campaign title, so disputes read as names. */
  campaigns?: ReadonlyArray<CampaignNameSource>;
}

interface DisputeRow {
  eventId: string;
  escrowId: string;
  milestone: string;
  /** Protocol verbs from the dispute event (`refund` / `released`). */
  original: string | null;
  proposed: string | null;
  /** Appeal-window deadline (unix seconds) from the event's `deadline` tag. */
  deadline: number | null;
  publisher: string;
  createdAt: number;
}

interface CandidacyRow {
  eventId: string;
  disputeId: string;
  bondAmountSats: number;
  createdAt: number;
}

interface InboxRow {
  wrapId: string;
  firstSeen: number;
  relays: readonly string[];
}

/** Event → viewer-rumor shape check for dispute rows (round-1 rule: the
 *  dispute fold's parse already verifies signatures in disputeStatus.ts). */
function toRow(e: { id: string; pubkey: string; created_at: number; tags: string[][] }): DisputeRow | null {
  const escrow = e.tags.find((t) => t[0] === 'market')?.[1]
    ?? e.tags.find((t) => t[0] === 'escrow')?.[1];
  if (!escrow) return null;
  const milestone = e.tags.find((t) => t[0] === 'milestone')?.[1] ?? escrow;
  const original = e.tags.find((t) => t[0] === 'original')?.[1] ?? null;
  const proposed = e.tags.find((t) => t[0] === 'proposed')?.[1] ?? null;
  const rawDeadline = Number(e.tags.find((t) => t[0] === 'deadline')?.[1] ?? 0);
  return {
    eventId: e.id,
    escrowId: escrow,
    milestone,
    original,
    proposed,
    deadline: Number.isSafeInteger(rawDeadline) && rawDeadline > 0 ? rawDeadline : null,
    publisher: e.pubkey,
    createdAt: e.created_at,
  };
}

export function CourtPanel(props: CourtPanelProps): React.ReactElement {
  const { myPubkey, nip60Signer, signEvent, relayUrl, campaigns = [] } = props;
  const [disputes, setDisputes] = React.useState<Map<string, DisputeRow>>(new Map());
  const [candidacies, setCandidacies] = React.useState<Map<string, CandidacyRow>>(new Map());
  const [inbox, setInbox] = React.useState<InboxRow[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [round, setRound] = React.useState(1);
  const [marketVolume, setMarketVolume] = React.useState(200_000);
  // ── S6 state: vote events per dispute + the selected dispute + vote draft ──
  const [voteEvents, setVoteEvents] = React.useState<Map<string, CourtEvent[]>>(new Map());
  const [voteDisputeId, setVoteDisputeId] = React.useState<string | null>(null);
  const [voteOutcome, setVoteOutcome] = React.useState<'challenger' | 'respondent'>('challenger');
  // Per-dispute juror roster (pubkey → idx) and threshold. A global
  // threshold/idx was wrong: any selection event changed every dispute, and
  // the roster index was never read, so a first-time juror could never vote.
  const [selectionByIdx, setSelectionByIdx] = React.useState<Map<string, Map<string, number>>>(new Map());
  const [thresholds, setThresholds] = React.useState<Map<string, number>>(new Map());
  // My local commit store: salt AND the committed outcome. Losing either
  // forfeits the bond (α=1.0 non-reveal / hash mismatch); a legacy bare-salt
  // record is migrated structurally (outcome null → live select fallback).
  const saltKey = (disputeId: string) => `bao.court.salt.${disputeId}`;
  const saveCommit = (disputeId: string, commit: { salt: string; outcome: 'challenger' | 'respondent' }) => {
    try { window.localStorage.setItem(saltKey(disputeId), JSON.stringify({ v: 1, ...commit })); } catch { /* private mode */ }
  };
  const loadCommit = (disputeId: string): { salt: string; outcome: 'challenger' | 'respondent' | null } | null => {
    try {
      const raw = window.localStorage.getItem(saltKey(disputeId));
      if (!raw) return null;
      if (/^[0-9a-f]{64}$/.test(raw)) return { salt: raw, outcome: null };
      const parsed = JSON.parse(raw) as { salt?: unknown; outcome?: unknown };
      if (typeof parsed?.salt !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.salt)) return null;
      const outcome = parsed.outcome === 'challenger' || parsed.outcome === 'respondent' ? parsed.outcome : null;
      return { salt: parsed.salt, outcome };
    } catch {
      return null;
    }
  };
  const [explainerSeen, setExplainerSeen] = React.useState(() => {
    try { return window.localStorage.getItem('bao.court.explainer') === '1'; } catch { return false; }
  });
  // Human-readable rows: a slow clock for the appeal-window countdown, and the
  // testing-phase filter (e2e/probe disputes are hidden unless toggled on).
  const [now, setNow] = React.useState(() => nowSeconds());
  React.useEffect(() => {
    const iv = setInterval(() => setNow(nowSeconds()), 30_000);
    return () => clearInterval(iv);
  }, []);
  const [showTests, setShowTests] = React.useState(() => {
    try { return window.localStorage.getItem('bao.court.showTests') === '1'; } catch { return false; }
  });
  const toggleShowTests = () => setShowTests((v) => {
    const next = !v;
    try { window.localStorage.setItem('bao.court.showTests', next ? '1' : '0'); } catch { /* private mode */ }
    return next;
  });
  const disputeRows = React.useMemo(
    () => [...disputes.values()].sort((a, b) => b.createdAt - a.createdAt),
    [disputes],
  );
  const visibleDisputes = React.useMemo(
    () => (showTests ? disputeRows : disputeRows.filter((d) => !isTestDispute(d.escrowId))),
    [disputeRows, showTests],
  );
  const hiddenTestCount = disputeRows.length - visibleDisputes.length;
  const labelFor = React.useCallback(
    (d: DisputeRow) => disputeLabel(d.escrowId, campaigns),
    [campaigns],
  );
  const inboxRef = React.useRef<ReturnType<typeof createCourtInbox> | null>(null);
  React.useEffect(() => {
    if (!myPubkey) { inboxRef.current = null; return; }
    try { inboxRef.current = createCourtInbox({ myPubkey }); } catch { inboxRef.current = null; }
    return () => { inboxRef.current = null; };
  }, [myPubkey]);

  const previewBond = React.useMemo(() => {
    try { return calculateBondAmount(marketVolume, round); } catch { return null; }
  }, [marketVolume, round]);

  // ── Relay subscribe: disputes (public), my candidacies, my gift wraps ──
  React.useEffect(() => {
    if (!relayUrl) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const filters: unknown[] = [
      { kinds: [COURT_KIND_DISPUTE], limit: 50 },
    ];
    if (myPubkey) {
      filters.push({ kinds: [BAO_COURT_JUROR_CANDIDACY_KIND], authors: [myPubkey], limit: 50 });
      filters.push({ kinds: [COURT_GIFT_WRAP_KIND], '#p': [myPubkey], limit: 50 });
    }
    // S6: the vendor dispute id (39025 id) drives the vote query; all public.
    filters.push({ kinds: [BAO_COURT_VOTE_COMMIT_KIND, BAO_COURT_VOTE_REVEAL_KIND], limit: 200 });
    filters.push({ kinds: [BAO_COURT_SELECTION_KIND], limit: 50 });
    const open = () => {
      if (closed) return;
      try { ws = new WebSocket(relayUrl); } catch { schedule(); return; }
      ws.onopen = () => {
        attempt = 0;
        try { ws?.send(JSON.stringify(['REQ', 'court-s4', ...filters])); } catch { /* retry via onclose */ }
      };
      ws.onmessage = (m) => {
        let msg: unknown;
        try { msg = JSON.parse(String(m.data)); } catch { return; }
        if (!Array.isArray(msg) || msg[0] !== 'EVENT') return;
        const ev = msg[2] as { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string } | undefined;
        // Raw WebSocket ingress: verify the signature before folding. A
        // hostile relay could otherwise inject forged disputes/selections
        // that the panel rendered with campaign names and thresholds.
        if (!ev || !verifyEvent(ev as never)) return;
        if (ev.kind === COURT_KIND_DISPUTE) {
          const row = toRow(ev);
          if (row) setDisputes((p) => new Map(p).set(ev.id, row));
        } else if (ev.kind === BAO_COURT_VOTE_COMMIT_KIND || ev.kind === BAO_COURT_VOTE_REVEAL_KIND) {
          const d = ev.tags.find((t) => t[0] === 'dispute')?.[1] ?? '';
          if (d) setVoteEvents((p) => { const n = new Map(p); n.set(d, [...(n.get(d) ?? []), ev as CourtEvent]); return n; });
        } else if (ev.kind === BAO_COURT_SELECTION_KIND) {
          const sel = parseSelectionEvent(ev as never);
          if (sel) {
            const idxByPubkey = new Map(sel.selected.map((j) => [j.pubkey.toLowerCase(), j.idx]));
            setSelectionByIdx((p) => new Map(p).set(sel.disputeId, idxByPubkey));
            setThresholds((p) => new Map(p).set(sel.disputeId, sel.selected.length));
          }
        } else if (myPubkey && ev.kind === BAO_COURT_JUROR_CANDIDACY_KIND && ev.pubkey === myPubkey) {
          const prof = parseJurorCandidacyEvent(ev);
          if (prof) {
            const dispute = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
            const bond = Number(ev.tags.find((t) => t[0] === 'bond')?.[1] ?? 0);
            setCandidacies((p) => new Map(p).set(ev.id, { eventId: ev.id, disputeId: dispute, bondAmountSats: bond, createdAt: ev.created_at }));
          }
        } else if (myPubkey && ev.kind === COURT_GIFT_WRAP_KIND) {
          const relayHost = (() => { try { return new URL(relayUrl).host; } catch { return relayUrl; } })();
          try {
            inboxRef.current?.ingest(ev, relayHost, Math.floor(Date.now() / 1000));
          } catch { /* malformed wrap - never rendered */ }
          setInbox((prev) => {
            if (prev.some((r) => r.wrapId === ev.id)) return prev;
            return [...prev, {
              wrapId: ev.id,
              firstSeen: ev.created_at,
              relays: [relayHost],
            }].slice(-50);
          });
        }
      };
      ws.onclose = () => { if (!closed) schedule(); };
    };
    const schedule = () => {
      attempt = Math.min(attempt + 1, 6);
      retry = setTimeout(open, Math.min(30_000, 500 * 2 ** attempt));
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      try { ws?.send(JSON.stringify(['CLOSE', 'court-s4'])); } catch { /* already closed */ }
      ws?.close();
    };
  }, [relayUrl, myPubkey]);

  // ── Candidacy publish (kind 39001) ──
  const joinCandidacy = async (d: DisputeRow) => {
    if (!myPubkey || !signEvent) { setError('signing unavailable for this login method'); return; }
    if (!previewBond) { setError('invalid bond parameters'); return; }
    setError(null);
    try {
      const template = buildJurorCandidacyEvent({
        disputeId: d.eventId,
        marketId: d.escrowId,
        juror: {
          nostrPubkey: myPubkey,
          stakeCapacitySats: previewBond,
          stakeCommitment: { amountSats: previewBond, bondAddress: 'pending', status: 'pending' },
          wotScore: 50,
          categories: ['markets'],
          registeredAt: nowSeconds(),
        },
        bondAmountSats: previewBond,
        bondAddress: 'pending',
      });
      const signed = await signEvent(template);
      const ok = await sendToRelay(relayUrl, signed);
      setStatus(ok ? `You joined the jury pool for ${disputeLabel(d.escrowId, campaigns)} - bond preview ${previewBond.toLocaleString()} sats (the bond UTXO is verified before selection).` : 'Relay did not accept the candidacy in time - try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    }
  };

  // ── NIP-09 retract of my candidacy ──
  const retractCandidacy = async (row: CandidacyRow) => {
    if (!myPubkey || !signEvent) return;
    try {
      const del = { kind: 5, created_at: nowSeconds(), tags: [['e', row.eventId]], content: 'retract juror candidacy' };
      const signed = await signEvent(del);
      await sendToRelay(relayUrl, signed);
      setCandidacies((p) => { const n = new Map(p); n.delete(row.eventId); return n; });
      setStatus('Candidacy retracted (NIP-09 deletion request published).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'retract failed');
    }
  };

  // ── Inbox drain (S5): NIP-59 unwrap via the engine, signer-adapted ──
  const drainInbox = async () => {
    const ib = inboxRef.current;
    if (!ib || !nip60Signer) return;
    const courtSigner: CourtEventSigner = {
      getPublicKey: () => nip60Signer.pubkey,
      signEvent: (t) => nip60Signer.signEvent(t) as Promise<never> as Promise<Parameters<NonNullable<typeof nip60Signer.signEvent>>[0] extends never ? never : { id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>,
      nip44Encrypt: (pk, pt) => nip60Signer.nip44Encrypt(pk, pt) as Promise<string>,
      nip44Decrypt: (pk, ct) => nip60Signer.nip44Decrypt(pk, ct) as Promise<string>,
    };
    try {
      const msgs = await ib.drain(courtSigner);
      setStatus(msgs.length ? `Inbox drained: ${msgs.length} verified court message(s).` : 'Inbox drained - no new verified court messages.');
    } catch (err) {
      setError(`inbox drain failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  const ackWrap = (wrapId: string) => {
    setInbox((prev) => prev.filter((r) => r.wrapId !== wrapId));
  };

  return (
    <div className="court-panel" data-testid="court-panel">
      <h2 className="dispute-status-head">⚖ ₿AO Court</h2>
      {!explainerSeen && (
        <div className="dispute-status-card" data-testid="court-explainer">
          <strong>How BAO Court works - in plain terms.</strong>
          <ol style={{ margin: '0.5rem 0 0.5rem 1.1rem', padding: 0, lineHeight: 1.55 }}>
            <li>
              <strong>Post a bond.</strong> To be a juror you lock a small amount
              of testnet sats (5% of the dispute size, minimum 10k).
            </li>
            <li>
              <strong>Get selected.</strong> The court picks jurors at random.
              You only act when a summons arrives in your inbox.
            </li>
            <li>
              <strong>Vote once.</strong> Reveal one vote for the party you
              believe is right. Honest jurors get the bond back plus a share of
              the fee; voting twice or never revealing forfeits it
              (double-vote {Math.round(ALPHA_DOUBLE_VOTE * 100)}%, no-reveal{' '}
              {Math.round(ALPHA_NON_REVEAL * 100)}%, incoherent vote{' '}
              {Math.round((1 - ALPHA_INCOHERENT) * 100)}%).
            </li>
          </ol>
          <div style={{ fontSize: '0.85em', lineHeight: 1.5, color: 'var(--np-muted)' }}>
            Need testnet coins for a bond? Bitcoin testnet4:{' '}
            <a className="underline" style={{ color: 'var(--np-accent-2)' }} href={TESTNET4_FAUCET_URL} target="_blank" rel="noreferrer">coinfaucet.eu/en/btc-testnet4</a>{' '}
            - verify on{' '}
            <a className="underline" style={{ color: 'var(--np-accent-2)' }} href={TESTNET4_EXPLORER_BASE} target="_blank" rel="noreferrer">mempool.space/testnet4</a>.
            Liquid testnet:{' '}
            <a className="underline" style={{ color: 'var(--np-accent-2)' }} href="https://liquidtestnet.com/faucet" target="_blank" rel="noreferrer">liquidtestnet.com/faucet</a>.
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" className="dispute-btn" onClick={() => {
              setExplainerSeen(true);
              try { window.localStorage.setItem('bao.court.explainer', '1'); } catch { /* private mode */ }
            }}>Got it - show candidacy</button>
          </div>
        </div>
      )}

      {explainerSeen && (
        <div className="dispute-status-card">
          <div className="dispute-status-head"><strong>Juror candidacy</strong></div>
          <div className="dispute-status-phase">
            <label style={{ marginRight: '0.75rem' }}>
              Dispute size (sats){' '}
              <input type="number" min={0} step={10_000} value={marketVolume}
                onChange={(e) => setMarketVolume(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: '9rem' }} />
            </label>
            <label>
              Appeal round{' '}
              <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
                {[1, 2, 3].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div style={{ marginTop: '0.4rem' }} data-testid="bond-preview">
              {previewBond === null
                ? <span style={{ color: 'var(--np-accent)' }}>invalid bond parameters</span>
                : <>Bond required: <strong>{previewBond.toLocaleString('en-US')} sats</strong> (5% of volume, ×2^{round - 1}, floor 10k)</>}
            </div>
          </div>
        </div>
      )}

      <div className="dispute-status-card">
        <div className="dispute-status-head">
          <strong>Open disputes</strong>
          <label
            className="text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)', cursor: 'pointer' }}
            title="e2e and probe disputes are hidden during the testing phase"
          >
            <input type="checkbox" checked={showTests} onChange={toggleShowTests} style={{ marginRight: '0.35rem' }} />
            show test disputes
          </label>
        </div>
        {visibleDisputes.length === 0 && <div className="dispute-status-phase">No live disputes on the relay.</div>}
        {hiddenTestCount > 0 && (
          <div className="dispute-status-phase" style={{ color: 'var(--np-muted)' }}>
            {hiddenTestCount} test dispute{hiddenTestCount === 1 ? '' : 's'} hidden during the testing phase.
          </div>
        )}
        {visibleDisputes.map((d) => {
          const transition = disputeTransitionCopy(d.original, d.proposed);
          const windowCopy = appealWindowCopy(d.deadline, now);
          return (
            <div key={d.eventId} className="dispute-status-phase" data-testid={`dispute-row-${d.eventId.slice(0, 8)}`}>
              <div><strong>{labelFor(d)}</strong></div>
              {(transition || windowCopy) && (
                <div style={{ color: 'var(--np-muted)' }}>
                  {transition}{transition && windowCopy ? ' · ' : ''}{windowCopy}
                </div>
              )}
              <div style={{ marginTop: '0.3rem' }}>
                <button type="button" className="dispute-btn" disabled={!signEvent || !previewBond}
                  title={`Dispute ${d.eventId.slice(0, 12)}…`}
                  onClick={() => void joinCandidacy(d)}>
                  Join the jury - {(previewBond ?? 0).toLocaleString('en-US')} sats bond
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {myPubkey && (
        <div className="dispute-status-card">
          <div className="dispute-status-head"><strong>My candidacies</strong></div>
          {candidacies.size === 0 && <div className="dispute-status-phase">None yet.</div>}
          {[...candidacies.values()]
            .filter((c) => showTests || !isTestDispute(disputes.get(c.disputeId)?.escrowId))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((c) => {
              const d = disputes.get(c.disputeId);
              return (
                <div key={c.eventId} className="dispute-status-phase" data-testid={`candidacy-row-${c.eventId.slice(0, 8)}`}>
                  You are a candidate for <strong>{d ? labelFor(d) : 'a closed dispute'}</strong> · bond {c.bondAmountSats.toLocaleString('en-US')} sats
                  {' '}
                  <button type="button" className="dispute-btn dispute-btn-danger" disabled={!signEvent}
                    onClick={() => void retractCandidacy(c)}>Retract</button>
                </div>
              );
            })}
        </div>
      )}

      <div className="dispute-status-card">
        <div className="dispute-status-head"><strong>Juror voting</strong></div>
        {visibleDisputes.length === 0 && <div className="dispute-status-phase">No disputes to vote on.</div>}
        {visibleDisputes.map((d) => (
          <VoteSection
            key={d.eventId}
            dispute={d}
            label={labelFor(d)}
            events={voteEvents.get(d.eventId) ?? []}
            selected={voteDisputeId === d.eventId}
            onSelect={() => setVoteDisputeId(voteDisputeId === d.eventId ? null : d.eventId)}
            threshold={thresholds.get(d.eventId) ?? 2}
            roster={selectionByIdx.get(d.eventId) ?? null}
            jurorIdx={
              myPubkey
                ? selectionByIdx.get(d.eventId)?.get(myPubkey.toLowerCase())
                  ?? selectionByIdx.get(d.escrowId)?.get(myPubkey.toLowerCase())
                  ?? null
                : null
            }
            myPubkey={myPubkey}
            signEvent={signEvent}
            relayUrl={relayUrl}
            onStatus={setStatus}
            onError={setError}
            loadCommit={loadCommit}
            saveCommit={saveCommit}
            voteOutcome={voteOutcome}
            setVoteOutcome={setVoteOutcome}
          />
        ))}
      </div>

      <div className="dispute-status-card">
        <div className="dispute-status-head"><strong>Court inbox</strong>
          {nip60Signer
            ? <button type="button" className="dispute-btn" onClick={() => void drainInbox()} data-testid="court-inbox-drain">Unwrap</button>
            : <span title="Gift wraps are NIP-44 encrypted; this login method holds no NIP-44 keys">🔒 locked for this login method</span>}
        </div>
        {inbox.length === 0 && <div className="dispute-status-phase">No court summons or ceremony messages.</div>}
        {inbox.map((r) => (
          <div key={r.wrapId} className="dispute-status-phase" data-testid={`inbox-row-${r.wrapId.slice(0, 8)}`}>
            Court message · {new Date(r.firstSeen * 1000).toLocaleString()} · via {r.relays.join(', ')}
            <button type="button" className="dispute-btn" onClick={() => ackWrap(r.wrapId)}>Ack</button>
          </div>
        ))}
      </div>

      {status && <div className="dispute-status-phase" role="status">{status}</div>}
      {error && <div className="dispute-status-phase" style={{ color: 'var(--np-accent)' }} role="alert">{error}</div>}
    </div>
  );
}

/**
 * VoteSection - the S6 per-dispute voting flow (COURT-GUI-WIRING-DESIGN.md
 * §2 S6): evidence summary, outcome choice, commit (salt generated + stored
 * locally), reveal (after the commit phase ends), and the vendor tally.
 */
function VoteSection(props: {
  dispute: DisputeRow;
  /** Human label for the dispute ("<campaign> - milestone N"). */
  label: string;
  events: CourtEvent[];
  selected: boolean;
  onSelect: () => void;
  threshold: number;
  /** Signed selection roster (lowercase pubkey → idx); null before selection. */
  roster: ReadonlyMap<string, number> | null;
  /** Roster index from the signed selection event (authoritative). */
  jurorIdx: number | null;
  myPubkey: string | null;
  signEvent: NonNullable<CourtPanelProps['signEvent']> | null;
  relayUrl: string;
  onStatus: (s: string) => void;
  onError: (s: string) => void;
  loadCommit: (disputeId: string) => { salt: string; outcome: 'challenger' | 'respondent' | null } | null;
  saveCommit: (disputeId: string, commit: { salt: string; outcome: 'challenger' | 'respondent' }) => void;
  voteOutcome: 'challenger' | 'respondent';
  setVoteOutcome: (o: 'challenger' | 'respondent') => void;
}): React.ReactElement {
  const { dispute, label, events, selected, onSelect, threshold, roster, jurorIdx, myPubkey, signEvent, relayUrl, onStatus, onError, loadCommit, saveCommit, voteOutcome, setVoteOutcome } = props;
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => nowSeconds());
  React.useEffect(() => {
    const iv = setInterval(() => setNow(nowSeconds()), 15_000);
    return () => clearInterval(iv);
  }, []);

  // The event's own `deadline` tag when present; the builder's 20h window is
  // only the fallback (older disputes without the tag).
  const deadline = dispute.deadline ?? dispute.createdAt + 20 * 3600;
  // Selection is authoritative; per-event commits are only a fallback for
  // rounds where the roster changed after selection.
  const myIdx = jurorIdx ?? (myPubkey ? myIdxFromEvents(events, myPubkey) : null);
  const view: VoteView = React.useMemo(
    () => foldVotes(dispute.eventId, events, { threshold, deadlineSeconds: deadline, now, ...(roster ? { roster } : {}) }),
    [dispute.eventId, events, threshold, deadline, now, roster],
  );
  const window = revealWindow(deadline, now);
  const myStored = loadCommit(dispute.eventId);
  const mySalt = myStored?.salt ?? null;
  const myRow = view.rows.find((r) => r.pubkey === myPubkey) ?? null;
  const hasMyCommit = Boolean(myRow?.commit);
  const hasMyReveal = Boolean(myRow?.reveal);

  const doCommit = async () => {
    if (!myPubkey || !signEvent || myIdx === null) { onError('commit needs a signer and a selection (juror idx)'); return; }
    if (window.open) { onError('commit phase is over - only reveal remains'); return; }
    setBusy(true);
    onError('');
    try {
      // Fresh 32-byte salt + the committed OUTCOME, stored BEFORE anything is
      // published - without the outcome a reload would reveal the default
      // selection and forfeit the bond (hash mismatch).
      const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      saveCommit(dispute.eventId, { salt, outcome: voteOutcome });
      const t = commitTemplate({ disputeId: dispute.eventId, jurorIdx: myIdx, outcome: voteOutcome, salt, publisherPubkey: myPubkey, nowSeconds: nowSeconds() });
      const signed = await signEvent(t);
      const ok = await sendToRelay(relayUrl, signed);
      onStatus(ok ? 'Vote committed - the salt is stored locally; reveal after the commit phase.' : 'Relay did not accept the commit in time - try again.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'commit failed');
    } finally {
      setBusy(false);
    }
  };

  const doReveal = async () => {
    if (!myPubkey || !signEvent || myIdx === null) { onError('reveal needs a signer and a selection (juror idx)'); return; }
    if (!mySalt) { onError('no stored salt for this dispute - the commit cannot be revealed (non-reveal forfeiture applies)'); return; }
    if (!window.open) { onError('reveal window not open yet - the commit phase is still running'); return; }
    setBusy(true);
    onError('');
    try {
      // Reveal the STORED outcome (legacy bare-salt records fall back to the
      // live select, with the mismatch risk called out by the UI).
      const revealOutcome = myStored?.outcome ?? voteOutcome;
      const t = revealTemplate({ disputeId: dispute.eventId, jurorIdx: myIdx, outcome: revealOutcome, salt: mySalt, publisherPubkey: myPubkey, nowSeconds: nowSeconds() });
      const signed = await signEvent(t);
      const ok = await sendToRelay(relayUrl, signed);
      onStatus(ok ? 'Reveal published - your outcome + salt are now public and must match your commit.' : 'Relay did not accept the reveal in time - try again.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'reveal failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dispute-status-phase" data-testid={`vote-section-${dispute.eventId.slice(0, 8)}`}>
      <button type="button" onClick={onSelect} className="dispute-btn" style={{ marginBottom: '0.3rem' }}>
        {selected ? '▾' : '▸'} vote on {label}
      </button>
      {selected && (
        <div style={{ paddingLeft: '0.75rem', borderLeft: '2px solid var(--np-rule, #d8d2c4)' }}>
          <div>opened by {myPubkey && dispute.publisher === myPubkey ? 'you' : `${dispute.publisher.slice(0, 8)}…`} · {new Date(dispute.createdAt * 1000).toLocaleString()}</div>
          <div data-testid="vote-tally">
            Tally: <strong>{view.tally.outcome || '-'}</strong> · reveals {view.revealsSoFar}/{view.threshold}{view.finalized ? ' - FINALIZED' : ''}
            {view.tally.invalidReveals.length > 0 && <span title="reveals whose hash disagrees with their commit"> · ⚠ {view.tally.invalidReveals.length} invalid</span>}
          </div>
          {view.rows.length > 0 && (
            <div style={{ margin: '0.3rem 0' }}>
              {view.rows.map((r) => (
                <div key={`${r.pubkey}:${r.jurorIdx}`} data-testid={`vote-row-${r.jurorIdx}`}>
                  juror #{r.jurorIdx} <code>{r.pubkey.slice(0, 10)}…</code> - {r.commit ? 'committed' : 'NO COMMIT'}{r.reveal ? ` → revealed ${r.reveal.outcome}` : ''}{r.mismatch ? ' ⚠ MISMATCH' : ''}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '0.3rem' }}>
            <label style={{ marginRight: '0.75rem' }}>
              Outcome{' '}
              <select value={myStored?.outcome ?? voteOutcome} onChange={(e) => setVoteOutcome(e.target.value as 'challenger' | 'respondent')} disabled={hasMyCommit}>
                <option value="challenger">challenger</option>
                <option value="respondent">respondent</option>
              </select>
            </label>
            {!hasMyCommit ? (
              <button type="button" className="dispute-btn" disabled={busy || !signEvent || myIdx === null} data-testid="vote-commit" onClick={() => void doCommit()}>
                Commit vote 🔒
              </button>
            ) : !hasMyReveal ? (
              <button type="button" className="dispute-btn" disabled={busy || !signEvent || !window.open || !mySalt} data-testid="vote-reveal" onClick={() => void doReveal()} title={!window.open ? 'Commit phase still running' : !mySalt ? 'No stored salt' : ''}>
                Reveal vote 🔓
              </button>
            ) : (
              <span>✓ voted ({myRow?.reveal?.outcome})</span>
            )}
            {mySalt && !hasMyReveal && <span title="kept in localStorage until reveal - losing it forfeits the bond"> · salt stored ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** This juror's roster index from their own signed commit/reveal events. */
function myIdxFromEvents(events: CourtEvent[], pubkey: string): number | null {
  for (const e of events) {
    if (e.pubkey.toLowerCase() !== pubkey.toLowerCase()) continue;
    const idx = Number(e.tags.find((t) => t[0] === 'juror')?.[1]);
    if (Number.isInteger(idx) && idx >= 1) return idx;
  }
  return null;
}

/** Fire-and-forget EVENT send with a bounded wait (round-4 lesson). */
async function sendToRelay(relayUrl: string, signed: { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    const timer = setTimeout(() => { try { ws.close(); } catch { /* noop */ } resolve(false); }, 5_000);
    try { ws = new WebSocket(relayUrl); } catch { clearTimeout(timer); resolve(false); return; }
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', signed])); } catch { clearTimeout(timer); resolve(false); }
    };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(String(m.data)) as unknown[];
        if (msg[0] === 'OK' && msg[1] === signed.id) {
          clearTimeout(timer);
          resolve(Boolean(msg[2]));
          ws.close();
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  });
}

/** Re-exported for the tab badge (summons count) in App. */
export function courtBadgeCount(inboxCount: number): number {
  return inboxCount;
}

/** Keep the tree-shaker honest: finalizeEvent/hexToBytes are used by tests
 *  that build fixtures for this panel's flows. */
export const _internal = { finalizeEvent, bytesToHex, hexToBytes };
