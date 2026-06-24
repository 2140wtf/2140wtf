import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import type { BaoCourtDispute } from '@/hooks/useBaoCourtDisputes';
import {
  BAO_COURT_DEMO_MEMBERSHIP_KIND,
  DEMO_BOND_AMOUNT_SATS,
  buildDemoMembershipEvent,
  buildDemoSelectedJurors,
  buildMockDisputeEvent,
  deriveDkgSeed,
  deriveMockDisputeId,
  deriveRoomId,
  loadDemoRoom,
  parseDemoMembershipEvent,
  saveDemoRoom,
  clearDemoRoom,
} from '@/lib/baoCourtSimulator';
import type { DemoRoomState } from '@/lib/baoCourtSimulator';
import {
  buildSelectionEvent,
} from '@bao/frost-court';
import type { SelectedJuror } from '@bao/frost-court';

const RELAY = 'wss://relay.bao.network';
const QUERY_TIMEOUT_MS = 15_000;
const LIVE_BATCH_MS = 500;
const SETTLE_MS = 2_000;

export type DemoRoomStatus =
  | 'idle'
  | 'joining'
  | 'waiting'
  | 'settling'
  | 'forming'
  | 'formed'
  | 'error';

export interface UseDemoCourtRoomOptions extends DemoRoomState {
  readonly autoJoin?: boolean;
}

export interface UseDemoCourtRoomResult {
  readonly members: DemoRoomMember[];
  readonly dispute: BaoCourtDispute | null;
  readonly selectedJurors: SelectedJuror[];
  readonly seed: string | null;
  readonly status: DemoRoomStatus;
  readonly error: string | null;
  readonly join: () => Promise<void>;
  readonly leave: () => void;
}

export interface DemoRoomMember {
  readonly pubkey: string;
  readonly categories: readonly string[];
  readonly joinedAt: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function buildDemoDispute(
  event: NostrEvent,
  roomId: string,
  category: string,
): BaoCourtDispute {
  const getTag = (name: string): string | undefined =>
    event.tags.find((t) => t[0] === name)?.[1];

  const proposedOutcome = getTag('proposed') ?? `Demo dispute: ${category}`;
  const originalOutcome = getTag('original') ?? 'Original outcome';
  const challengerPubkey = getTag('challenger') ?? event.pubkey;
  const deadline = Number(getTag('deadline') ?? '0');

  return {
    disputeId: getTag('dispute') ?? event.id,
    marketId: getTag('market') ?? `demo-${category}`,
    marketEventId: getTag('e'),
    challengerPubkey,
    respondentPubkey: '',
    evidenceHashes: [],
    proposedOutcome,
    originalOutcome,
    createdAt: event.created_at,
    deadline,
    rawEvent: event,
    status: deadline > 0 && nowSeconds() > deadline ? 'closed' : 'open',
  };
}

/**
 * Join a named demo jury room, discover other demo jurors by category, and
 * automatically form a mock dispute + selection when the threshold is reached.
 *
 * NOTE: This hook intentionally avoids a coordinator. A single coordinator is
 * custodial and undesirable; the protocol target is a fully independent jury.
 * Every juror derives the same deterministic dispute id, jury selection, and
 * DKG seed from the roster, so each juror can form the demo locally and publish
 * their own copy of the dispute + selection events.
 */
export function useDemoCourtRoom(options: UseDemoCourtRoomOptions): UseDemoCourtRoomResult {
  const { roomName, category, threshold, pace, autoJoin = true } = options;
  const roomId = useMemo(() => deriveRoomId(roomName, category), [roomName, category]);

  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const [members, setMembers] = useState<DemoRoomMember[]>([]);
  const [status, setStatus] = useState<DemoRoomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dispute, setDispute] = useState<BaoCourtDispute | null>(null);

  const [hasJoined, setHasJoined] = useState(false);
  const formingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const memberPubkeys = useMemo(() => members.map((m) => m.pubkey), [members]);

  const selectedJurors = useMemo(
    () => (members.length >= threshold ? buildDemoSelectedJurors(memberPubkeys, category) : []),
    [members, threshold, memberPubkeys, category],
  );

  const disputeId = useMemo(
    () => (members.length >= threshold ? deriveMockDisputeId(roomId, memberPubkeys) : ''),
    [members, roomId, memberPubkeys, threshold],
  );

  const seed = useMemo(
    () =>
      disputeId && members.length >= threshold
        ? deriveDkgSeed({ roomId, disputeId, jurorPubkeys: memberPubkeys })
        : null,
    [disputeId, members.length, roomId, memberPubkeys, threshold],
  );

  // Publish our membership event when joining a room.
  const join = useCallback(async () => {
    if (!user) {
      setError('You must be logged in to join a demo room.');
      return;
    }
    if (hasJoined || status === 'joining') return;

    setStatus('joining');
    try {
      const template = buildDemoMembershipEvent({
        roomId,
        category,
        publisherPubkey: user.pubkey,
      });
      await publishEvent(template);
      saveDemoRoom({ roomName, category, threshold, pace });
      setHasJoined(true);
      setStatus('waiting');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to join demo room.');
    }
  }, [user, hasJoined, status, roomId, category, publishEvent, roomName, threshold, pace]);

