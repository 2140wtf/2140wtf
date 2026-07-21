/**
 * Independent-juror Pedersen DKG session.
 *
 * Each juror runs this class locally. It produces the juror's own polynomial
 * commitments and encrypted shares, collects peer commitments/shares, verifies
 * them, handles complaints, and computes the final group public key and the
 * juror's FROST secret share.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as frost from '@vbyte/frost';
import { randomScalar, scalarToHex, createProofOfKnowledge, verifyProofOfKnowledge, deriveXOnlyPubkey } from './crypto';
import { buildDkgCommitmentEvent } from './events';
import { Nip44SeckeyCrypto, type Nip44Crypto } from './nip44Crypto';
import {
  buildEncryptedRefreshShareEvent,
  buildEncryptedShareEvent,
  buildRefreshCommitmentEvent,
  buildShareBackupEvent,
} from './dkgMessages';
import type {
  DkgComplaint,
  DkgRecord,
  EncryptedRefreshShare,
  EncryptedShareBackup,
  EncryptedVssShare,
  RefreshCommitment,
  SelectedJuror,
} from './types';
import {
  evaluateCommitments,
  evaluatePoly,
  mergeRefreshCommitments,
  modN,
  pointToXOnlyHex,
  verifyRefreshShare,
  verifyVssShare,
} from './dkg';

const Point = secp256k1.Point;
type CurvePoint = InstanceType<typeof Point>;

interface LocalPolynomial {
  readonly coeffs: bigint[];
  readonly commitments: CurvePoint[];
  readonly commitmentHexes: string[];
  readonly pok: ReturnType<typeof createProofOfKnowledge>;
}

interface PeerCommitment {
  readonly idx: number;
  readonly pubkey: string;
  readonly threshold: number;
  readonly commits: CurvePoint[];
  readonly commitHexes: readonly string[];
  readonly pok: { nonce: string; response: string };
  readonly phaseNonce: string;
  readonly eventId?: string;
  readonly receivedAt: number;
}

interface PeerRefreshCommitment {
  readonly idx: number;
  readonly pubkey: string;
  readonly threshold: number;
  readonly commits: CurvePoint[];
  readonly commitHexes: readonly string[];
  readonly phaseNonce: string;
  readonly eventId?: string;
  readonly receivedAt: number;
}

interface LocalRefreshPackage {
  readonly shares: frost.SecretShare[];
  readonly commits: CurvePoint[];
  readonly commitHexes: readonly string[];
}

export interface IndependentDkgOptions {
  readonly disputeId: string;
  readonly marketId?: string;
  readonly myIdx: number;
  readonly myPubkey: string;
  /** Nostr private key as 32-byte hex string or Uint8Array. */
  readonly mySeckey?: string | Uint8Array;
  /** External NIP-44 crypto provider (e.g. browser extension or NIP-46 bunker). */
  readonly nip44?: Nip44Crypto;
  readonly threshold: number;
  readonly jurors: readonly SelectedJuror[];
}

export class IndependentDkgSession {
  readonly disputeId: string;
  readonly marketId: string;
  readonly myIdx: number;
  readonly myPubkey: string;
  readonly threshold: number;
  readonly jurors: readonly SelectedJuror[];

  private readonly nip44: Nip44Crypto;
  private localPoly: LocalPolynomial | null = null;
  private readonly commitments = new Map<number, PeerCommitment>();
  private readonly encryptedShares = new Map<number, EncryptedVssShare>();
  private readonly decryptedShares = new Map<number, string>();
  /** Expected phase nonce for each peer, learned from their commitment event. */
  private readonly phaseNonces = new Map<number, string>();
  private readonly complaints: DkgComplaint[] = [];
  private readonly disqualified = new Set<number>();
  private computedGroupKey: { compressed: string; xOnly: string } | null = null;
  private computedShare: frost.SecretShare | null = null;
  private computedRecord: DkgRecord | null = null;

  private refreshLocalPkg: LocalRefreshPackage | null = null;
  private readonly refreshCommitments = new Map<number, PeerRefreshCommitment>();
  private readonly refreshPhaseNonces = new Map<number, string>();
  private readonly encryptedRefreshShares = new Map<number, EncryptedRefreshShare>();
  private readonly decryptedRefreshShares = new Map<number, string>();

