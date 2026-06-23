/**
 * Nostr event builders for the BAO Court / Juror Mode FROST appeal protocol.
 *
 * These functions construct event templates compatible with useNostrPublish.
 * Callers must finalize and broadcast the returned templates.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { isNostrId } from '@/lib/nostrId';
import type { FrostAttestation, JurorProfile, StakeCommitment } from './types';
import type { EventTemplate } from '@/hooks/useNostrPublish';

interface DisputeEventParams {
  readonly marketId: string;
  readonly marketEventId: string;
  readonly disputeId: string;
  readonly originalOutcome: string;
  readonly proposedOutcome: string;
  readonly challengerPubkey: string;
  readonly evidenceHashes: readonly string[];
  readonly disputeDeadline: number; // unix seconds
}

interface JurorCandidacyParams {
  readonly disputeId: string;
  readonly marketId: string;
  readonly juror: JurorProfile;
  readonly bondAmountSats: number;
  readonly bondAddress: string;
  readonly bondTxid?: string;
  readonly bondVout?: number;
  readonly deadlineSeconds?: number;
}

interface SelectionEventParams {
  readonly disputeId: string;
  readonly marketId: string;
  readonly selectedJurors: readonly { idx: number; pubkey: string; stake: number }[];
  readonly backupJurors: readonly { idx: number; pubkey: string; stake: number }[];
  readonly seed: string;
  readonly blockHash: string;
}

interface DkgCommitmentParams {
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly jurorPubkey: string;
  readonly vssCommits: readonly string[]; // polynomial commitments
}

interface VoteCommitParams {
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly commitHash: string; // SHA256(outcome || salt)
}

interface VoteRevealParams {
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly outcome: string;
  readonly salt: string;
}

interface FrostCommitParams {
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly commitmentPackage: {
    idx: number;
    binder_pn: string;
    hidden_pn: string;
  };
}

interface FrostRevealParams {
  readonly disputeId: string;
  readonly jurorIdx: number;
  readonly publicNonce: {
    idx: number;
    binder_pn: string;
    hidden_pn: string;
  };
  readonly partialSig: string;
}

export const BAO_COURT_DISPUTE_KIND = 38025;
export const BAO_COURT_JUROR_CANDIDACY_KIND = 39001;
export const BAO_COURT_SELECTION_KIND = 39002;
export const BAO_COURT_DKG_COMMITMENT_KIND = 38031;
export const BAO_COURT_VOTE_COMMIT_KIND = 39004;
export const BAO_COURT_VOTE_REVEAL_KIND = 39004;
export const BAO_COURT_FROST_COMMIT_KIND = 39005;
export const BAO_COURT_FROST_REVEAL_KIND = 39006;
export const BAO_COURT_ATTESTATION_KIND = 39007;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function buildDisputeEvent(params: DisputeEventParams): EventTemplate {
  return {
    kind: BAO_COURT_DISPUTE_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.marketEventId, '', 'root'],
      ['p', params.challengerPubkey],
      ['dispute', params.disputeId],
      ['market', params.marketId],
      ['original', params.originalOutcome],
      ['proposed', params.proposedOutcome],
      ['deadline', String(params.disputeDeadline)],
      ['appeal_type', 'frost'],
      ...params.evidenceHashes.map((h): [string, string] => ['evidence', h]),
      ['alt', `BAO Court dispute ${params.disputeId.slice(0, 12)}`],
    ],
    content: JSON.stringify({
      marketId: params.marketId,
      marketEventId: params.marketEventId,
      disputeId: params.disputeId,
      originalOutcome: params.originalOutcome,
      proposedOutcome: params.proposedOutcome,
      evidenceHashes: params.evidenceHashes,
    }),
  };
}

export function buildJurorCandidacyEvent(
  params: JurorCandidacyParams,
): EventTemplate {
  const tags: string[][] = [
    ['e', params.disputeId, '', 'root'],
    ['dispute', params.disputeId],
    ['market', params.marketId],
    ['bond', String(params.bondAmountSats)],
    ['address', params.bondAddress],
    ['alt', `BAO Court juror candidacy for dispute ${params.disputeId.slice(0, 12)}`],
  ];
  if (params.bondTxid) {
    tags.push(['bondTxid', params.bondTxid]);
  }
  if (params.bondVout !== undefined) {
    tags.push(['bondVout', String(params.bondVout)]);
  }
  if (params.deadlineSeconds !== undefined) {
    tags.push(['deadline', String(params.deadlineSeconds)]);
  }
  for (const category of params.juror.categories) {
    tags.push(['t', category]);
  }

  return {
    kind: BAO_COURT_JUROR_CANDIDACY_KIND,
    created_at: nowSeconds(),
    tags,
    content: JSON.stringify({
      marketId: params.marketId,
      disputeId: params.disputeId,
      stakeCapacitySats: params.juror.stakeCapacitySats,
      wotScore: params.juror.wotScore,
      categories: params.juror.categories,
      bondAmountSats: params.bondAmountSats,
      bondAddress: params.bondAddress,
      bondTxid: params.bondTxid,
      bondVout: params.bondVout,
      deadlineSeconds: params.deadlineSeconds,
    }),
  };
}

export function parseJurorCandidacyEvent(
  event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags' | 'content' | 'created_at'>,
): JurorProfile | null {
  if (event.kind !== BAO_COURT_JUROR_CANDIDACY_KIND || !isNostrId(event.pubkey)) {
    return null;
  }

  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const bondTag = event.tags.find((t) => t[0] === 'bond');
    const addressTag = event.tags.find((t) => t[0] === 'address');
    const txidTag = event.tags.find((t) => t[0] === 'bondTxid');
    const voutTag = event.tags.find((t) => t[0] === 'bondVout');
    const deadlineTag = event.tags.find((t) => t[0] === 'deadline');
    const categoryTags = event.tags.filter((t) => t[0] === 't').map((t) => t[1]);

    const amountSats = Number(bondTag?.[1] ?? content.bondAmountSats ?? 0);
    const bondAddress = addressTag?.[1] ?? String(content.bondAddress ?? '');
    const bondTxid = txidTag?.[1] ?? (typeof content.bondTxid === 'string' ? content.bondTxid : undefined);
    const bondVout = voutTag !== undefined
      ? Number(voutTag[1])
      : (typeof content.bondVout === 'number' ? content.bondVout : undefined);
    const deadlineSeconds = deadlineTag !== undefined
      ? Number(deadlineTag[1])
      : (typeof content.deadlineSeconds === 'number' ? content.deadlineSeconds : undefined);

    const stakeCommitment: StakeCommitment = {
      amountSats,
      bondAddress,
      bondTxid,
      bondVout,
      deadlineSeconds,
      status: 'confirmed',
      committedAt: event.created_at,
    };

    return {
      nostrPubkey: event.pubkey,
      stakeCapacitySats: Number(content.stakeCapacitySats ?? 0),
      stakeCommitment,
      wotScore: Number(content.wotScore ?? 0),
      categories: categoryTags.length > 0
        ? categoryTags
        : Array.isArray(content.categories)
          ? content.categories.filter((c): c is string => typeof c === 'string')
          : [],
      registeredAt: Number(content.registeredAt ?? event.created_at),
    };
  } catch {
    return null;
  }
}

export function buildSelectionEvent(
  params: SelectionEventParams,
): EventTemplate {
  return {
    kind: BAO_COURT_SELECTION_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['dispute', params.disputeId],
      ['market', params.marketId],
      ['seed', params.seed],
      ['block', params.blockHash],
      ...params.selectedJurors.map((j): [string, string, string, string] => [
        'selected',
        String(j.idx),
        j.pubkey,
        String(j.stake),
      ]),
      ...params.backupJurors.map((j): [string, string, string, string] => [
        'backup',
        String(j.idx),
        j.pubkey,
        String(j.stake),
      ]),
      ['alt', `BAO Court jury selection for dispute ${params.disputeId.slice(0, 12)}`],
    ],
    content: JSON.stringify({
      marketId: params.marketId,
      disputeId: params.disputeId,
      seed: params.seed,
      blockHash: params.blockHash,
      selected: params.selectedJurors,
      backups: params.backupJurors,
    }),
  };
}

export function parseSelectionEvent(
  event: Pick<NostrEvent, 'kind' | 'tags' | 'content'>,
): { disputeId: string; marketId: string; selected: SelectedJurorEntry[]; backups: SelectedJurorEntry[]; seed: string; blockHash: string } | null {
  if (event.kind !== BAO_COURT_SELECTION_KIND) return null;
  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const disputeTag = event.tags.find((t) => t[0] === 'dispute');
    const marketTag = event.tags.find((t) => t[0] === 'market');
    const seedTag = event.tags.find((t) => t[0] === 'seed');
    const blockTag = event.tags.find((t) => t[0] === 'block');

    const selected = event.tags
      .filter((t) => t[0] === 'selected')
      .map((t): SelectedJurorEntry => ({ idx: Number(t[1]), pubkey: t[2], stake: Number(t[3]) }));
    const backups = event.tags
      .filter((t) => t[0] === 'backup')
      .map((t): SelectedJurorEntry => ({ idx: Number(t[1]), pubkey: t[2], stake: Number(t[3]) }));

    return {
      disputeId: disputeTag?.[1] ?? String(content.disputeId ?? ''),
      marketId: marketTag?.[1] ?? String(content.marketId ?? ''),
      selected,
      backups,
      seed: seedTag?.[1] ?? String(content.seed ?? ''),
      blockHash: blockTag?.[1] ?? String(content.blockHash ?? ''),
    };
  } catch {
    return null;
  }
}

interface SelectedJurorEntry {
  idx: number;
  pubkey: string;
  stake: number;
}

export function buildDkgCommitmentEvent(
  params: DkgCommitmentParams,
): EventTemplate {
  return {
    kind: BAO_COURT_DKG_COMMITMENT_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['p', params.jurorPubkey],
      ['dispute', params.disputeId],
      ['juror', String(params.jurorIdx)],
      ...params.vssCommits.map((c): [string, string] => ['commit', c]),
      ['alt', `BAO Court DKG commitment from juror ${params.jurorIdx}`],
    ],
    content: JSON.stringify({
      disputeId: params.disputeId,
      jurorIdx: params.jurorIdx,
      vssCommits: params.vssCommits,
    }),
  };
}

export function parseDkgCommitmentEvent(
  event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags' | 'content'>,
): { disputeId: string; jurorIdx: number; jurorPubkey: string; vssCommits: string[] } | null {
  if (event.kind !== BAO_COURT_DKG_COMMITMENT_KIND || !isNostrId(event.pubkey)) return null;
  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const disputeTag = event.tags.find((t) => t[0] === 'dispute');
    const jurorTag = event.tags.find((t) => t[0] === 'juror');
    const commits = event.tags.filter((t) => t[0] === 'commit').map((t) => t[1]);
    return {
      disputeId: disputeTag?.[1] ?? String(content.disputeId ?? ''),
      jurorIdx: Number(jurorTag?.[1] ?? content.jurorIdx ?? 0),
      jurorPubkey: event.pubkey,
      vssCommits: commits.length > 0 ? commits : Array.isArray(content.vssCommits) ? content.vssCommits.filter((c): c is string => typeof c === 'string') : [],
    };
  } catch {
    return null;
  }
}

export function buildVoteCommitEvent(params: VoteCommitParams): EventTemplate {
  return {
    kind: BAO_COURT_VOTE_COMMIT_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['dispute', params.disputeId],
      ['juror', String(params.jurorIdx)],
      ['commit', params.commitHash],
      ['alt', `BAO Court vote commit from juror ${params.jurorIdx}`],
    ],
    content: JSON.stringify({
      disputeId: params.disputeId,
      jurorIdx: params.jurorIdx,
      commitHash: params.commitHash,
    }),
  };
}

export function buildVoteRevealEvent(params: VoteRevealParams): EventTemplate {
  return {
    kind: BAO_COURT_VOTE_REVEAL_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['dispute', params.disputeId],
      ['juror', String(params.jurorIdx)],
      ['outcome', params.outcome],
      ['salt', params.salt],
      ['alt', `BAO Court vote reveal from juror ${params.jurorIdx}`],
    ],
    content: JSON.stringify({
      disputeId: params.disputeId,
      jurorIdx: params.jurorIdx,
      outcome: params.outcome,
      salt: params.salt,
    }),
  };
}

export function parseVoteCommitEvent(
  event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags' | 'content'>,
): { disputeId: string; jurorIdx: number; pubkey: string; commitHash: string } | null {
  if (event.kind !== BAO_COURT_VOTE_COMMIT_KIND || !isNostrId(event.pubkey)) return null;
  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const disputeTag = event.tags.find((t) => t[0] === 'dispute');
    const jurorTag = event.tags.find((t) => t[0] === 'juror');
    const commitTag = event.tags.find((t) => t[0] === 'commit');
    return {
      disputeId: disputeTag?.[1] ?? String(content.disputeId ?? ''),
      jurorIdx: Number(jurorTag?.[1] ?? content.jurorIdx ?? 0),
      pubkey: event.pubkey,
      commitHash: commitTag?.[1] ?? String(content.commitHash ?? ''),
    };
  } catch {
    return null;
  }
}

export function parseVoteRevealEvent(
  event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags' | 'content'>,
): { disputeId: string; jurorIdx: number; pubkey: string; outcome: string; salt: string } | null {
  if (event.kind !== BAO_COURT_VOTE_REVEAL_KIND || !isNostrId(event.pubkey)) return null;
  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const disputeTag = event.tags.find((t) => t[0] === 'dispute');
    const jurorTag = event.tags.find((t) => t[0] === 'juror');
    const outcomeTag = event.tags.find((t) => t[0] === 'outcome');
    const saltTag = event.tags.find((t) => t[0] === 'salt');
    return {
      disputeId: disputeTag?.[1] ?? String(content.disputeId ?? ''),
      jurorIdx: Number(jurorTag?.[1] ?? content.jurorIdx ?? 0),
      pubkey: event.pubkey,
      outcome: outcomeTag?.[1] ?? String(content.outcome ?? ''),
      salt: saltTag?.[1] ?? String(content.salt ?? ''),
    };
  } catch {
    return null;
  }
}

export function buildFrostCommitEvent(
  params: FrostCommitParams,
): EventTemplate {
  return {
    kind: BAO_COURT_FROST_COMMIT_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['dispute', params.disputeId],
      ['juror', String(params.jurorIdx)],
      ['binder_pn', params.commitmentPackage.binder_pn],
      ['hidden_pn', params.commitmentPackage.hidden_pn],
      ['alt', `BAO Court FROST signing commitment from juror ${params.jurorIdx}`],
    ],
    content: JSON.stringify({
      disputeId: params.disputeId,
      jurorIdx: params.jurorIdx,
      commitmentPackage: params.commitmentPackage,
    }),
  };
}

export function buildFrostRevealEvent(params: FrostRevealParams): EventTemplate {
  return {
    kind: BAO_COURT_FROST_REVEAL_KIND,
    created_at: nowSeconds(),
    tags: [
      ['e', params.disputeId, '', 'root'],
      ['dispute', params.disputeId],
      ['juror', String(params.jurorIdx)],
      ['nonce_binder', params.publicNonce.binder_pn],
      ['nonce_hidden', params.publicNonce.hidden_pn],
      ['psig', params.partialSig],
      ['alt', `BAO Court FROST signing reveal from juror ${params.jurorIdx}`],
    ],
    content: JSON.stringify({
      disputeId: params.disputeId,
      jurorIdx: params.jurorIdx,
      publicNonce: params.publicNonce,
      partialSig: params.partialSig,
    }),
  };
}

export function buildAttestationEvent(
  params: { attestation: FrostAttestation; marketEventId: string },
): EventTemplate {
  const { attestation, marketEventId } = params;
  const tags: string[][] = [
    ['e', marketEventId, '', 'root'],
    ['m', attestation.marketId],
    ['p', attestation.groupPubkey],
    ['outcome', attestation.outcome],
    ['nonce', attestation.pubNonce],
    ['sig', attestation.signature],
    ['ver', 'FROST-BIP340-v1'],
    ['alt', `BAO Court FROST attestation: ${attestation.outcome}`],
  ];
  if (attestation.disputeEventId) {
    tags.push(['dispute', attestation.disputeEventId]);
  }
  return {
    kind: attestation.kind,
    created_at: nowSeconds(),
    tags,
    content: JSON.stringify({
      marketId: attestation.marketId,
      outcome: attestation.outcome,
      message: attestation.message,
      disputeEventId: attestation.disputeEventId,
    }),
  };
}

export interface SelectionValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly selected?: { idx: number; pubkey: string; stake: number }[];
  readonly backups?: { idx: number; pubkey: string; stake: number }[];
}

export function validateSelectionEvent(
  event: Pick<NostrEvent, 'kind' | 'tags' | 'content'>,
  expectedDisputeId?: string,
): SelectionValidationResult {
  if (event.kind !== BAO_COURT_SELECTION_KIND) {
    return { valid: false, error: 'Not a Kind 39002 selection event' };
  }

  const disputeTag = event.tags.find((t) => t[0] === 'dispute');
  if (expectedDisputeId && disputeTag?.[1] !== expectedDisputeId) {
    return { valid: false, error: 'Dispute id mismatch' };
  }

  const selected = event.tags
    .filter((t) => t[0] === 'selected')
    .map((t) => ({ idx: Number(t[1]), pubkey: t[2], stake: Number(t[3]) }));
  const backups = event.tags
    .filter((t) => t[0] === 'backup')
    .map((t) => ({ idx: Number(t[1]), pubkey: t[2], stake: Number(t[3]) }));

  if (selected.length === 0) {
    return { valid: false, error: 'No selected jurors' };
  }

  const allJurors = [...selected, ...backups];
  if (allJurors.some((j) => !j.pubkey || !isNostrId(j.pubkey))) {
    return { valid: false, error: 'Invalid juror pubkey' };
  }
  if (allJurors.some((j) => Number.isNaN(j.idx) || j.idx < 1)) {
    return { valid: false, error: 'Invalid juror index' };
  }

  const indices = allJurors.map((j) => j.idx);
  const unique = new Set(indices);
  if (unique.size !== indices.length) {
    return { valid: false, error: 'Duplicate juror indices' };
  }

  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    if (!content.seed || !content.blockHash) {
      return { valid: false, error: 'Missing seed or block hash in content' };
    }
  } catch {
    return { valid: false, error: 'Invalid JSON content' };
  }

  return { valid: true, selected, backups };
}
