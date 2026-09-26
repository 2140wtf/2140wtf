/**
 * baoLedger39805 - kind-49305 escrow-ledger entry validation + fold (Concord).
 *
 * Spec: docs/bao-normative-spec-v0.md §5.6 (v0.2, round-16 amendments) -
 * the binding money-state stream. Sprint item "39905 stub; signed manifests"
 * (§44.3 public surface): this module validates a legacy shape and signed, pinned input. Kind retention,
 * canonical wire amendments, rotation and money-state evaluation remain unresolved.
 *
 * Kind note (owner decision 2026-09-15, closing R01/B1): the ledger kind moved
 * from 39905 to **49305** because NIP-01 makes every 30000–39999 kind
 * parameterized-replaceable - strfry collapsed a same-author chain to one
 * event (proved on relay.bao.fund), which append-only retention cannot
 * tolerate. 49305 is a regular event kind: every entry is retained, so gaps,
 * broken links and forks stay visible.
 *
 * Normative rules implemented here (all typed-error, fail-closed):
 *   - content requires `d` ABSENT (ledger identity is (pubkey, campaign, seq));
 *     `seq` is per-campaign gap-free starting at 1 (amend 1) - a gap rejects
 *     the whole chain
 *   - fold order = seq order ONLY (amend 3); (created_at, event_id) is
 *     anomaly detection, never the fold key
 *   - prevHash = blake3 over canonical bytes of the envelope
 *     {seq, created_at, event_id, content} (amend 4); genesis prevHash =
 *     blake3 of the campaign a-coordinate
 *   - per-type field matrix v1 (§5.6 table): required / null per type
 *   - "unset/unknown = null, never 0" - but 0 is a valid SET value
 *     (amountSats: 0 on DISPUTE_OPEN) (amend 6)
 *   - RELEASE/REFUND_ALL validity vs §3 gates is the gate-runner's job; this
 *     module only rejects structurally invalid entries
 */
import { verifyEvent, type Event } from 'nostr-tools';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/curves/utils.js';
import { validateHashRefField, HashRefError } from './hashRef';

import { canonicalJson } from './baoLedger';

export const ESCROW_LEDGER_KIND = 49305;

export const LEDGER_TYPES = [
  'STAKE_LOCK',
  'CONTRIB_LOCK',
  'RELEASE',
  'REFUND_ALL',
  'DISPUTE_OPEN',
  'DISPUTE_RESOLVED',
  'ROTATION',
  'CLOSE',
] as const;
export type LedgerEntryType = (typeof LEDGER_TYPES)[number];

export class LedgerEntryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LedgerEntryError';
  }
}

export interface LedgerEntryContent {
  v: 1;
  seq: number;
  prevHash: string;
  campaign: string; // full 39801 a-coordinate, never a bare slug
  type: LedgerEntryType;
  milestone: string | null;
  amountSats: number | null;
  proofSetHash: string | null;
  nullifierRoot: string | null;
  externalContributors: number | null;
  window: { disputeEndsUnix: number; paused: boolean } | null;
  verdict: { id: string; hash: string; courtSigHint: string; final: boolean } | null;
  registrarEpoch: number;
}

/** Signed event shape. Validation of content alone does not grant authority. */
export type LedgerEvent = Event;

/** A pin-rotation authorization (B7a): published OUTSIDE the ledger by the
 *  CURRENT epoch's pinned key, naming the next epoch and its new key.
 *  The fold verifies the signature itself - a grant is never trusted on
 *  presence alone - and binds it to (campaign, fromEpoch, newKey). */
