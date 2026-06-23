import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as frost from "@vbyte/frost";
import { secp256k1 } from "@noble/curves/secp256k1.js";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";

import {
  buildDkgCommitmentEvent,
  buildVoteCommitEvent,
  buildVoteRevealEvent,
  buildFrostCommitEvent,
  buildFrostRevealEvent,
  buildAttestationEvent,
  generateFrostKeys,
  runDisputeOverrideSigning,
  hashCommit,
  tallyVotes,
  randomHex32,
  randomScalar,
  buildAttestationMessage,
  type DisputeCase,
  type SelectedJuror,
  type AppealPhase,
  type JurorSessionState,
  type JurorVote,
  type DkgRecord,
  type FrostAttestation,
} from "@/lib/bao-court";

export interface UseJurorSessionOptions {
  readonly dispute: DisputeCase;
  readonly selectedJurors: SelectedJuror[];
  readonly myJurorIdx: number;
  readonly demoMode: boolean;
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

interface LocalPolynomial {
  readonly idx: number;
  readonly pubkey: string;
  readonly coeffs: bigint[];
  readonly commitments: string[];
}

function createLocalPolynomial(idx: number, pubkey: string, threshold: number): LocalPolynomial {
  const Point = secp256k1.Point;
  const coeffs: bigint[] = Array.from({ length: threshold }, () => randomScalar());
  const commitments = coeffs.map((a) => Point.BASE.multiply(a).toHex(true));
  return { idx, pubkey, coeffs, commitments };
}

function deriveThreshold(jurorCount: number): number {
  if (jurorCount >= 5) return 3;
  if (jurorCount >= 3) return 2;
  return Math.max(2, jurorCount);
}

export function useJurorSession(
  options: UseJurorSessionOptions,
): { state: JurorSessionState; actions: JurorSessionActions; isPending: boolean } {
  const { dispute, selectedJurors, myJurorIdx, demoMode } = options;
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();

  const [phase, setPhase] = useState<AppealPhase>("selection");
  const [groupPubkey, setGroupPubkey] = useState<string | null>(null);
  const [groupPubkeyXOnly, setGroupPubkeyXOnly] = useState<string | null>(null);
  const [myVoteCommit, setMyVoteCommit] = useState<string | null>(null);
  const [myVoteReveal, setMyVoteReveal] = useState<{ outcome: string; salt: string } | null>(null);
  const [tally, setTally] = useState<{ outcome: string; supportingVotes: JurorVote[] } | null>(null);
  const [attestation, setAttestation] = useState<FrostAttestation | null>(null);
  const [isPending, setIsPending] = useState(false);

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
    localPolyRef.current = null;
    dkgRecordRef.current = null;
    demoSharesRef.current = null;
    myShareRef.current = null;
    frostCommitmentRef.current = null;
    demoFrostCommitsRef.current = null;
    frostRevealRef.current = null;
  }, [dispute.disputeId]);

  // Generate this juror's local Pedersen polynomial once they enter the
  // selection phase. The coefficients live only in this ref / session memory.
  useEffect(() => {
    if (!user || phase !== "selection" || myJurorIdx < 1 || localPolyRef.current) return;
    localPolyRef.current = createLocalPolynomial(myJurorIdx, user.pubkey, threshold);
  }, [user, phase, myJurorIdx, threshold]);

  const publishDkgCommitment = useCallback(async () => {
    if (!user || !localPolyRef.current) return;
    setIsPending(true);
    try {
      const template = buildDkgCommitmentEvent({
        disputeId: dispute.disputeId,
        jurorIdx: myJurorIdx,
        jurorPubkey: user.pubkey,
        vssCommits: localPolyRef.current.commitments,
      });
      await publishEvent(template);

      if (demoMode) {
        // Run the full DKG locally so the GUI can proceed without peer jurors.
        const { record, shares } = generateFrostKeys({
          marketId: dispute.marketId,
          disputeId: dispute.disputeId,
          threshold,
          jurors: selectedJurors,
        });
        dkgRecordRef.current = record;
        demoSharesRef.current = shares;
        myShareRef.current = shares.find((s) => s.idx === myJurorIdx) ?? null;
        setGroupPubkey(record.groupPubkey);
        setGroupPubkeyXOnly(record.groupPubkeyXOnly);
        setPhase("dkg");
      }
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, myJurorIdx, demoMode, threshold, selectedJurors, publishEvent]);

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
      }
    } finally {
      setIsPending(false);
    }
  }, [user, myVoteReveal, dispute.disputeId, myJurorIdx, demoMode, selectedJurors, publishEvent]);

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
      if (demoMode) setPhase("signing");
    } finally {
      setIsPending(false);
    }
  }, [user, dispute.disputeId, myJurorIdx, demoMode, publishEvent]);

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
      } else {
        // Real ceremonies require the juror to collect all peer commitments
        // (e.g. from kind 39005 events) before producing a partial signature.
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
      });
      await publishEvent(template);
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, tally, demoMode, myJurorIdx, publishEvent]);

  const aggregateAndPublishAttestation = useCallback(async () => {
    if (!user || !dkgRecordRef.current) return;
    setIsPending(true);
    try {
      if (!demoMode) {
        // Real ceremonies perform aggregation through a coordinator that has
        // collected threshold partial signatures from the selected jurors.
        throw new Error(
          "Attestation aggregation in non-demo mode is not implemented; it requires a coordinator.",
        );
      }
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
        marketEventId: dispute.marketEventId,
      });
      await publishEvent(template);
      setPhase("attestation_published");
    } finally {
      setIsPending(false);
    }
  }, [user, dispute, tally, demoMode, publishEvent]);

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

  return { state, actions, isPending };
}