  const leave = useCallback(() => {
    setHasJoined(false);
    setMembers([]);
    setDispute(null);
    setStatus('idle');
    setError(null);
    clearDemoRoom();
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Auto-restore / auto-join a persisted room on mount.
  useEffect(() => {
    if (!autoJoin || !user) return;
    const persisted = loadDemoRoom();
    if (
      persisted &&
      persisted.roomName === roomName &&
      persisted.category === category &&
      persisted.threshold === threshold &&
      persisted.pace === pace
    ) {
      void join();
    }
  }, [autoJoin, user, roomName, category, threshold, pace, join]);

  // Live subscription for demo-room membership events.
  useEffect(() => {
    if (!hasJoined) return;

    const relay = new NRelay1(RELAY);
    const controller = new AbortController();

    const since = nowSeconds() - 300; // Look back 5 minutes for recent memberships.
    const filter: NostrFilter = {
      kinds: [BAO_COURT_DEMO_MEMBERSHIP_KIND],
      '#room': [roomId],
      since,
      limit: 100,
    };

    async function bootstrap() {
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      try {
        const events = await relay.query([filter], { signal: controller.signal });
        const roster = buildRoster(events);
        setMembers(roster);
      } catch {
        // Best-effort bootstrap.
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const pending: NostrEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function buildRoster(events: NostrEvent[]): DemoRoomMember[] {
      const byPubkey = new Map<string, DemoRoomMember>();
      for (const event of events) {
        const parsed = parseDemoMembershipEvent(event);
        if (!parsed) continue;
        const existing = byPubkey.get(parsed.pubkey);
        if (!existing || parsed.joinedAt > existing.joinedAt) {
          byPubkey.set(parsed.pubkey, parsed);
        }
      }
      return Array.from(byPubkey.values()).sort((a, b) => a.joinedAt - b.joinedAt);
    }

    function flush() {
      flushTimer = null;
      if (pending.length === 0 || controller.signal.aborted) return;
      const events = pending.splice(0, pending.length);
      setMembers((prev) => {
        const merged = new Map<string, DemoRoomMember>();
        for (const m of prev) merged.set(m.pubkey, m);
        for (const event of events) {
          const parsed = parseDemoMembershipEvent(event);
          if (!parsed) continue;
          const existing = merged.get(parsed.pubkey);
          if (!existing || parsed.joinedAt > existing.joinedAt) {
            merged.set(parsed.pubkey, parsed);
          }
        }
        return Array.from(merged.values()).sort((a, b) => a.joinedAt - b.joinedAt);
      });
    }

    function scheduleFlush() {
      if (flushTimer == null && !controller.signal.aborted) {
        flushTimer = setTimeout(flush, LIVE_BATCH_MS);
      }
    }

    (async () => {
      try {
        await bootstrap();
        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          pending.push(msg[2]);
          scheduleFlush();
        }
      } catch {
        // Subscription errors are best-effort.
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      if (flushTimer) clearTimeout(flushTimer);
      relay.close().catch(() => {});
    };
  }, [hasJoined, roomId]);

  // Each juror independently forms the mock dispute and selection.
  // No coordinator is involved; the deterministic roster guarantees every juror
  // derives the same dispute id, jury selection, and DKG seed.
  const formAsJuror = useCallback(async () => {
    if (!user || !seed) return;
    try {
      const id = deriveMockDisputeId(roomId, memberPubkeys);
      const mockDisputeTemplate = buildMockDisputeEvent({
        disputeId: id,
        roomId,
        category,
        publisherPubkey: user.pubkey,
      });
      const disputeEvent = await publishEvent(mockDisputeTemplate);
      setDispute(buildDemoDispute(disputeEvent, roomId, category));

      const selectionTemplate = buildSelectionEvent({
        disputeId: id,
        marketId: `demo-${category}`,
        selectedJurors: selectedJurors.map((j) => ({
          idx: j.idx,
          pubkey: j.nostrPubkey,
          stake: j.stakeCapacitySats,
        })),
        backupJurors: [],
        seed,
        blockHash: '0000000000000000000000000000000000000000000000000000000000000000',
        publisherPubkey: user.pubkey,
      });
      selectionTemplate.tags.push(['demo', 'court-simulator']);
      selectionTemplate.tags.push(['room', roomId]);
      await publishEvent(selectionTemplate);

      toast({
        title: 'Demo jury formed',
        description: `${selectedJurors.length} jurors, ${DEMO_BOND_AMOUNT_SATS.toLocaleString()} fake sats locked. Starting FROST ceremony...`,
      });
      setStatus('formed');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to form demo jury.');
      formingRef.current = false;
    }
  }, [user, seed, roomId, memberPubkeys, category, selectedJurors, publishEvent, toast]);

  // Detect threshold and trigger independent formation for every juror.
  useEffect(() => {
    if (!hasJoined || members.length < threshold) return;
    if (status === 'formed' || status === 'forming' || status === 'settling') return;

    setStatus('settling');
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (members.length < threshold) {
        setStatus('waiting');
        return;
      }
      if (formingRef.current) return;
      formingRef.current = true;
      setStatus('forming');

      if (user) {
        void formAsJuror();
      }
    }, SETTLE_MS);

    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [hasJoined, members, threshold, status, user, formAsJuror]);

  return {
    members,
    dispute,
    selectedJurors,
    seed,
    status,
    error,
    join,
    leave,
  };
}