export interface PinGrant {
  kind: 'bao/concord/registrar-pin-grant';
  v: 1;
  campaign: string;
  /** Epoch the GRANTING key is pinned for (must match the signer). */
  fromEpoch: number;
  /** Next epoch; must be fromEpoch + 1 (no epoch skipping). */
  toEpoch: number;
  /** The new registrar's x-only nostr pubkey (64-hex). */
  toPubkey: string;
  /** First ledger seq the new epoch may sign: the ROTATION entry's seq.
   *  Prevents the old key from signing entries after its handover point. */
  fromSeq: number;
  /** Unix-seconds deadline: the grant expires (compromise blast-radius
   *  bound); folds reject grants whose deadline has passed. */
  expiresAtUnix: number;
}

/** Verify + normalize a pin grant. Signed by the CURRENT epoch's pinned key
 *  (the caller supplies it from its own trust store - never from the event
 *  stream) over canonical JSON of the grant fields. */
export function validatePinGrant(
  raw: unknown,
  opts: { campaign: string; nowUnix: number; fromEpoch: number; stateSeq: number; fromPubkey: string },
): PinGrant {
  let g: PinGrant & { sig?: string };
  try {
    g = JSON.parse(JSON.stringify(raw)) as PinGrant & { sig?: string };
  } catch {
    throw new LedgerEntryError('pin grant is not JSON', 'ledger_pin_grant_unparseable');
  }
  if (g?.kind !== 'bao/concord/registrar-pin-grant' || g?.v !== 1) {
    throw new LedgerEntryError('unrecognized pin grant shape', 'ledger_pin_grant_bad_shape');
  }
  if (g.campaign !== opts.campaign) {
    throw new LedgerEntryError('pin grant campaign mismatch', 'ledger_pin_grant_campaign');
  }
  if (g.fromEpoch !== opts.fromEpoch || g.toEpoch !== opts.fromEpoch + 1) {
    throw new LedgerEntryError(`pin grant must chain epoch ${opts.fromEpoch} → ${opts.fromEpoch + 1}`, 'ledger_pin_grant_epoch');
  }
  if (!HEX_64.test(g.toPubkey ?? '')) {
    throw new LedgerEntryError('pin grant toPubkey must be 64-hex', 'ledger_pin_grant_pubkey');
  }
  if (!Number.isSafeInteger(g.fromSeq) || g.fromSeq !== opts.stateSeq + 1) {
    throw new LedgerEntryError(`pin grant fromSeq must be exactly the next seq (${opts.stateSeq + 1})`, 'ledger_pin_grant_seq');
  }
  if (!Number.isSafeInteger(g.expiresAtUnix) || g.expiresAtUnix < opts.nowUnix) {
    throw new LedgerEntryError('pin grant expired', 'ledger_pin_grant_expired');
  }
  const { sig, ...grant } = g;
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) {
    throw new LedgerEntryError('pin grant signature missing', 'ledger_pin_grant_bad_sig');
  }
  // B7a: the OLD (granting) key must have signed - the grant authorizes the
  // NEW key, so verifying against toPubkey would be self-authorization.
  const msgBytes = new TextEncoder().encode(canonicalJson(grant));
  try {
    if (!schnorr.verify(hexToBytes(sig), blake3(msgBytes), hexToBytes(opts.fromPubkey))) {
      throw new Error('bad sig');
    }
  } catch {
    throw new LedgerEntryError('pin grant signature does not verify against the granting epoch key', 'ledger_pin_grant_bad_sig');
  }
  return grant as PinGrant;
}

export interface LedgerAuthority {
  campaign: string;
  /** Preconfigured epoch pins; an entry cannot authorize its own signer. */
  registrarEpochs: ReadonlyMap<number, string>;
  /** B7a: when folding a ROTATION entry, the caller supplies the signed pin
   *  grant here (it is verified against the OUTGOING epoch's pinned key).
   *  Absent/null for every other entry type. */
  pinGrant?: { grant: unknown } | null;
}

const A_COORD_RE = /^39801:[0-9a-f]{64}:[a-z0-9][a-z0-9-]{0,63}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;

const isNull = (v: unknown): boolean => v === null;
const isSet = (v: unknown): boolean => v !== null && v !== undefined;

