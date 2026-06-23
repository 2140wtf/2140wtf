/**
 * Shared types for the BAO Court / Juror Mode FROST dispute module.
 *
 * This is a browser-compatible adaptation of the BAO Markets threshold-oracle
 * appeal logic. The default key generator uses a Pedersen-style distributed key
 * generation (DKG) protocol running entirely in the browser/app.
 */

export interface StakeCommitment {
  /** Amount the juror has actually locked for this dispute, in sats. */
  readonly amountSats: number;
  /** On-chain address / identifier where the bond is locked. */
  readonly bondAddress: string;
  /** Optional funding transaction id for the bond UTXO. */
  readonly bondTxid?: string;
  /** Optional output index for the bond UTXO. */
  readonly bondVout?: number;
  /** Unix seconds after which the bond may be reclaimed if not selected/used. */
  readonly deadlineSeconds?: number;
  /** Current lifecycle status of the commitment. */
  status: 'pending' | 'confirmed' | 'released' | 'slashed';
  /** When the commitment was first announced (unix seconds). */
  readonly committedAt?: number;
  /** When the commitment was released/slashed (unix seconds). */
  releasedAt?: number;
}

export interface JurorProfile {
  /** Public Nostr identity of the juror. */
  readonly nostrPubkey: string;
  /** Stake capacity in sats (used for selection weighting). */
  readonly stakeCapacitySats: number;
  /** Verifiable stake commitment for this specific dispute. Must be confirmed before selection. */
  readonly stakeCommitment: StakeCommitment;
  /** Web-of-Trust score (0-100). */
  readonly wotScore: number;
  /** Categories this juror accepts. */
  readonly categories: readonly string[];
  /** Account registration timestamp (unix seconds). */
  readonly registeredAt: number;
}

export interface SelectedJuror extends JurorProfile {
  /** Index assigned for FROST polynomials (1-based). */
  readonly idx: number;
  /** VRF priority score; lower is better. */
  readonly priority: number;
}

export interface FrostAttestation {
  /** Market identifier. */
  readonly marketId: string;
  /** Winning outcome string. */
  readonly outcome: string;
  /** BIP-340 Schnorr signature (R || z) in hex. */
  readonly signature: string;
  /** Public nonce R in hex. */
  readonly pubNonce: string;
  /** Aggregate public key P in hex (x-only). */
  readonly groupPubkey: string;
  /** Signed message digest in hex. */
  readonly message: string;
  /** Kind 89 (normal) or 39007 (dispute override). */
  readonly kind: 89 | 39007;
  /** Dispute event id if this is an override attestation. */
  readonly disputeEventId?: string;
}

export interface DkgRecord {
  readonly marketId: string;
  readonly disputeId: string;
  readonly threshold: number;
  readonly participants: number;
  /** 33-byte compressed secp256k1 group public key (used by FROST internals). */
  readonly groupPubkey: string;
  /** 32-byte x-only group public key (used for BIP-340 attestations / Taproot). */
  readonly groupPubkeyXOnly: string;
  readonly verificationShares: readonly { idx: number; pubkey: string }[];
  readonly jurorPubkeys: readonly string[];
}

export interface DisputeCase {
  readonly disputeId: string;
  readonly marketId: string;
  readonly marketEventId: string;
  readonly challengerPubkey: string;
  readonly respondentPubkey: string;
  readonly evidenceHashes: readonly string[];
  readonly proposedOutcome: string;
  readonly originalOutcome: string;
}

export interface AppealTimings {
  /** Seconds after market resolution during which a dispute may be filed. */
  readonly disputeWindowSeconds: number;
  /** Seconds for stake-backed jurors to opt in with a candidacy event. */
  readonly optInWindowSeconds: number;
  /** Seconds allowed for the coordinator to publish the selection event. */
  readonly selectionDeadlineSeconds: number;
  /** Seconds for selected jurors to complete the DKG ceremony. */
  readonly dkgWindowSeconds: number;
  /** Seconds for jurors to publish vote commits. */
  readonly voteCommitWindowSeconds: number;
  /** Seconds for jurors to publish vote reveals after commits. */
  readonly voteRevealWindowSeconds: number;
  /** Seconds for the FROST signing round (commit + reveal + aggregate). */
  readonly signingWindowSeconds: number;
  /** Seconds after attestation publication during which the winner may claim. */
  readonly claimWindowSeconds: number;
  /** Seconds after the opt-in window closes during which a failed selected jury may be reselected from backups. */
  readonly reselectionWindowSeconds: number;
  /** Minimum confirmations required on the Bitcoin block hash used as a seed. */
  readonly seedBlockConfirmations: number;
}

export type AppealPhase =
  | 'selection'
  | 'dkg'
  | 'vote-commit'
  | 'vote-reveal'
  | 'signing'
  | 'attestation_published';

export interface JurorVote {
  readonly idx: number;
  readonly pubkey: string;
  readonly commit: string;
  readonly reveal?: {
    readonly outcome: string;
    readonly salt: string;
  };
}

export interface JurorSessionState {
  readonly dispute: DisputeCase;
  /** Whether the current user is a selected juror in this dispute. */
  readonly isSelected: boolean;
  /** The current user's assigned juror index, if selected. */
  readonly myJurorIdx: number | null;
  readonly phase: AppealPhase;
  readonly selectedJurors: SelectedJuror[];
  readonly groupPubkey: string | null;
  readonly groupPubkeyXOnly: string | null;
  readonly myVoteCommit: string | null;
  readonly myVoteReveal: { outcome: string; salt: string } | null;
  readonly tally: { outcome: string; supportingVotes: JurorVote[] } | null;
  readonly attestation: FrostAttestation | null;
}
