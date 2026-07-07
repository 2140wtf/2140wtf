import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as frost from "@vbyte/frost";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { useNostr } from "@nostrify/react";
import { type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useUserSeckey } from "@/hooks/useUserSeckey";
import { openBaoCourtRelay, publishProtocolWrap } from "@/lib/baoCourtRelays";

import {
  buildDkgCommitmentEvent,
  buildVoteCommitEvent,
  buildVoteRevealEvent,
  buildFrostCommitEvent,
  buildFrostRevealEvent,
  buildAttestationEvent,
  PedersenDkgAdapter,
  runDisputeOverrideSigning,
  hashCommit,
  tallyVotes,
  randomHex32,
  randomScalar,
  scalarToHex,
  buildAttestationMessage,
  createProofOfKnowledge,
  IndependentDkgSession,
  IndependentSigningSession,
  wrapProtocolEvent,
  unwrapProtocolEvent,
  parseEncryptedShareEvent,
  parseDkgComplaintEvent,
  parseDkgCommitmentEvent,
  parseVoteRevealEvent,
  BAO_COURT_DKG_COMMITMENT_KIND,
  BAO_COURT_FROST_COMMIT_KIND,
  BAO_COURT_FROST_REVEAL_KIND,
  BAO_COURT_VOTE_REVEAL_KIND,
  ENCRYPTED_SHARE_KIND,
  DKG_COMPLAINT_KIND,
  type DisputeCase,
  type SelectedJuror,
  type AppealPhase,
  type JurorSessionState,
  type JurorVote,
  type DkgRecord,
  type FrostAttestation,
} from "@bao/frost-court";

export interface UseJurorSessionOptions {
  readonly dispute: DisputeCase;
  readonly selectedJurors: SelectedJuror[];
  readonly myJurorIdx: number;
  readonly demoMode: boolean;
  /**
   * Run a real independent-juror ceremony over Nostr. Requires an nsec login
   * so the hook can encrypt/decrypt NIP-59 DKG shares.
   */
  readonly realMode?: boolean;
  /**
   * Optional deterministic DKG seed. In demo mode, providing a seed lets every
   * juror derive the same group public key and secret shares locally.
   */
  readonly seed?: string;
}

export interface JurorSessionActions {
  readonly publishDkgCommitment: () => Promise<void>;
  readonly publishVoteCommit: (outcome: string) => Promise<void>;
  readonly publishVoteReveal: () => Promise<void>;
  readonly publishFrostCommitment: () => Promise<void>;
  readonly publishFrostReveal: () => Promise<void>;
  readonly aggregateAndPublishAttestation: () => Promise<void>;
  readonly advancePhase: (phase: AppealPhase) => void;
}

export interface JurorSessionProgress {
  readonly dkgPhase: RealDkgPhase | null;
  readonly dkgCounts: { readonly commitments: number; readonly shares: number; readonly complaints: number };
  readonly signingCounts: { readonly commitments: number; readonly reveals: number };
}

interface LocalPolynomial {
  readonly idx: number;
  readonly pubkey: string;
  readonly coeffs: bigint[];
  readonly commitments: string[];
  readonly pok: { nonce: string; response: string };
}

function createLocalPolynomial(idx: number, pubkey: string, threshold: number): LocalPolynomial {
  const Point = secp256k1.Point;
  const coeffs: bigint[] = Array.from({ length: threshold }, () => randomScalar());
  const commitments = coeffs.map((a) => Point.BASE.multiply(a).toHex(true));
  const pok = createProofOfKnowledge(scalarToHex(coeffs[0]), commitments[0]);
  return { idx, pubkey, coeffs, commitments, pok };
}

function deriveThreshold(jurorCount: number): number {
  if (jurorCount >= 5) return 3;
  if (jurorCount >= 3) return 2;
  return Math.max(2, jurorCount);
}

function parseFrostCommitEvent(event: NostrEvent): {
  idx: number;
  pubkey: string;
  commitmentPackage: { idx: number; binder_pn: string; hidden_pn: string };
} | null {
  if (event.kind !== BAO_COURT_FROST_COMMIT_KIND || !event.pubkey) return null;
  const disputeTag = event.tags.find((t) => t[0] === 'dispute')?.[1];
  if (!disputeTag) return null;
  const jurorTag = event.tags.find((t) => t[0] === 'juror')?.[1];
  const binderTag = event.tags.find((t) => t[0] === 'binder_pn')?.[1];
  const hiddenTag = event.tags.find((t) => t[0] === 'hidden_pn')?.[1];
  if (!jurorTag || !binderTag || !hiddenTag) return null;
  const idx = Number(jurorTag);
  if (!Number.isFinite(idx)) return null;
  return {
    idx,
    pubkey: event.pubkey,
    commitmentPackage: { idx, binder_pn: binderTag, hidden_pn: hiddenTag },
  };
}