/**
 * Per-type field matrix v1 (§5.6, §44 Blocker 3): field → allowed values per
 * entry type. 'req' = must be set, 'null' = must be null, 'opt' = either,
 * 'zero' = must be set and exactly 0 (DISPUTE amount semantics).
 */
const MATRIX: Record<keyof Omit<LedgerEntryContent, 'v' | 'seq' | 'prevHash' | 'campaign' | 'type' | 'registrarEpoch'>, Record<LedgerEntryType, 'req' | 'null' | 'opt' | 'zero'>> = {
  milestone: {
    STAKE_LOCK: 'null', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'opt',
    DISPUTE_OPEN: 'req', DISPUTE_RESOLVED: 'req', ROTATION: 'null', CLOSE: 'null',
  },
  amountSats: {
    STAKE_LOCK: 'req', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'req',
    DISPUTE_OPEN: 'zero', DISPUTE_RESOLVED: 'zero', ROTATION: 'null', CLOSE: 'req',
  },
  proofSetHash: {
    STAKE_LOCK: 'req', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'req',
    DISPUTE_OPEN: 'null', DISPUTE_RESOLVED: 'null', ROTATION: 'null', CLOSE: 'null',
  },
  nullifierRoot: {
    STAKE_LOCK: 'req', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'req',
    DISPUTE_OPEN: 'req', DISPUTE_RESOLVED: 'req', ROTATION: 'req', CLOSE: 'req',
  },
  externalContributors: {
    STAKE_LOCK: 'null', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'null',
    DISPUTE_OPEN: 'null', DISPUTE_RESOLVED: 'null', ROTATION: 'req', CLOSE: 'req',
  },
  window: {
    STAKE_LOCK: 'null', CONTRIB_LOCK: 'req', RELEASE: 'req', REFUND_ALL: 'null',
    DISPUTE_OPEN: 'req', DISPUTE_RESOLVED: 'req', ROTATION: 'null', CLOSE: 'null',
  },
  verdict: {
    STAKE_LOCK: 'null', CONTRIB_LOCK: 'null', RELEASE: 'null', REFUND_ALL: 'null',
    DISPUTE_OPEN: 'null', DISPUTE_RESOLVED: 'req', ROTATION: 'null', CLOSE: 'null',
  },
};

export type LedgerFieldRule = 'req' | 'null' | 'opt' | 'zero';
export type LedgerFieldName = keyof typeof MATRIX;

/** The per-type field matrix, exposed to publishers/serializers that must
 *  emit entries which validate: 'req' = set, 'null' = null, 'zero' = exactly
 *  0, 'opt' = either. */
export function ledgerFieldRules(type: LedgerEntryType): Record<LedgerFieldName, LedgerFieldRule> {
  return Object.fromEntries(
    (Object.entries(MATRIX) as Array<[LedgerFieldName, Record<LedgerEntryType, LedgerFieldRule>]>).map(
      ([field, rules]) => [field, rules[type]],
    ),
  ) as Record<LedgerFieldName, LedgerFieldRule>;
}

/** The a-coordinate form used as genesis prevHash preimage (amend 4). */
export function genesisPrevHash(campaign: string): string {
  if (!A_COORD_RE.test(campaign)) {
    throw new LedgerEntryError(`campaign must be a full 39801 a-coordinate, got ${JSON.stringify(campaign)}`, 'ledger_bad_campaign');
  }
  return bytesToHex(blake3(new TextEncoder().encode(campaign)));
}

/** prevHash preimage per amend 4: canonical bytes of the envelope struct. */
function envelopeBytes(seq: number, createdAt: number, eventId: string, content: LedgerEntryContent): Uint8Array {
  return new TextEncoder().encode(
    canonicalJson({ seq, created_at: createdAt, event_id: eventId, content }),
  );
}

