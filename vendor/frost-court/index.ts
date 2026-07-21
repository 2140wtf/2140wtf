/**
 * @bao/frost-court — shared BAO Court / FROST threshold-oracle logic.
 */

export type {
  StakeCommitment,
  JurorProfile,
  SelectedJuror,
  FrostAttestation,
  DkgRecord,
  DisputeCase,
  AppealTimings,
  AppealPhase,
  JurorVote,
  JurorSessionState,
  EncryptedVssShare,
  DkgComplaint,
  DkgComplaintDefense,
  EncryptedShareBackup,
  RefreshCommitment,
  EncryptedRefreshShare,
  IndependentDkgState,
  IndependentSigningState,
} from './types';

export {
  randomHex32,
  randomScalar,
  scalarToHex,
  deriveXOnlyPubkey,
  buildAttestationMessage,
  aggregatePublicNonce,
  verifyFinalSignature,
  verifySchnorr,
  createProofOfKnowledge,
  verifyProofOfKnowledge,
  frost,
} from './crypto';
export type { PublicNonce, DkgProofOfKnowledge } from './crypto';

export {
  PedersenDkgAdapter,
  generateFrostKeys,
  evaluatePoly,
  evaluateCommitments,
  evaluateRefreshCommitments,
  mergeRefreshCommitments,
  modN,
  pointToXOnlyHex,
  verifyVssShare,
  verifyRefreshShare,
  combineShares,
  type DkgAdapter,
  type KeygenParams,
  type KeygenResult,
  type RefreshParams,
  type RefreshResult,
  type PedersenDkgOptions,
  type ParticipantState,
} from './dkg';

export {
  createCommitments,
  createCommitment,
  createRevealsAndPartialSigs,
  createRevealAndPartialSig,
  aggregateAttestation,
  runNormalSigningRound,
  InMemoryNonceGuard,
  LocalStorageNonceGuard,
  createDefaultNonceGuard,
  type SigningCommitment,
  type SigningReveal,
  type SigningRoundParams,
  type NonceGuard,
} from './signing';

export {
  hashCommit,
  tallyVotes,
  deriveDisputeGroupPubkey,
  runDisputeOverrideSigning,
  type DisputeSigningParams,
} from './dispute';

export {
  BAO_COURT_DISPUTE_KIND,
  BAO_COURT_JUROR_CANDIDACY_KIND,
  BAO_COURT_SELECTION_KIND,
  BAO_COURT_DKG_COMMITMENT_KIND,
  BAO_COURT_VOTE_COMMIT_KIND,
  BAO_COURT_VOTE_REVEAL_KIND,
  BAO_COURT_FROST_COMMIT_KIND,
  BAO_COURT_FROST_REVEAL_KIND,
  BAO_COURT_ATTESTATION_KIND,
  buildDisputeEvent,
  buildJurorCandidacyEvent,
  buildSelectionEvent,
  buildDkgCommitmentEvent,
  buildVoteCommitEvent,
  buildVoteRevealEvent,
  buildFrostCommitEvent,
  buildFrostRevealEvent,
  buildDisputeAttestationEvent,
  buildAttestationEvent,
  parseAttestationEvent,
  parseJurorCandidacyEvent,
  parseSelectionEvent,
  parseDkgCommitmentEvent,
  parseVoteCommitEvent,
  parseVoteRevealEvent,
  validateSelectionEvent,
  type SelectedJurorEntry,
  type SelectionValidationResult,
} from './events';

export {
  wrapProtocolEvent,
  unwrapProtocolEvent,
  unwrapProtocolEvents,
  getPubkeyFromSeckey,
} from './nip59';

export {
  buildEncryptedShareEvent,
  buildDkgComplaintEvent,
  buildShareBackupEvent,
  buildRefreshCommitmentEvent,
  buildEncryptedRefreshShareEvent,
  parseEncryptedShareEvent,
  parseDkgComplaintEvent,
  parseShareBackupEvent,
  parseRefreshCommitmentEvent,
  parseEncryptedRefreshShareEvent,
  BAO_COURT_ENCRYPTED_SHARE_KIND as ENCRYPTED_SHARE_KIND,
  BAO_COURT_DKG_COMPLAINT_KIND as DKG_COMPLAINT_KIND,
  BAO_COURT_SHARE_BACKUP_KIND as SHARE_BACKUP_KIND,
  BAO_COURT_REFRESH_COMMITMENT_KIND as REFRESH_COMMITMENT_KIND,
  BAO_COURT_REFRESH_SHARE_KIND as REFRESH_SHARE_KIND,
} from './dkgMessages';

export {
  IndependentDkgSession,
  type IndependentDkgOptions,
} from './independentDkg';

export {
  Nip44SeckeyCrypto,
  type Nip44Crypto,
} from './nip44Crypto';

export {
  IndependentSigningSession,
  type IndependentSigningOptions,
  type IndependentSigningSnapshot,
  type SigningSnapshotCommitment,
  type SigningSnapshotReveal,
} from './independentSigning';

export {
  verifyBond,
  computeRequiredBond,
  createBaoMempoolVerifier,
  createEsploraVerifier,
  type UtxoInfo,
  type BondVerificationResult,
  type BondVerifier,
  type VerifyBondOptions,
} from './bondVerification';

export {
  deriveSelectionSeed,
  jurorRandomValue,
  quadraticPriority,
  filterEligibleJurors,
  selectJury,
  selectJuryWithBackups,
  verifyJurySelection,
  type SelectionParams,
  type JuryWithBackups,
} from './selection';

export {
  validateAttestationEvent,
  verifyRawSignature,
  type ValidationResult,
} from './validator';