  constructor(options: IndependentDkgOptions) {
    this.disputeId = options.disputeId;
    this.marketId = options.marketId ?? '';
    this.myIdx = options.myIdx;
    this.myPubkey = options.myPubkey;
    this.threshold = options.threshold;
    this.jurors = options.jurors;

    const hasSeckey = options.mySeckey !== undefined;
    const hasNip44 = options.nip44 !== undefined;
    if (hasSeckey === hasNip44) {
      throw new Error('Provide exactly one of mySeckey or nip44');
    }
    this.nip44 = options.nip44 ?? new Nip44SeckeyCrypto(options.mySeckey!);
  }

  private get domain(): string {
    return `market=${this.marketId}|dispute=${this.disputeId}|juror=${this.myIdx}`;
  }

  private proofDomain(idx: number): string {
    return `market=${this.marketId}|dispute=${this.disputeId}|juror=${idx}`;
  }

  private getJuror(idx: number): SelectedJuror | undefined {
    return this.jurors.find((j) => j.idx === idx);
  }

  /**
   * Generate this juror's local polynomial and produce:
   *  - the public DKG commitment event (kind 38031)
   *  - encrypted share events (kind 39003) for every peer juror
   */
  async generateCommitmentAndShares(): Promise<{
    commitmentEvent: ReturnType<typeof buildDkgCommitmentEvent>;
    shareEvents: ReturnType<typeof buildEncryptedShareEvent>[];
  }> {
    const coeffs = Array.from({ length: this.threshold }, () => randomScalar());
    const commitments = coeffs.map((a) => Point.BASE.multiply(a));
    const commitmentHexes = commitments.map((c) => c.toHex(true));
    const pok = createProofOfKnowledge(
      scalarToHex(coeffs[0]),
      commitments[0].toHex(true),
      this.domain,
    );
    this.localPoly = { coeffs, commitments, commitmentHexes, pok };

    const phaseNonce = crypto.randomUUID ? crypto.randomUUID() : scalarToHex(randomScalar());
    const commitmentEvent = buildDkgCommitmentEvent({
      disputeId: this.disputeId,
      jurorIdx: this.myIdx,
      jurorPubkey: this.myPubkey,
      threshold: this.threshold,
      vssCommits: commitmentHexes,
      pok,
      phaseNonce,
    });

    const shareEvents: ReturnType<typeof buildEncryptedShareEvent>[] = [];
    for (const j of this.jurors) {
      if (j.idx === this.myIdx) continue;
      const share = evaluatePoly(coeffs, BigInt(j.idx));
      const shareHex = scalarToHex(share);
      const encryptedShare = await this.nip44.encrypt(shareHex, j.nostrPubkey);
      const payload: EncryptedVssShare = {
        disputeId: this.disputeId,
        fromIdx: this.myIdx,
        fromPubkey: this.myPubkey,
        toIdx: j.idx,
        toPubkey: j.nostrPubkey,
        encryptedShare,
        phaseNonce,
      };
      shareEvents.push(buildEncryptedShareEvent(payload));
    }

    return { commitmentEvent, shareEvents };
  }