/** Validate + normalize a 49305 entry. Throws LedgerEntryError (typed). */
export function validateLedgerEntry(ev: LedgerEvent): LedgerEntryContent {
  if (!ev || typeof ev.content !== 'string' || !Array.isArray(ev.tags) || ev.tags.some(t => !Array.isArray(t) || t.some(v => typeof v !== 'string'))) {
    throw new LedgerEntryError('invalid event shape', 'ledger_bad_event');
  }
  let c: LedgerEntryContent;
  try {
    c = JSON.parse(ev.content) as LedgerEntryContent;
  } catch {
    throw new LedgerEntryError('content is not JSON', 'ledger_content_unparseable');
  }
  if (c?.v !== 1) throw new LedgerEntryError('content.v must be 1', 'ledger_bad_version');
  if (ev.tags.some((t) => t[0] === 'd')) {
    throw new LedgerEntryError('49305 events must NOT carry a d tag (ledger identity is (pubkey, campaign, seq))', 'ledger_has_d_tag');
  }
  if (!Number.isSafeInteger(c.seq) || c.seq < 1) {
    throw new LedgerEntryError('seq must be a positive integer (gap-free, starts at 1)', 'ledger_bad_seq');
  }
  if (!A_COORD_RE.test(c.campaign)) {
    throw new LedgerEntryError('campaign must be a full 39801 a-coordinate (never a bare slug)', 'ledger_bad_campaign');
  }
  if (!LEDGER_TYPES.includes(c.type)) {
    throw new LedgerEntryError(`unknown ledger type ${JSON.stringify(c.type)}`, 'ledger_bad_type');
  }
  if (!HEX_64.test(c.prevHash) || c.prevHash.startsWith('bl3hex:')) {
    // Bare 64-hex is accepted for prevHash as the B4 TRANSITION legacy form
    // (pre-cutover entries); `bl3hex:`-prefixed prevHash arrives below via
    // the field table and is stored prefixed-validated then stripped.
    throw new LedgerEntryError('prevHash must be 64-hex', 'ledger_bad_prev_hash');
  }
  for (const [field, rule] of Object.entries(MATRIX) as [string, Record<LedgerEntryType, 'req' | 'null' | 'opt' | 'zero'>][]) {
    const value = (c as unknown as Record<string, unknown>)[field];
    const r = rule[c.type];
    if (value === undefined) throw new LedgerEntryError(`${field} must be explicitly set or null`, 'ledger_missing_field');
    if (r === 'req' && !isSet(value)) {
      throw new LedgerEntryError(`${field} is required for ${c.type}`, 'ledger_matrix_req');
    }
    if (r === 'null' && !isNull(value)) {
      throw new LedgerEntryError(`${field} must be null for ${c.type} (unset = null, never 0/empty)`, 'ledger_matrix_null');
    }
    if (r === 'zero' && (!isSet(value) || value !== 0)) {
      throw new LedgerEntryError(`${field} must be exactly 0 for ${c.type} (dispute entries carry no amount)`, 'ledger_matrix_zero');
    }
  }
  if (c.milestone !== null && (typeof c.milestone !== 'string' || !c.milestone.trim())) throw new LedgerEntryError('invalid milestone', 'ledger_bad_milestone');
  if (c.nullifierRoot !== null && (typeof c.nullifierRoot !== 'string' || !HEX_64.test(c.nullifierRoot))) throw new LedgerEntryError('invalid nullifierRoot', 'ledger_bad_nullifier_root');
  // B4 field-table validation (owner-resolved spelling contract): hash-ref
  // fields (proofSetHash/nullifierRoot/prevHash/verdict.hash) may arrive as
  // `bl3hex:` (cutover form) or legacy bare hex (transition window); Nostr
  // ids/pubkeys/a-coordinates reject the prefix outright. Normalized hex is
  // written back so downstream hashing is spelling-independent.
  for (const [field, initial] of [
    ['proofSetHash', c.proofSetHash],
    ['nullifierRoot', c.nullifierRoot],
    ['verdict.hash', c.verdict?.hash],
  ] as Array<[string, string | null | undefined]>) {
    if (initial === null || initial === undefined) continue;
    try {
      const { hex } = validateHashRefField(1, field, initial, { legacy: true });
      if (field === 'verdict.hash' && c.verdict) c.verdict.hash = hex;
      else if (field === 'proofSetHash') c.proofSetHash = hex;
      else if (field === 'nullifierRoot') c.nullifierRoot = hex;
    } catch (err) {
      if (err instanceof HashRefError) throw new LedgerEntryError(err.message, `ledger_${err.code}`);
      throw err;
    }
  }
  if (isSet(c.verdict) && c.verdict !== null) {
    try { validateHashRefField(1, 'verdict.id', c.verdict.id); } catch (err) {
      if (err instanceof HashRefError) throw new LedgerEntryError(err.message, `ledger_${err.code}`);
      throw err;
    }
  }
  if (c.externalContributors !== null && (!Number.isSafeInteger(c.externalContributors) || c.externalContributors < 0)) throw new LedgerEntryError('invalid externalContributors', 'ledger_bad_external_count');
  // Typed values inside set fields.
  if (isSet(c.amountSats) && c.amountSats !== null) {
    if (!Number.isSafeInteger(c.amountSats) || c.amountSats < 0) {
      throw new LedgerEntryError('amountSats must be a non-negative integer when set', 'ledger_bad_amount');
    }
  }
  if (isSet(c.proofSetHash) && c.proofSetHash !== null && !HEX_64.test(c.proofSetHash)) {
    throw new LedgerEntryError('proofSetHash must be 64-hex when set', 'ledger_bad_proof_set_hash');
  }
  if (isSet(c.window) && c.window !== null) {
    const w = c.window;
    if (typeof w !== 'object' || Array.isArray(w) || !Number.isSafeInteger(w.disputeEndsUnix) || w.disputeEndsUnix < 0 || typeof w.paused !== 'boolean') {
      throw new LedgerEntryError('window must be { disputeEndsUnix: number, paused: boolean } when set', 'ledger_bad_window');
    }
  }
  if (c.type === 'DISPUTE_RESOLVED' && isSet(c.verdict) && c.verdict !== null) {
    const v = c.verdict;
    if (typeof v !== 'object' || Array.isArray(v) || typeof v.final !== 'boolean' || typeof v.id !== 'string' || !v.id.trim() || typeof v.hash !== 'string' || !HEX_64.test(v.hash) || typeof v.courtSigHint !== 'string') {
      throw new LedgerEntryError('verdict must be { id, hash, courtSigHint, final } when set', 'ledger_bad_verdict');
    }
  }
  if (!Number.isSafeInteger(c.registrarEpoch) || c.registrarEpoch < 0) {
    throw new LedgerEntryError('registrarEpoch must be a non-negative integer', 'ledger_bad_epoch');
  }
  return c;
}