function parseFrostRevealEvent(event: NostrEvent): {
  idx: number;
  pubkey: string;
  frostPubkey: string;
  publicNonce: { idx: number; binder_pn: string; hidden_pn: string };
  partialSig: string;
} | null {
  if (event.kind !== BAO_COURT_FROST_REVEAL_KIND || !event.pubkey) return null;
  const disputeTag = event.tags.find((t) => t[0] === 'dispute')?.[1];
  if (!disputeTag) return null;
  const jurorTag = event.tags.find((t) => t[0] === 'juror')?.[1];
  const pkTag = event.tags.find((t) => t[0] === 'pk')?.[1];
  const binderTag = event.tags.find((t) => t[0] === 'nonce_binder')?.[1];
  const hiddenTag = event.tags.find((t) => t[0] === 'nonce_hidden')?.[1];
  const psigTag = event.tags.find((t) => t[0] === 'psig')?.[1];
  if (!jurorTag || !pkTag || !binderTag || !hiddenTag || !psigTag) return null;
  const idx = Number(jurorTag);
  if (!Number.isFinite(idx)) return null;
  return {
    idx,
    pubkey: event.pubkey,
    frostPubkey: pkTag,
    publicNonce: { idx, binder_pn: binderTag, hidden_pn: hiddenTag },
    partialSig: psigTag,
  };
}

const DKG_SUBSCRIPTION_SINCE_OFFSET_SECONDS = 24 * 60 * 60;

type RealDkgPhase = 'awaiting_commitments' | 'awaiting_shares' | 'complaint' | 'complete' | 'failed';