  /**
   * Add a peer's public DKG commitment event.
   */
  addCommitment(event: {
    readonly idx: number;
    readonly pubkey: string;
    readonly threshold: number;
    readonly vssCommits: readonly string[];
    readonly pok: { nonce: string; response: string };
    readonly phaseNonce: string;
    readonly eventId?: string;
  }): boolean {
    if (this.disqualified.has(event.idx)) return false;
    if (event.threshold !== this.threshold) return false;
    if (event.vssCommits.length !== this.threshold) return false;
    try {
      const commits = event.vssCommits.map((c) => Point.fromHex(c));
      if (commits.length === 0) return false;
      if (!verifyProofOfKnowledge(commits[0].toHex(true), event.pok, this.proofDomain(event.idx))) {
        return false;
      }
      this.commitments.set(event.idx, {
        idx: event.idx,
        pubkey: event.pubkey,
        threshold: event.threshold,
        commits,
        commitHexes: event.vssCommits,
        pok: event.pok,
        phaseNonce: event.phaseNonce,
        eventId: event.eventId,
        receivedAt: Math.floor(Date.now() / 1000),
      });
      this.phaseNonces.set(event.idx, event.phaseNonce);
      // If a share already arrived with a mismatched phase nonce, the sender is
      // replaying or inconsistent; disqualify them.
      const existingShare = this.encryptedShares.get(event.idx);
      if (existingShare && existingShare.phaseNonce !== event.phaseNonce) {
        this.disqualified.add(event.idx);
        this.encryptedShares.delete(event.idx);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add an encrypted share addressed to this juror.
   */
  addEncryptedShare(payload: EncryptedVssShare): boolean {
    if (payload.toIdx !== this.myIdx) return false;
    if (payload.disputeId !== this.disputeId) return false;
    const expected = this.phaseNonces.get(payload.fromIdx);
    if (expected !== undefined && payload.phaseNonce !== expected) {
      // Replay or wrong DKG round.
      this.disqualified.add(payload.fromIdx);
      return false;
    }
    this.encryptedShares.set(payload.fromIdx, payload);
    return true;
  }

  /**
   * Decrypt all received shares using the configured NIP-44 crypto provider.
   */
  async decryptShares(): Promise<void> {
    for (const [fromIdx, payload] of this.encryptedShares) {
      if (this.decryptedShares.has(fromIdx)) continue;
      const fromJuror = this.getJuror(fromIdx);
      if (!fromJuror) continue;
      try {
        const shareHex = await this.nip44.decrypt(payload.encryptedShare, fromJuror.nostrPubkey);
        this.decryptedShares.set(fromIdx, shareHex);
      } catch {
        // Decryption failed; leave absent so it can become a complaint.
      }
    }
  }

  /**
   * Verify all decrypted shares against peer commitments.
   * Returns complaints for any share that fails verification.
   */
  verifyShares(commitmentEventIds: Record<number, string>): DkgComplaint[] {
    const newComplaints: DkgComplaint[] = [];

    for (const [fromIdx, shareHex] of this.decryptedShares) {
      if (this.disqualified.has(fromIdx)) continue;
      const peer = this.commitments.get(fromIdx);
      if (!peer) continue;
      const valid = verifyVssShare(this.myIdx, shareHex, peer.commitHexes);
      if (!valid) {
        newComplaints.push({
          disputeId: this.disputeId,
          accusedIdx: fromIdx,
          accusedPubkey: peer.pubkey,
          victimIdx: this.myIdx,
          victimPubkey: this.myPubkey,
          revealedShare: shareHex,
          commitmentEventId: commitmentEventIds[fromIdx] ?? '',
        });
      }
    }

    return newComplaints;
  }

  /**
   * Register a public complaint.
   */
  addComplaint(complaint: DkgComplaint): void {
    if (complaint.disputeId !== this.disputeId) return;
    this.complaints.push(complaint);
  }

  /**
   * Resolve registered complaints: any accused whose revealed share fails
   * verification against their public commitments is disqualified.
   * False complaints are not handled here; they are adjudicated by the accused
   * publishing a defense or by the slashing backend.
   */
  resolveComplaints(): void {
    for (const complaint of this.complaints) {
      if (complaint.defense) {
        // If the accused defended with a valid share, the complaint is false.
        const peer = this.commitments.get(complaint.accusedIdx);
        if (peer && verifyVssShare(complaint.victimIdx, complaint.defense.validShare, peer.commitHexes)) {
          // Complaint is false; the complainer could be slashed by the backend.
          continue;
        }
      }
      const peer = this.commitments.get(complaint.accusedIdx);
      if (!peer) {
        this.disqualified.add(complaint.accusedIdx);
        continue;
      }
      const valid = verifyVssShare(
        complaint.victimIdx,
        complaint.revealedShare,
        peer.commitHexes,
      );
      if (!valid) {
        this.disqualified.add(complaint.accusedIdx);
      }
    }
  }

  /**
   * Check whether enough qualified commitments/shares exist to compute the key.
   */
  canComputeKey(): boolean {
    const qualified = this.jurors.filter(
      (j) =>
        !this.disqualified.has(j.idx) &&
        (j.idx === this.myIdx || this.decryptedShares.has(j.idx)),
    );
    return qualified.length >= this.threshold;
  }

  /**
   * Compute the group public key and this juror's secret share.
   */
  computeKey(): DkgRecord {
    if (this.computedRecord) return this.computedRecord;
    if (!this.localPoly) {
      throw new Error('Local polynomial not generated');
    }

    const qualifiedJurors = this.jurors.filter((j) => !this.disqualified.has(j.idx));
    if (qualifiedJurors.length < this.threshold) {
      throw new Error(
        `DKG failed: only ${qualifiedJurors.length} qualified jurors, threshold is ${this.threshold}`,
      );
    }

    const qualifiedCommits = qualifiedJurors
      .map((j) => (j.idx === this.myIdx
        ? { idx: j.idx, pubkey: j.nostrPubkey, commits: this.localPoly!.commitments }
        : this.commitments.get(j.idx)))
      .filter((c): c is { idx: number; pubkey: string; commits: CurvePoint[] } => !!c);

    const groupPoint = qualifiedCommits.reduce(
      (sum, c) => sum.add(c.commits[0]),
      Point.ZERO,
    );

    // My share = sum of all qualified polynomials evaluated at my index.
    const myShareScalar = qualifiedJurors.reduce((sum, j) => {
      if (j.idx === this.myIdx) {
        return modN(sum + evaluatePoly(this.localPoly!.coeffs, BigInt(this.myIdx)));
      }
      const shareHex = this.decryptedShares.get(j.idx);
      if (!shareHex) throw new Error(`Missing decrypted share from juror ${j.idx}`);
      return modN(sum + BigInt('0x' + shareHex));
    }, 0n);

    const verificationShares = qualifiedJurors.map((j) => {
      const idx = BigInt(j.idx);
      const pubkeyPoint = qualifiedCommits.reduce(
        (sum, c) => sum.add(evaluateCommitments(c.commits, idx)),
        Point.ZERO,
      );
      return { idx: j.idx, pubkey: pointToXOnlyHex(pubkeyPoint) };
    });

    const vssCommitments = qualifiedCommits.map((c) => ({
      idx: c.idx,
      pubkey: c.pubkey,
      commits: c.commits.map((p) => p.toHex(true)),
    }));

    const groupPubkey = groupPoint.toHex(true);
    const groupPubkeyXOnly = pointToXOnlyHex(groupPoint);

    const myVerification = verificationShares.find((v) => v.idx === this.myIdx);
    if (myVerification) {
      const derived = Point.BASE.multiply(myShareScalar).toHex(true).slice(2);
      if (derived !== myVerification.pubkey) {
        throw new Error('Computed share does not match verification share');
      }
    }

    this.computedGroupKey = { compressed: groupPubkey, xOnly: groupPubkeyXOnly };
    this.computedShare = { idx: this.myIdx, seckey: scalarToHex(myShareScalar) };
    this.computedRecord = {
      marketId: this.marketId,
      disputeId: this.disputeId,
      threshold: this.threshold,
      participants: qualifiedJurors.length,
      groupPubkey,
      groupPubkeyXOnly,
      verificationShares,
      jurorPubkeys: qualifiedJurors.map((j) => j.nostrPubkey),
      vssCommitments,
    };

    return this.computedRecord;
  }

  getShare(): frost.SecretShare {
    if (!this.computedShare) {
      throw new Error('Key not computed yet');
    }
    return this.computedShare;
  }

  getRecord(): DkgRecord {
    if (!this.computedRecord) {
      throw new Error('Key not computed yet');
    }
    return this.computedRecord;
  }

  /**
   * Restore this juror's share from a Kind 39100 self-backup.
   *
   * Validates the decrypted share against the backup's verification shares and,
   * if valid, populates the computed share/record so the session can sign.
   */
  async restoreFromBackup(backup: EncryptedShareBackup): Promise<boolean> {
    if (backup.disputeId !== this.disputeId) return false;
    if (backup.jurorIdx !== this.myIdx) return false;
    if (backup.jurorPubkey !== this.myPubkey) return false;
    if (this.computedRecord) return false;

    try {
      const shareHex = await this.nip44.decrypt(backup.encryptedShare, this.myPubkey);

      const expected = backup.verificationShares.find((v) => v.idx === this.myIdx);
      if (!expected) return false;
      if (deriveXOnlyPubkey(shareHex) !== expected.pubkey) {
        return false;
      }

      const threshold = backup.vssCommitments[0]?.commits.length ?? 0;
      this.computedShare = { idx: this.myIdx, seckey: shareHex };
      this.computedRecord = {
        marketId: this.marketId,
        disputeId: this.disputeId,
        threshold,
        participants: backup.verificationShares.length,
        groupPubkey: backup.groupPubkey,
        groupPubkeyXOnly: backup.groupPubkey.slice(2),
        verificationShares: backup.verificationShares,
        jurorPubkeys: backup.vssCommitments.map((c) => c.pubkey),
        vssCommitments: backup.vssCommitments,
      };
      this.computedGroupKey = {
        compressed: backup.groupPubkey,
        xOnly: backup.groupPubkey.slice(2),
      };
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build the encrypted self-backup payload for this juror's share.
   */
  async buildBackupPayload(encryptToPubkey: string): Promise<{
    backup: EncryptedShareBackup;
    backupEvent: ReturnType<typeof buildShareBackupEvent>;
  }> {
    if (!this.computedShare || !this.computedRecord) {
      throw new Error('Key not computed yet');
    }

    const encryptedShare = await this.nip44.encrypt(this.computedShare.seckey, encryptToPubkey);

    const backup: EncryptedShareBackup = {
      disputeId: this.disputeId,
      jurorIdx: this.myIdx,
      jurorPubkey: this.myPubkey,
      encryptedShare,
      groupPubkey: this.computedRecord.groupPubkey,
      verificationShares: this.computedRecord.verificationShares,
      vssCommitments: this.computedRecord.vssCommitments,
    };

    return { backup, backupEvent: buildShareBackupEvent(backup) };
  }

  /**
   * Generate this juror's refresh polynomial and produce:
   *  - the public refresh commitment event (kind 38033)
   *  - encrypted refresh share events (kind 39013) for every peer juror
   *
   * Refresh polynomials have a zero constant term, so the group public key is
   * preserved. This method must be called after `computeKey()`.
   */
  async generateRefreshCommitmentAndShares(): Promise<{
    commitmentEvent: ReturnType<typeof buildRefreshCommitmentEvent>;
    shareEvents: ReturnType<typeof buildEncryptedRefreshShareEvent>[];
  }> {
    if (!this.computedRecord || !this.computedShare) {
      throw new Error('DKG key must be computed before refresh');
    }

    const pkg = frost.Lib.gen_refresh_shares(
      this.myIdx,
      this.threshold,
      this.jurors.length,
    );
    this.refreshLocalPkg = {
      shares: pkg.shares,
      commits: pkg.vss_commits.map((c) => Point.fromHex(c)),
      commitHexes: pkg.vss_commits,
    };

    const phaseNonce = crypto.randomUUID ? crypto.randomUUID() : scalarToHex(randomScalar());
    const commitmentEvent = buildRefreshCommitmentEvent({
      disputeId: this.disputeId,
      jurorIdx: this.myIdx,
      jurorPubkey: this.myPubkey,
      threshold: this.threshold,
      vssCommits: pkg.vss_commits,
      phaseNonce,
    });

    const shareEvents: ReturnType<typeof buildEncryptedRefreshShareEvent>[] = [];
    for (const j of this.jurors) {
      if (j.idx === this.myIdx) continue;
      const share = frost.Lib.get_share(pkg.shares, j.idx);
      const encryptedShare = await this.nip44.encrypt(share.seckey, j.nostrPubkey);
      const payload: EncryptedRefreshShare = {
        disputeId: this.disputeId,
        fromIdx: this.myIdx,
        fromPubkey: this.myPubkey,
        toIdx: j.idx,
        toPubkey: j.nostrPubkey,
        encryptedShare,
        phaseNonce,
      };
      shareEvents.push(buildEncryptedRefreshShareEvent(payload));
    }

    return { commitmentEvent, shareEvents };
  }

  /**
   * Add a peer's public refresh commitment event.
   */
  addRefreshCommitment(event: {
    readonly idx: number;
    readonly pubkey: string;
    readonly threshold: number;
    readonly vssCommits: readonly string[];
    readonly phaseNonce: string;
    readonly eventId?: string;
  }): boolean {
    if (this.disqualified.has(event.idx)) return false;
    if (event.threshold !== this.threshold) return false;
    if (event.vssCommits.length !== this.threshold - 1) return false;
    try {
      const commits = event.vssCommits.map((c) => Point.fromHex(c));
      if (commits.length === 0) return false;
      this.refreshCommitments.set(event.idx, {
        idx: event.idx,
        pubkey: event.pubkey,
        threshold: event.threshold,
        commits,
        commitHexes: event.vssCommits,
        phaseNonce: event.phaseNonce,
        eventId: event.eventId,
        receivedAt: Math.floor(Date.now() / 1000),
      });
      this.refreshPhaseNonces.set(event.idx, event.phaseNonce);
      const existingShare = this.encryptedRefreshShares.get(event.idx);
      if (existingShare && existingShare.phaseNonce !== event.phaseNonce) {
        this.disqualified.add(event.idx);
        this.encryptedRefreshShares.delete(event.idx);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add an encrypted refresh share addressed to this juror.
   */
  addEncryptedRefreshShare(payload: EncryptedRefreshShare): boolean {
    if (payload.toIdx !== this.myIdx) return false;
    if (payload.disputeId !== this.disputeId) return false;
    const expected = this.refreshPhaseNonces.get(payload.fromIdx);
    if (expected !== undefined && payload.phaseNonce !== expected) {
      this.disqualified.add(payload.fromIdx);
      return false;
    }
    this.encryptedRefreshShares.set(payload.fromIdx, payload);
    return true;
  }

  /**
   * Decrypt all received refresh shares using the configured NIP-44 crypto provider.
   */
  async decryptRefreshShares(): Promise<void> {
    for (const [fromIdx, payload] of this.encryptedRefreshShares) {
      if (this.decryptedRefreshShares.has(fromIdx)) continue;
      const fromJuror = this.getJuror(fromIdx);
      if (!fromJuror) continue;
      try {
        const shareHex = await this.nip44.decrypt(payload.encryptedShare, fromJuror.nostrPubkey);
        this.decryptedRefreshShares.set(fromIdx, shareHex);
      } catch {
        // Decryption failed; leave absent so it can become a complaint.
      }
    }
  }

  /**
   * Verify all decrypted refresh shares against peer refresh commitments.
   * Returns complaints for any share that fails verification.
   */
  verifyRefreshShares(commitmentEventIds: Record<number, string>): DkgComplaint[] {
    const newComplaints: DkgComplaint[] = [];

    for (const [fromIdx, shareHex] of this.decryptedRefreshShares) {
      if (this.disqualified.has(fromIdx)) continue;
      const peer = this.refreshCommitments.get(fromIdx);
      if (!peer) continue;
      const valid = verifyRefreshShare(this.myIdx, shareHex, peer.commitHexes);
      if (!valid) {
        newComplaints.push({
          disputeId: this.disputeId,
          accusedIdx: fromIdx,
          accusedPubkey: peer.pubkey,
          victimIdx: this.myIdx,
          victimPubkey: this.myPubkey,
          revealedShare: shareHex,
          commitmentEventId: commitmentEventIds[fromIdx] ?? '',
        });
      }
    }

    return newComplaints;
  }

  /**
   * Combine the existing key with all verified refresh shares.
   * Returns an updated DkgRecord whose verification shares reflect the refresh.
   */
  computeRefreshedKey(): DkgRecord {
    if (!this.computedRecord || !this.computedShare) {
      throw new Error('DKG key not computed');
    }
    if (!this.refreshLocalPkg) {
      throw new Error('Refresh commitment not generated');
    }

    const qualifiedJurors = this.jurors.filter((j) => !this.disqualified.has(j.idx));
    if (qualifiedJurors.length < this.threshold) {
      throw new Error(
        `Refresh failed: only ${qualifiedJurors.length} qualified jurors, threshold is ${this.threshold}`,
      );
    }

    const qualifiedRefreshCommits = qualifiedJurors
      .map((j) =>
        j.idx === this.myIdx
          ? {
              idx: j.idx,
              pubkey: j.nostrPubkey,
              commits: this.refreshLocalPkg!.commits,
              commitHexes: this.refreshLocalPkg!.commitHexes,
            }
          : this.refreshCommitments.get(j.idx),
      )
      .filter(
        (
          c,
        ): c is {
          idx: number;
          pubkey: string;
          commits: CurvePoint[];
          commitHexes: readonly string[];
        } => !!c,
      );

    if (qualifiedRefreshCommits.length < qualifiedJurors.length) {
      throw new Error('Missing refresh commitments from qualified jurors');
    }

    // Build refresh shares addressed to this juror, including our own.
    const myRefreshShares = qualifiedJurors.map((j) => {
      if (j.idx === this.myIdx) {
        return frost.Lib.get_share(this.refreshLocalPkg!.shares, this.myIdx);
      }
      const shareHex = this.decryptedRefreshShares.get(j.idx);
      if (!shareHex) {
        throw new Error(`Missing decrypted refresh share from juror ${j.idx}`);
      }
      return { idx: this.myIdx, seckey: shareHex };
    });

    const refreshedShare = frost.Lib.refresh_share(myRefreshShares, this.computedShare);

    // Merge original and refresh commitments and recompute verification shares.
    const mergedVssCommitments = qualifiedJurors.map((j) => {
      const original = this.computedRecord!.vssCommitments.find((c) => c.idx === j.idx);
      if (!original) {
        throw new Error(`Missing original commitments for juror ${j.idx}`);
      }
      const refresh = qualifiedRefreshCommits.find((c) => c.idx === j.idx)!;
      return {
        idx: j.idx,
        pubkey: j.nostrPubkey,
        commits: mergeRefreshCommitments(
          original.commits,
          refresh.commitHexes,
        ),
      };
    });

    const verificationShares = qualifiedJurors.map((j) => {
      const idx = BigInt(j.idx);
      const pubkeyPoint = mergedVssCommitments.reduce(
        (sum, c) => sum.add(evaluateCommitments(c.commits.map((h) => Point.fromHex(h)), idx)),
        Point.ZERO,
      );
      return { idx: j.idx, pubkey: pointToXOnlyHex(pubkeyPoint) };
    });

    const groupPoint = mergedVssCommitments.reduce(
      (sum, c) => sum.add(Point.fromHex(c.commits[0])),
      Point.ZERO,
    );
    const groupPubkey = groupPoint.toHex(true);

    if (groupPubkey !== this.computedRecord.groupPubkey) {
      throw new Error('Refresh changed the group public key');
    }

    const myVerification = verificationShares.find((v) => v.idx === this.myIdx);
    if (myVerification) {
      const derived = Point.BASE.multiply(BigInt('0x' + refreshedShare.seckey))
        .toHex(true)
        .slice(2);
      if (derived !== myVerification.pubkey) {
        throw new Error('Refreshed share does not match verification share');
      }
    }

    const refreshedRecord: DkgRecord = {
      ...this.computedRecord,
      groupPubkey,
      groupPubkeyXOnly: pointToXOnlyHex(groupPoint),
      verificationShares,
      vssCommitments: mergedVssCommitments,
    };

    this.computedRecord = refreshedRecord;
    this.computedShare = refreshedShare;
    return refreshedRecord;
  }

  /**
   * Current phase of the DKG from this juror's perspective.
   */
  getPhase(): 'awaiting_commitments' | 'awaiting_shares' | 'complaint' | 'complete' | 'failed' {
    const qualifiedCount = this.jurors.filter((j) => !this.disqualified.has(j.idx)).length;
    if (qualifiedCount < this.threshold) return 'failed';
    if (this.computedRecord) return 'complete';
    if (this.complaints.length > 0) return 'complaint';
    const haveAllPeerCommits = this.jurors
      .filter((j) => j.idx !== this.myIdx && !this.disqualified.has(j.idx))
      .every((j) => this.commitments.has(j.idx));
    if (!haveAllPeerCommits) return 'awaiting_commitments';
    const haveAllPeerShares = this.jurors
      .filter((j) => j.idx !== this.myIdx && !this.disqualified.has(j.idx))
      .every((j) => this.decryptedShares.has(j.idx));
    if (!haveAllPeerShares) return 'awaiting_shares';
    return 'awaiting_shares';
  }
}