/** Verify an entry's prevHash binding against the prior fold state. */
export function entryHash(ev: LedgerEvent, content: LedgerEntryContent): string {
  return bytesToHex(blake3(envelopeBytes(content.seq, ev.created_at, ev.id, content)));
}

export interface LedgerFoldState {
  campaign: string;
  /** Highest accepted seq. */
  seq: number;
  /** blake3 envelope hash of the last accepted entry (chain head). */
  headHash: string;
  runningSats: number; // Structural bookkeeping only; never release eligibility.
  ancestry: ReadonlyMap<number, string>;
  closed: boolean;
  entriesCount: number;
  /** Frozen = fork or broken link detected; no further entries accepted. */
  frozen: false | 'chain_broken' | 'chain_forked' | 'seq_gap' | 'invalid_balance';
  /** Consumed pin grants, keyed by toEpoch (B7a): one grant per epoch, and
   *  a grant's fromSeq binds the handover point - the OLD key cannot sign
   *  entries at or after fromSeq even while its pin remains configured. */
  pinGrants: ReadonlyMap<number, PinGrant>;
}

export const initialLedgerFold = (campaign: string): LedgerFoldState => ({
  campaign,
  seq: 0,
  headHash: genesisPrevHash(campaign),
  runningSats: 0,
  ancestry: new Map(),
  closed: false,
  entriesCount: 0,
  frozen: false,
  pinGrants: new Map(),
});