export function useJurorSession(
  options: UseJurorSessionOptions,
): { state: JurorSessionState; actions: JurorSessionActions; isPending: boolean; progress: JurorSessionProgress } {
  const { dispute, selectedJurors, myJurorIdx, demoMode, realMode = false, seed } = options;
  const { user } = useCurrentUser();
  const seckey = useUserSeckey();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();

  const [phase, setPhase] = useState<AppealPhase>("selection");
  const [groupPubkey, setGroupPubkey] = useState<string | null>(null);
  const [groupPubkeyXOnly, setGroupPubkeyXOnly] = useState<string | null>(null);
  const [myVoteCommit, setMyVoteCommit] = useState<string | null>(null);
  const [myVoteReveal, setMyVoteReveal] = useState<{ outcome: string; salt: string } | null>(null);
  const [tally, setTally] = useState<{ outcome: string; supportingVotes: JurorVote[] } | null>(null);
  const [attestation, setAttestation] = useState<FrostAttestation | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [dkgPhase, setDkgPhase] = useState<RealDkgPhase | null>(null);
  const [dkgCounts, setDkgCounts] = useState({ commitments: 0, shares: 0, complaints: 0 });
  const [signingCounts, setSigningCounts] = useState({ commitments: 0, reveals: 0 });

  const threshold = useMemo(() => deriveThreshold(selectedJurors.length), [selectedJurors.length]);

  const localPolyRef = useRef<LocalPolynomial | null>(null);
  const dkgRecordRef = useRef<DkgRecord | null>(null);
  const demoSharesRef = useRef<frost.SecretShare[] | null>(null);
  const myShareRef = useRef<frost.SecretShare | null>(null);
  const frostCommitmentRef = useRef<frost.CommitmentPackage | null>(null);
  const demoFrostCommitsRef = useRef<frost.CommitmentPackage[] | null>(null);
  const frostRevealRef = useRef<
    { idx: number; pubkey: string; pnonce: frost.PublicNonce; psig: string } | null
  >(null);

  const independentDkgRef = useRef<IndependentDkgSession | null>(null);
  const independentSigningRef = useRef<IndependentSigningSession | null>(null);
  const commitmentEventIdsRef = useRef<Record<number, string>>({});

  // Reset all session state when the underlying dispute changes so stale
  // secrets, commitments, and votes from a previous session never leak across
  // disputes.
  useEffect(() => {
    setPhase("selection");
    setGroupPubkey(null);
    setGroupPubkeyXOnly(null);
    setMyVoteCommit(null);
    setMyVoteReveal(null);
    setTally(null);
    setAttestation(null);
    setIsPending(false);
    setDkgPhase(null);
    setDkgCounts({ commitments: 0, shares: 0, complaints: 0 });
    setSigningCounts({ commitments: 0, reveals: 0 });
    localPolyRef.current = null;
    dkgRecordRef.current = null;
    demoSharesRef.current = null;
    myShareRef.current = null;
    frostCommitmentRef.current = null;
    demoFrostCommitsRef.current = null;
    frostRevealRef.current = null;
    independentDkgRef.current = null;
    independentSigningRef.current = null;
    commitmentEventIdsRef.current = {};
  }, [dispute.disputeId]);

  // Generate this juror's local Pedersen polynomial once they enter the
  // selection phase. The coefficients live only in this ref / session memory.
  useEffect(() => {
    if (!user || phase !== "selection" || myJurorIdx < 1 || localPolyRef.current) return;
    localPolyRef.current = createLocalPolynomial(myJurorIdx, user.pubkey, threshold);
  }, [user, phase, myJurorIdx, threshold]);

  const peerJurors = useMemo(
    () => selectedJurors.filter((j) => j.idx !== myJurorIdx),
    [selectedJurors, myJurorIdx],
  );

  const peerPubkeys = useMemo(
    () => peerJurors.map((j) => j.nostrPubkey),
    [peerJurors],
  );

  const publishDkgCommitment = useCallback(async () => {
    if (!user) return;
    setIsPending(true);
    try {
      if (demoMode) {
        if (!localPolyRef.current) return;
        const template = buildDkgCommitmentEvent({
          disputeId: dispute.disputeId,
          jurorIdx: myJurorIdx,
          jurorPubkey: user.pubkey,
          threshold,
          vssCommits: localPolyRef.current.commitments,
          pok: localPolyRef.current.pok,
          phaseNonce: randomHex32(),
        });
        await publishEvent(template);

        // Run the full DKG locally so the GUI can proceed without peer jurors.
        const { record, shares } = new PedersenDkgAdapter({ unsafeTestMode: true }).run({
          marketId: dispute.marketId,
          disputeId: dispute.disputeId,
          threshold,
          jurors: selectedJurors,
          seed,
        });
        dkgRecordRef.current = record;
        demoSharesRef.current = shares;
        myShareRef.current = shares.find((s) => s.idx === myJurorIdx) ?? null;
        setGroupPubkey(record.groupPubkey);
        setGroupPubkeyXOnly(record.groupPubkeyXOnly);
        setPhase("dkg");
        return;
      }

      if (!realMode) {
        throw new Error(
          "Cross-juror DKG is only available in demo or real ceremony mode.",
        );
      }

      if (!seckey) {
        throw new Error(
          "Real ceremony requires a local nsec login so DKG shares can be encrypted.",
        );
      }

      if (independentDkgRef.current) {
        // Already started; do not generate a second polynomial.
        return;
      }

      const session = new IndependentDkgSession({
        disputeId: dispute.disputeId,
        marketId: dispute.marketId,
        myIdx: myJurorIdx,
        myPubkey: user.pubkey,
        mySeckey: seckey,
        threshold,
        jurors: selectedJurors,
      });

      const { commitmentEvent, shareEvents } = await session.generateCommitmentAndShares();
      independentDkgRef.current = session;

      await publishEvent(commitmentEvent);

      for (const shareEvent of shareEvents) {
        const toTag = shareEvent.tags.find((t) => t[0] === 'to');
        const recipientPubkey = toTag?.[2];
        if (!recipientPubkey) continue;
        const wrap = wrapProtocolEvent(shareEvent, seckey, recipientPubkey);
        await publishProtocolWrap(nostr, wrap, recipientPubkey);
      }

      setDkgPhase('awaiting_commitments');
      setPhase("dkg");
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, myJurorIdx, demoMode, realMode, seckey, threshold, selectedJurors, seed, publishEvent, nostr]);

  // Real-mode DKG subscription: collect peer commitments, encrypted shares, and
  // complaints; decrypt/verify shares; and publish a self-backup on success.
  useEffect(() => {
    if (!realMode || phase !== 'dkg' || !independentDkgRef.current || !seckey || !user) return;

    const session = independentDkgRef.current;
    const myPubkey = user.pubkey;
    const mySeckey = seckey;
    let completed = false;

    async function tryComputeKey() {
      if (completed || !session.canComputeKey()) return;
      await session.decryptShares();
      session.verifyShares(commitmentEventIdsRef.current);
      session.resolveComplaints();
      if (!session.canComputeKey()) {
        setDkgPhase('complaint');
        return;
      }

      completed = true;
      const record = session.computeKey();
      const { backupEvent } = await session.buildBackupPayload(myPubkey);
      const wrap = wrapProtocolEvent(backupEvent, mySeckey, myPubkey);
      publishProtocolWrap(nostr, wrap, myPubkey).catch((error) => {
        console.warn('Failed to publish DKG self-backup:', error);
      });

      dkgRecordRef.current = record;
      myShareRef.current = session.getShare();
      setGroupPubkey(record.groupPubkey);
      setGroupPubkeyXOnly(record.groupPubkeyXOnly);
      setDkgPhase('complete');
    }

    const relay = openBaoCourtRelay();
    const controller = new AbortController();
    const since = Math.floor(Date.now() / 1000) - DKG_SUBSCRIPTION_SINCE_OFFSET_SECONDS;

    const filters: NostrFilter[] = [
      { kinds: [BAO_COURT_DKG_COMMITMENT_KIND], authors: peerPubkeys, '#dispute': [dispute.disputeId], since },
      { kinds: [DKG_COMPLAINT_KIND], '#dispute': [dispute.disputeId], since },
      { kinds: [1059], '#p': [myPubkey], since },
    ];

    let commitmentCount = 0;
    let shareCount = 0;
    let complaintCount = 0;

    function updateCounts() {
      setDkgCounts({
        commitments: commitmentCount,
        shares: shareCount,
        complaints: complaintCount,
      });
    }

    async function handleEvent(event: NostrEvent) {
      if (controller.signal.aborted) return;
      let changed = false;

      if (event.kind === BAO_COURT_DKG_COMMITMENT_KIND) {
        const parsed = parseDkgCommitmentEvent(event);
        if (!parsed || parsed.disputeId !== dispute.disputeId) return;
        if (session.addCommitment({
          idx: parsed.jurorIdx,
          pubkey: parsed.jurorPubkey,
          threshold: parsed.threshold,
          vssCommits: parsed.vssCommits,
          pok: parsed.pok,
          phaseNonce: parsed.phaseNonce,
          eventId: event.id,
        })) {
          commitmentEventIdsRef.current[parsed.jurorIdx] = event.id;
          commitmentCount += 1;
          changed = true;
        }
      } else if (event.kind === DKG_COMPLAINT_KIND) {
        const parsed = parseDkgComplaintEvent(event);
        if (!parsed || parsed.disputeId !== dispute.disputeId) return;
        session.addComplaint(parsed);
        complaintCount += 1;
        changed = true;
      } else if (event.kind === 1059) {
        const rumor = unwrapProtocolEvent(event, mySeckey);
        if (!rumor || rumor.kind !== ENCRYPTED_SHARE_KIND) return;
        const payload = parseEncryptedShareEvent(rumor);
        if (!payload || payload.disputeId !== dispute.disputeId || payload.toIdx !== myJurorIdx) return;
        if (session.addEncryptedShare(payload)) {
          shareCount += 1;
          changed = true;
        }
      }

      if (changed) {
        updateCounts();
        void tryComputeKey();
      }
    }

    (async () => {
      try {
        const initial = await relay.query(filters, { signal: controller.signal });
        for (const event of initial) {
          await handleEvent(event);
        }
        for await (const msg of relay.req(filters, { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          void handleEvent(msg[2]);
        }
      } catch {
        // Subscription errors are best-effort.
      } finally {
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, [realMode, phase, seckey, user, peerPubkeys, peerJurors.length, dispute.disputeId, myJurorIdx, nostr]);

  const publishVoteCommit = useCallback(
    async (outcome: string) => {
      if (!user) return;
      setIsPending(true);
      try {
        const salt = randomHex32();
        const commitHash = hashCommit(outcome, salt);
        const template = buildVoteCommitEvent({
          disputeId: dispute.disputeId,
          jurorIdx: myJurorIdx,
          commitHash,
        });
        await publishEvent(template);
        setMyVoteCommit(commitHash);
        setMyVoteReveal({ outcome, salt });
        setPhase("vote-commit");
      } finally {
        setIsPending(false);
      }
    },
    [user, dispute.disputeId, myJurorIdx, publishEvent],
  );

  const publishVoteReveal = useCallback(async () => {
    if (!user || !myVoteReveal) return;
    setIsPending(true);
    try {
      const template = buildVoteRevealEvent({
        disputeId: dispute.disputeId,
        jurorIdx: myJurorIdx,
        outcome: myVoteReveal.outcome,
        salt: myVoteReveal.salt,
      });
      await publishEvent(template);

      if (demoMode) {
        // In demo mode every simulated juror reveals the same outcome as the
        // current user so the GUI can reach a unanimous tally locally.
        const votes: JurorVote[] = selectedJurors.map((j) => ({
          idx: j.idx,
          pubkey: j.nostrPubkey,
          commit: hashCommit(myVoteReveal.outcome, myVoteReveal.salt),
          reveal: { outcome: myVoteReveal.outcome, salt: myVoteReveal.salt },
        }));
        setTally(tallyVotes(votes));
        setPhase("vote-reveal");
      } else if (realMode) {
        setPhase("vote-reveal");
      }
    } finally {
      setIsPending(false);
    }
  }, [user, myVoteReveal, dispute.disputeId, myJurorIdx, demoMode, realMode, selectedJurors, publishEvent]);

  // Real-mode vote-reveal subscription: tally peer reveals as they arrive.
  useEffect(() => {
    if (!realMode || phase !== 'vote-reveal' || !user || !myVoteReveal) return;

    const relay = openBaoCourtRelay();
    const controller = new AbortController();
    const since = Math.floor(Date.now() / 1000) - DKG_SUBSCRIPTION_SINCE_OFFSET_SECONDS;
    const myPubkey = user.pubkey;
    const myReveal = myVoteReveal;
    const authors = [...peerPubkeys, myPubkey];

    const filter: NostrFilter = {
      kinds: [BAO_COURT_VOTE_REVEAL_KIND],
      authors,
      '#dispute': [dispute.disputeId],
      since,
    };

    const revealedEventsRef = { current: [] as NostrEvent[] };

    function computeTally() {
      const votes: JurorVote[] = [];
      const seen = new Set<number>();
      const addVote = (reveal: { idx: number; pubkey: string; outcome: string; salt: string }) => {
        if (seen.has(reveal.idx)) return;
        seen.add(reveal.idx);
        votes.push({
          idx: reveal.idx,
          pubkey: reveal.pubkey,
          commit: hashCommit(reveal.outcome, reveal.salt),
          reveal: { outcome: reveal.outcome, salt: reveal.salt },
        });
      };

      addVote({
        idx: myJurorIdx,
        pubkey: myPubkey,
        outcome: myReveal.outcome,
        salt: myReveal.salt,
      });

      for (const event of revealedEventsRef.current) {
        const parsed = parseVoteRevealEvent(event);
        if (!parsed || parsed.disputeId !== dispute.disputeId) continue;
        addVote({
          idx: parsed.jurorIdx,
          pubkey: parsed.pubkey,
          outcome: parsed.outcome,
          salt: parsed.salt,
        });
      }

      setTally(tallyVotes(votes));
    }

    async function handleEvent(event: NostrEvent) {
      if (event.pubkey === myPubkey) return;
      revealedEventsRef.current.push(event);
      computeTally();
    }

    (async () => {
      try {
        const initial = await relay.query([filter], { signal: controller.signal });
        for (const event of initial) {
          await handleEvent(event);
        }
        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          void handleEvent(msg[2]);
        }
      } catch {
        // Best-effort subscription.
      } finally {
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, [realMode, phase, user, myVoteReveal, peerPubkeys, dispute.disputeId, myJurorIdx]);

  const publishFrostCommitment = useCallback(async () => {
    if (!user || !myShareRef.current) return;
    setIsPending(true);
    try {
      const commit = frost.Lib.create_commit_pkg(myShareRef.current);
      frostCommitmentRef.current = commit;

      if (demoMode && demoSharesRef.current) {
        // Precompute the simulated peer commitments so the reveal and aggregate
        // steps use the exact same nonce set.
        demoFrostCommitsRef.current = demoSharesRef.current.map((share) =>
          frost.Lib.create_commit_pkg(share)
        );
      }

      const template = buildFrostCommitEvent({
        disputeId: dispute.disputeId,
        jurorIdx: myJurorIdx,
        commitmentPackage: {
          idx: commit.idx,
          binder_pn: commit.binder_pn,
          hidden_pn: commit.hidden_pn,
        },
      });
      await publishEvent(template);

      if (demoMode) {
        setPhase("signing");
      } else if (realMode) {
        if (!dkgRecordRef.current) return;
        const outcome = tally?.outcome ?? dispute.proposedOutcome;
        const session = new IndependentSigningSession({
          disputeId: dispute.disputeId,
          myIdx: myJurorIdx,
          myPubkey: user.pubkey,
          dkg: dkgRecordRef.current,
          outcome,
          round: 1,
          disputeEventId: (dispute as { rawEvent?: { id: string } }).rawEvent?.id ?? dispute.disputeId,
        });
        const { event } = session.createMyCommitment(myShareRef.current);
        independentSigningRef.current = session;
        await publishEvent(event);
        setSigningCounts((prev) => ({ ...prev, commitments: 1 }));
        setPhase("signing");
      }
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, myJurorIdx, demoMode, realMode, tally, publishEvent]);

  // Real-mode signing subscription: collect peer FROST commitments and reveals.
  useEffect(() => {
    if (!realMode || phase !== 'signing' || !independentSigningRef.current || !user) return;

    const session = independentSigningRef.current;
    const relay = openBaoCourtRelay();
    const controller = new AbortController();
    const since = Math.floor(Date.now() / 1000) - DKG_SUBSCRIPTION_SINCE_OFFSET_SECONDS;

    const filter: NostrFilter = {
      kinds: [BAO_COURT_FROST_COMMIT_KIND, BAO_COURT_FROST_REVEAL_KIND],
      authors: peerPubkeys,
      '#dispute': [dispute.disputeId],
      since,
    };

    let commitCount = 1; // our own commitment is already stored by createMyCommitment
    let revealCount = 0;

    function updateCounts() {
      setSigningCounts({
        commitments: commitCount,
        reveals: revealCount,
      });
    }

    async function handleEvent(event: NostrEvent) {
      if (event.kind === BAO_COURT_FROST_COMMIT_KIND) {
        const parsed = parseFrostCommitEvent(event);
        if (!parsed) return;
        if (session.addCommitment(parsed)) {
          commitCount += 1;
          updateCounts();
        }
      } else if (event.kind === BAO_COURT_FROST_REVEAL_KIND) {
        const parsed = parseFrostRevealEvent(event);
        if (!parsed) return;
        if (session.addReveal(parsed)) {
          revealCount += 1;
          updateCounts();
        }
      }
    }

    (async () => {
      try {
        const initial = await relay.query([filter], { signal: controller.signal });
        for (const event of initial) {
          await handleEvent(event);
        }
        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          void handleEvent(msg[2]);
        }
      } catch {
        // Best-effort subscription.
      } finally {
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, [realMode, phase, user, peerPubkeys, dispute.disputeId]);

  const publishFrostReveal = useCallback(async () => {
    if (!user || !myShareRef.current || !dkgRecordRef.current || !frostCommitmentRef.current) return;
    setIsPending(true);
    try {
      const outcome = tally?.outcome ?? dispute.proposedOutcome;
      const message = buildAttestationMessage(
        dispute.marketId,
        outcome,
        1,
        dispute.disputeId,
      );

      let allCommits: frost.CommitmentPackage[];
      if (demoMode) {
        if (!demoFrostCommitsRef.current) {
          throw new Error(
            "Demo FROST commitments are missing. Complete the commitment phase first.",
          );
        }
        allCommits = demoFrostCommitsRef.current;
      } else if (realMode) {
        if (!independentSigningRef.current) {
          throw new Error(
            "Real signing session has not started. Publish your FROST commitment first.",
          );
        }
        const { reveal, event } = independentSigningRef.current.createMyReveal(myShareRef.current);
        frostRevealRef.current = {
          idx: myJurorIdx,
          pubkey: reveal.pubkey,
          pnonce: reveal.pnonce,
          psig: reveal.psig,
        };
        await publishEvent(event);
        setSigningCounts((prev) => ({ ...prev, reveals: prev.reveals + 1 }));
        return;
      } else {
        throw new Error(
          "Cross-juror FROST reveal is not implemented: collect peer commitments before signing.",
        );
      }

      const ctx = frost.Lib.get_group_signing_ctx(
        dkgRecordRef.current.groupPubkey,
        allCommits,
        message,
      );
      const myCommit = frost.Lib.get_commit_pkg(allCommits, myShareRef.current);
      const sig = frost.Lib.sign_msg(ctx, myShareRef.current, myCommit);
      frostRevealRef.current = {
        idx: myJurorIdx,
        pubkey: sig.pubkey,
        pnonce: myCommit,
        psig: sig.psig,
      };
      const template = buildFrostRevealEvent({
        disputeId: dispute.disputeId,
        jurorIdx: myJurorIdx,
        publicNonce: {
          idx: myCommit.idx,
          binder_pn: myCommit.binder_pn,
          hidden_pn: myCommit.hidden_pn,
        },
        partialSig: sig.psig,
        frostPubkey: sig.pubkey,
      });
      await publishEvent(template);
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, tally, demoMode, realMode, myJurorIdx, publishEvent]);

  const aggregateAndPublishAttestation = useCallback(async () => {
    if (!user || !dkgRecordRef.current) return;
    setIsPending(true);
    try {
      if (demoMode) {
        if (!demoSharesRef.current) {
          throw new Error("Demo shares are missing. Complete the DKG phase first.");
        }
        const outcome = tally?.outcome ?? dispute.proposedOutcome;
        const attestation = runDisputeOverrideSigning({
          dispute,
          dkg: dkgRecordRef.current,
          shares: demoSharesRef.current,
          outcome,
        });
        setAttestation(attestation);
        const template = buildAttestationEvent({
          attestation,
          marketEventId: dispute.marketEventId ?? dispute.marketId,
        });
        await publishEvent(template);
        setPhase("attestation_published");
        return;
      }

      if (!realMode) {
        throw new Error(
          "Attestation aggregation in non-demo mode is not implemented; use the independent aggregator flow.",
        );
      }

      if (!independentSigningRef.current) {
        throw new Error("Real signing session has not started.");
      }

      const outcome = tally?.outcome ?? dispute.proposedOutcome;
      const session = independentSigningRef.current;
      if (session.outcome !== outcome) {
        // Outcome changed after the session started (e.g. a different vote won).
        // Recreate the signing session with the tallied outcome.
        independentSigningRef.current = new IndependentSigningSession({
          disputeId: dispute.disputeId,
          myIdx: myJurorIdx,
          myPubkey: user.pubkey,
          dkg: dkgRecordRef.current,
          outcome,
          round: 1,
          disputeEventId: (dispute as { rawEvent?: { id: string } }).rawEvent?.id ?? dispute.disputeId,
        });
      }

      const attestation = independentSigningRef.current.aggregate(
        dispute.marketEventId ?? dispute.marketId,
      );
      setAttestation(attestation);
      const template = buildAttestationEvent({
        attestation,
        marketEventId: dispute.marketEventId ?? dispute.marketId,
      });
      await publishEvent(template);
      setPhase("attestation_published");
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, tally, demoMode, realMode, myJurorIdx, publishEvent]);

  const advancePhase = useCallback((next: AppealPhase) => {
    setPhase(next);
  }, []);

  const state: JurorSessionState = useMemo(
    () => ({
      dispute,
      isSelected: myJurorIdx > 0,
      myJurorIdx,
      phase,
      selectedJurors,
      groupPubkey,
      groupPubkeyXOnly,
      myVoteCommit,
      myVoteReveal,
      tally,
      attestation,
    }),
    [
      dispute,
      myJurorIdx,
      phase,
      selectedJurors,
      groupPubkey,
      groupPubkeyXOnly,
      myVoteCommit,
      myVoteReveal,
      tally,
      attestation,
    ],
  );

  const actions: JurorSessionActions = useMemo(
    () => ({
      publishDkgCommitment,
      publishVoteCommit,
      publishVoteReveal,
      publishFrostCommitment,
      publishFrostReveal,
      aggregateAndPublishAttestation,
      advancePhase,
    }),
    [
      publishDkgCommitment,
      publishVoteCommit,
      publishVoteReveal,
      publishFrostCommitment,
      publishFrostReveal,
      aggregateAndPublishAttestation,
      advancePhase,
    ],
  );

  const progress: JurorSessionProgress = useMemo(
    () => ({
      dkgPhase,
      dkgCounts,
      signingCounts,
    }),
    [dkgPhase, dkgCounts, signingCounts],
  );

  return { state, actions, isPending, progress };
}
