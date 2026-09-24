/**
 * useCourtDispute - S1/S2 React wiring (COURT-GUI-WIRING-DESIGN.md §2).
 *
 * Live subscription over the fund's own relay (NIP-01 REQ with the round-1
 * index filters), folded through the PURE disputeStatus fold with an injected
 * clock that ticks on an interval and on window focus. The hook NEVER mutates
 * money: it only reads events and computes views. Publishing (S1) is a
 * separate callback using the vendor builder + the auth signer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import {
  attestationsFilter,
  disputesFilter,
  foldDisputeStatus,
  parseDisputeEvent,
  type DisputeStatusView,
  type FoldContext,
} from '../lib/court/disputeStatus';
import { baoRelayUrl } from '../lib/baoFundraising';

export interface UseCourtDisputeParams {
  escrowId: string;
  partyAPubkey: string;
  partyBPubkey: string;
  /** REAL empaneled jury key once selection/DKG completes (null before). */
  courtGroupPubkey: string | null;
}

export interface UseCourtDisputeResult {
  /** The live (party-authored) dispute for this escrow, if any. */
  disputeEventId: string | null;
  status: DisputeStatusView | null;
  /** Unix seconds at last tick (injected clock for countdowns). */
  now: number;
  /** Relay surface errors (never thrown - the view degrades gracefully). */
  error: string | null;
}

function wsUrl(): string {
  return baoRelayUrl();
}

/**
 * Minimal NIP-01 subscriber: open REQ, collect EVENT frames, EOSE keeps the
 * socket open for live updates, CLOSE on unmount. Reconnects with backoff.
 * (Round-4 field lesson: bounded timeouts, no single-relay fatalism.)
 */
function subscribe(
  filters: readonly unknown[],
  onEvent: (e: NostrEvent) => void,
  onError: (msg: string) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      onError('relay unreachable');
      scheduleRetry();
      return;
    }
    ws.onopen = () => {
      attempt = 0;
      try {
        ws?.send(JSON.stringify(['REQ', 'court-s1s2', ...filters]));
      } catch {
        /* socket died between open and send - onclose handles retry */
      }
    };
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(String(m.data)) as unknown[];
        if (msg[0] === 'EVENT' && msg[2]) onEvent(msg[2] as NostrEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    // A cleanup (StrictMode double-mount, room switch) closes a still-
    // CONNECTING socket; browsers fire onerror for that abort, which used to
    // surface as a spurious "relay error" on every card. Only report/retry
    // while the subscription is actually live.
    ws.onerror = () => {
      if (!closed) onError('relay error');
    };
    ws.onclose = () => {
      if (!closed) scheduleRetry();
    };
  };

  const scheduleRetry = () => {
    attempt = Math.min(attempt + 1, 6);
    retryTimer = setTimeout(open, Math.min(30_000, 500 * 2 ** attempt));
  };

  open();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(['CLOSE', 'court-s1s2']));
      ws?.close();
    } catch {
      /* already closed */
    }
  };
}

export function useCourtDispute(params: UseCourtDisputeParams): UseCourtDisputeResult {
  const { escrowId, partyAPubkey, partyBPubkey, courtGroupPubkey } = params;
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Injected clock: ticks on an interval AND on focus (round-3: deadlines
  // must be live; wall-clock reads stay OUT of the pure fold).
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(tick, 15_000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', tick);
    };
  }, []);

  // Disputes for THIS escrow only: the relay query is by party pubkeys, so a
  // party's dispute for ANOTHER campaign was previously adopted here (wrong
  // dispute shown, legitimate one blocked as 'already open').
  const [verdictDisputeId, setVerdictDisputeId] = useState<string | null>(null);
  useEffect(() => {
    const parseCtx: FoldContext = {
      partyAPubkey,
      partyBPubkey,
      courtGroupPubkey: courtGroupPubkey ?? '0'.repeat(64),
      nowSeconds: Math.floor(Date.now() / 1000),
    };
    const stop1 = subscribe([disputesFilter([partyAPubkey, partyBPubkey])], (e) => {
      if (!mounted.current) return;
      if (e.kind === 38025) {
        const parsed = parseDisputeEvent({ id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content, sig: e.sig }, parseCtx);
        if (!parsed || parsed.escrowId.toLowerCase() !== escrowId.toLowerCase()) return;
      }
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e]));
      if (e.kind === 38025) setVerdictDisputeId((prev) => prev ?? e.id);
    }, (msg) => mounted.current && setError(msg));
    return () => stop1();
    // `escrowId`/parties anchor the query; `now` is read fresh at event time.
  }, [escrowId, partyAPubkey, partyBPubkey, courtGroupPubkey]);

  // Verdict subscription keyed on the DISPUTE EVENT ID STATE: the previous
  // one-file effect captured the ref before the dispute arrived, so 39007
  // verdicts were never subscribed.
  useEffect(() => {
    if (!verdictDisputeId) return;
    const stop = subscribe([attestationsFilter(verdictDisputeId)], (e) => {
      if (!mounted.current) return;
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e]));
    }, (msg) => mounted.current && setError(msg));
    return () => stop();
  }, [verdictDisputeId]);

  const ctx: FoldContext | null = useMemo(() => {
    if (!courtGroupPubkey) return null;
    return {
      partyAPubkey,
      partyBPubkey,
      courtGroupPubkey,
      nowSeconds: now,
    };
  }, [partyAPubkey, partyBPubkey, courtGroupPubkey, now]);

  const disputeEventId = useMemo(
    () => events.find((e) => e.kind === 38025)?.id ?? null,
    [events],
  );

  const status = useMemo(() => {
    if (!ctx || !disputeEventId) return null;
    return foldDisputeStatus(events, disputeEventId, ctx);
  }, [events, disputeEventId, ctx]);

  // A party-authored dispute still needs the parse gate even before the jury
  // key exists - surface its existence so the UI can show "dispute open".
  const dispute = useMemo(() => {
    const ctxAll: FoldContext = {
      partyAPubkey,
      partyBPubkey,
      courtGroupPubkey: courtGroupPubkey ?? '0'.repeat(64),
      nowSeconds: now,
    };
    for (const e of events) {
      if (e.kind !== 38025) continue;
      const parsed = parseDisputeEvent({ id: e.id, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content, sig: e.sig }, ctxAll);
      if (parsed && parsed.escrowId.toLowerCase() === escrowId.toLowerCase()) return parsed;
    }
    return null;
  }, [events, partyAPubkey, partyBPubkey, courtGroupPubkey, escrowId, now]);

  return { disputeEventId: dispute ? dispute.disputeId : null, status, now, error };
}