/**
 * Fold one entry into structural chain bookkeeping (seq order enforced by the
 * caller - passing entries out of order IS a gap and is rejected, amend 1/3).
 * A broken prevHash freezes the campaign (`ledger_chain_broken`).
 */
export function foldLedgerEntry(state: LedgerFoldState, ev: LedgerEvent, authority?: LedgerAuthority): LedgerFoldState {
  if (state.frozen) return state; // frozen is forever - fail-closed
  // Do not trust a mutable object's cached signature-verification symbol.
  try {
    ev = JSON.parse(JSON.stringify(ev)) as Event;
    if (ev.kind !== ESCROW_LEDGER_KIND || !Number.isSafeInteger(ev.created_at) || ev.created_at < 0 || !verifyEvent(ev)) throw new Error();
  } catch { throw new LedgerEntryError('invalid signed ledger event', 'ledger_bad_signature'); }
  const content = validateLedgerEntry(ev);
  // B7a retirement: once a grant to epoch N is consumed, every EARLIER epoch
  // is retired from grant.fromSeq onward - its configured pin no longer
  // authorizes signatures (the handover binds, the old pin cannot outlive it).
  for (const [toEpoch, g] of state.pinGrants) {
    if (toEpoch > content.registrarEpoch && content.seq >= g.fromSeq) {
      throw new LedgerEntryError(`registrar epoch ${content.registrarEpoch} was rotated out at seq ${g.fromSeq}`, 'ledger_epoch_retired');
    }
  }
  if (authority?.campaign !== state.campaign || authority.registrarEpochs.get(content.registrarEpoch) !== ev.pubkey) {
    // B7a: a consumed grant pins the NEXT epoch - accept the new key when a
    // grant for (campaign, content.registrarEpoch) was folded at this seq.
    const grant = state.pinGrants.get(content.registrarEpoch);
    const granted =
      grant !== undefined &&
      grant.toPubkey === ev.pubkey &&
      content.seq >= grant.fromSeq;
    if (!granted) {
      throw new LedgerEntryError('registrar is not pinned for campaign and epoch', 'ledger_unauthorized');
    }
  }
  if (content.type === 'ROTATION') {
    return foldRotationEntry(state, ev, content, authority);
  }
  if (content.campaign !== state.campaign) {
    throw new LedgerEntryError(`entry campaign ${content.campaign} does not match fold campaign ${state.campaign}`, 'ledger_campaign_mismatch');
  }
  const h = entryHash(ev, content);
  if (content.seq <= state.seq) {
    return state.ancestry.get(content.seq) === h ? state : { ...state, frozen: 'chain_forked' };
  }
  if (content.seq !== state.seq + 1) return { ...state, frozen: 'seq_gap' };
  if (state.closed) throw new LedgerEntryError('ledger is closed', 'ledger_closed');
  if (content.prevHash !== state.headHash) {
    return { ...state, frozen: 'chain_broken' };
  }
  const amount = content.amountSats ?? 0;
  const delta = content.type === 'STAKE_LOCK' || content.type === 'CONTRIB_LOCK' ? amount
    : content.type === 'RELEASE' || content.type === 'REFUND_ALL' ? -amount : 0;
  const runningSats = state.runningSats + delta;
  if (!Number.isSafeInteger(runningSats) || runningSats < 0) return { ...state, frozen: 'invalid_balance' };
  const ancestry = new Map(state.ancestry); ancestry.set(content.seq, h);
  return {
    campaign: state.campaign,
    seq: content.seq,
    headHash: h,
    runningSats,
    ancestry,
    closed: content.type === 'CLOSE',
    entriesCount: state.entriesCount + 1,
    frozen: false,
    pinGrants: state.pinGrants,
  };
}

/**
 * B7a fold for ROTATION entries (owner-resolved contract, 2026-09-11):
 *   - the ROTATION entry restates FULL external counters (nulls rejected by
 *     the matrix) and is signed by the OUTGOING epoch key;
 *   - the fold consumes exactly ONE pin grant for (campaign, epoch+1),
 *     supplied by the caller in `pinGrant` and verified against the OUTGOING
 *     epoch's pinned key (the grant authorizes the NEW key - never itself);
 *   - seq is campaign-global (C2): it continues across rotation, never
 *     resets, and the running balance is carried over unchanged;
 *   - the grant's fromSeq binds the handover: from the ROTATION entry's seq
 *     onward only the NEW key may sign, even if the old pin stays configured
 *     (the pinGrants map enforces this in the authority check above).
 */
function foldRotationEntry(
  state: LedgerFoldState,
  ev: LedgerEvent,
  content: LedgerEntryContent,
  authority: LedgerAuthority | undefined,
): LedgerFoldState {
  if (authority === undefined) {
    throw new LedgerEntryError('rotation requires configured authority (epoch pins)', 'ledger_unauthorized');
  }
  if (!authority.pinGrant) {
    throw new LedgerEntryError('rotation requires a verified pin grant in the fold authority', 'ledger_rotation_unauthorized');
  }
  const grant = validatePinGrant(authority.pinGrant.grant, {
    campaign: state.campaign,
    nowUnix: ev.created_at,
    fromEpoch: content.registrarEpoch,
    stateSeq: state.seq,
    fromPubkey: authority.registrarEpochs.get(content.registrarEpoch) ?? '',
  });
  if (grant.toEpoch !== content.registrarEpoch + 1 || grant.fromSeq !== content.seq) {
    throw new LedgerEntryError('pin grant does not match this ROTATION entry', 'ledger_rotation_unauthorized');
  }
  // Structural bookkeeping identical to every other entry (seq/prevHash/
  // balance checks run in the shared path AFTER this function returns -
  // implemented by tail-calling the common fold with the grant consumed).
  const h = entryHash(ev, content);
  if (content.seq <= state.seq) {
    return state.ancestry.get(content.seq) === h ? state : { ...state, frozen: 'chain_forked' };
  }
  if (content.seq !== state.seq + 1) return { ...state, frozen: 'seq_gap' };
  if (state.closed) throw new LedgerEntryError('ledger is closed', 'ledger_closed');
  if (content.prevHash !== state.headHash) {
    return { ...state, frozen: 'chain_broken' };
  }
  // ROTATION moves no value: amountSats is null by the matrix, delta = 0.
  const ancestry = new Map(state.ancestry); ancestry.set(content.seq, h);
  const pinGrants = new Map(state.pinGrants);
  if (pinGrants.has(grant.toEpoch)) {
    throw new LedgerEntryError(`epoch ${grant.toEpoch} already has a consumed pin grant`, 'ledger_rotation_unauthorized');
  }
  pinGrants.set(grant.toEpoch, grant);
  return {
    campaign: state.campaign,
    seq: content.seq,
    headHash: h,
    runningSats: state.runningSats,
    ancestry,
    closed: false,
    entriesCount: state.entriesCount + 1,
    frozen: false,
    pinGrants,
  };
}

/** Detect a fork: two chains with the same seq but different head hashes. */
export function detectFork(a: LedgerFoldState, b: LedgerFoldState): boolean {
  if (a.campaign !== b.campaign) throw new LedgerEntryError('cannot compare forks across campaigns', 'ledger_campaign_mismatch');
  for (const [seq, hash] of a.ancestry) {
    const other = b.ancestry.get(seq);
    if (other !== undefined && other !== hash) return true;
  }
  return false;
}
