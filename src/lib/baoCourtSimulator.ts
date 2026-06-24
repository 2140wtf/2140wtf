/**
 * BAO Court simulator — peer-to-peer demo environment.
 *
 * Generates deterministic simulated jurors and publishes their candidacy and
 * selection events to the configured relay pool so a single real user can
 * experience the full peer-to-peer FROST appeal flow. All stakes use fake
 * sats; no real Bitcoin is required.
 *
 * NOTE: A coordinator-based design is intentionally NOT used here. Relying on a
 * single coordinator is custodial and contradicts the protocol goal of a fully
 * independent jury. Demo rooms therefore use deterministic, roster-derived
 * values (room id, dispute id, jury selection, DKG seed) that every juror can
 * compute locally without any privileged party.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  buildDisputeEvent,
  buildJurorCandidacyEvent,
  buildSelectionEvent,
  type JurorProfile,
  type SelectedJuror,
} from '@bao/frost-court';

export interface SimulatedJuror extends JurorProfile {
  /** Deterministic index for FROST polynomials (1-based). */
  readonly idx: number;
  /** Simulated Nostr private key (32-byte hex). */
  readonly privateKey: Uint8Array;
}

export interface SimulatedJury {
  readonly jurors: SimulatedJuror[];
  readonly selected: SelectedJuror[];
  /** Unsigned selection event template — each juror signs and publishes their own copy. */
  readonly selectionTemplate: ReturnType<typeof buildSelectionEvent>;
}

interface NostrPublishable {
  event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void>;
}

const SIMULATED_PUBKEYS = [
  '0000000000000000000000000000000000000000000000000000000000000001',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000000003',
  '0000000000000000000000000000000000000000000000000000000000000004',
  '0000000000000000000000000000000000000000000000000000000000000005',
];

const SIMULATION_STORAGE_KEY = 'bao-court-simulated-selections';
const DEMO_ROOM_STORAGE_KEY = 'bao-court-demo-room';

/** Demo-room membership event kind. */
export const BAO_COURT_DEMO_MEMBERSHIP_KIND = 39008;

/** Fake bond amount used in all demo-room simulations. */
export const DEMO_BOND_AMOUNT_SATS = 1_000_000;

function deterministicPrivateKey(index: number): Uint8Array {
  // Deterministic but obviously insecure — fine for demo peers.
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = (index * 7 + i * 13) % 256;
  }
  return seed;
}

function makeMockBondAddress(index: number): string {
  return `bc1qsim${String(index).padStart(2, '0')}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
}

function makeMockBondTxid(index: number): string {
  return `${String(index).padStart(2, '0')}${'0'.repeat(62)}`;
}

/**
 * Generate a small set of simulated jurors. In demo mode the current user is
 * always juror #1; generated peers fill indices 2..n.
 */
export function generateSimulatedJurors(
  count: number,
  categories: readonly string[],
  bondAmountSats: number,
  startIndex = 2,
): SimulatedJuror[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i;
    // Use well-known deterministic demo pubkeys for the first few peers so the
    // UI is stable across reloads, then fall back to generated keys.
    const privateKey = idx <= SIMULATED_PUBKEYS.length
      ? deterministicPrivateKey(idx)
      : generateSecretKey();
    const pubkey = idx <= SIMULATED_PUBKEYS.length
      ? SIMULATED_PUBKEYS[idx - 1]
      : getPublicKey(privateKey);

    const stakeCommitment: JurorProfile['stakeCommitment'] = {
      amountSats: bondAmountSats,
      bondAddress: makeMockBondAddress(idx),
      bondTxid: makeMockBondTxid(idx),
      bondVout: 0,
      status: 'confirmed',
      committedAt: Math.floor(Date.now() / 1000),
    };

    return {
      idx,
      nostrPubkey: pubkey,
      privateKey,
      stakeCapacitySats: bondAmountSats,
      stakeCommitment,
      wotScore: 70 + (idx * 5) % 31,
      categories: [...categories],
      registeredAt: Math.floor(Date.now() / 1000),
    };
  });
}

/** Sign and publish a template using a specific private key. */
export async function publishAsKeypair(
  nostr: NostrPublishable,
  template: ReturnType<typeof buildJurorCandidacyEvent>,
  privateKey: Uint8Array,
): Promise<NostrEvent> {
  const event = finalizeEvent(template, privateKey);
  await nostr.event(event, { signal: AbortSignal.timeout(5000) });
  return event as NostrEvent;
}

export interface PublishSimulationOptions {
  nostr: NostrPublishable;
  disputeId: string;
  marketId: string;
  userPubkey: string;
  userBondAmountSats: number;
  peerCount?: number;
  categories?: readonly string[];
}

/**
 * Publish simulated peer juror candidacy events and a jury-selection event.
 * The current user is always included as juror #1.
 */
export async function publishSimulatedJury(
  options: PublishSimulationOptions,
): Promise<SimulatedJury> {
  const {
    nostr,
    disputeId,
    marketId,
    userPubkey,
    userBondAmountSats,
    peerCount = 2,
    categories = ['world'],
  } = options;

  const peers = generateSimulatedJurors(peerCount, categories, userBondAmountSats);

  // Publish peer candidacy events.
  await Promise.all(
    peers.map((peer) => {
      const template = buildJurorCandidacyEvent({
        disputeId,
        marketId,
        juror: peer,
        bondAmountSats: userBondAmountSats,
        bondAddress: peer.stakeCommitment.bondAddress,
        bondTxid: peer.stakeCommitment.bondTxid,
        bondVout: peer.stakeCommitment.bondVout,
      });
      // Tag events as demo so relays / UIs can filter them if desired.
      template.tags.push(['demo', 'court-simulator']);
      return publishAsKeypair(nostr, template, peer.privateKey);
    }),
  );

  // Build the jury list: user is always juror #1, peers follow.
  const selected: SelectedJuror[] = [
    {
      idx: 1,
      nostrPubkey: userPubkey,
      stakeCapacitySats: userBondAmountSats,
      stakeCommitment: {
        amountSats: userBondAmountSats,
        bondAddress: makeMockBondAddress(1),
        bondTxid: makeMockBondTxid(1),
        bondVout: 0,
        status: 'confirmed',
        committedAt: Math.floor(Date.now() / 1000),
      },
      wotScore: 85,
      categories: [...categories],
      registeredAt: Math.floor(Date.now() / 1000),
      priority: 0,
    },
    ...peers.map((peer): SelectedJuror => ({
      idx: peer.idx,
      nostrPubkey: peer.nostrPubkey,
      stakeCapacitySats: peer.stakeCapacitySats,
      stakeCommitment: peer.stakeCommitment,
      wotScore: peer.wotScore,
      categories: peer.categories,
      registeredAt: peer.registeredAt,
      priority: peer.idx,
    })),
  ];

  // Build selection event independently (no coordinator; each juror publishes their own copy).
  const selectionTemplate = buildSelectionEvent({
    disputeId,
    marketId,
    selectedJurors: selected.map((j) => ({ idx: j.idx, pubkey: j.nostrPubkey, stake: j.stakeCapacitySats })),
    backupJurors: [],
    seed: '0000000000000000000000000000000000000000000000000000000000000001',
    blockHash: '0000000000000000000000000000000000000000000000000000000000000000',
    publisherPubkey: userPubkey,
  });
  selectionTemplate.tags.push(['demo', 'court-simulator']);
  saveSimulatedSelection(disputeId, selected);
  return { jurors: peers, selected, selectionTemplate };
}

/**
 * Persist the simulated jury selection locally so a reload can reconstruct the
 * full juror profiles (selection events only store idx/pubkey/stake).
 */
export function saveSimulatedSelection(disputeId: string, selected: SelectedJuror[]): void {
  try {
    const raw = localStorage.getItem(SIMULATION_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, SelectedJuror[]>) : {};
    map[disputeId] = selected;
    localStorage.setItem(SIMULATION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors.
  }
}

/** Load a previously persisted simulated jury selection, if any. */
export function loadSimulatedSelection(disputeId: string): SelectedJuror[] | null {
  try {
    const raw = localStorage.getItem(SIMULATION_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, SelectedJuror[]>;
    const selected = map[disputeId];
    return selected && selected.length > 0 ? selected : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demo-room helpers
// ---------------------------------------------------------------------------

export interface DemoRoomMember {
  readonly pubkey: string;
  readonly categories: readonly string[];
  readonly joinedAt: number;
  readonly eventId: string;
}

export interface DemoRoomState {
  readonly roomName: string;
  readonly category: string;
  readonly threshold: number;
  readonly pace: 'guided' | 'fast';
}

function isHex64(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Derive a stable room id from the room name + category. */
export function deriveRoomId(roomName: string, category: string): string {
  const normalized = `${roomName.trim().toLowerCase()}|${category.trim().toLowerCase()}`;
  return bytesToHex(sha256(new TextEncoder().encode(normalized)));
}

/** Derive a deterministic dispute id from the room + members + round. */
export function deriveMockDisputeId(
  roomId: string,
  memberPubkeys: readonly string[],
  round = 1,
): string {
  const input = [roomId, String(round), ...[...memberPubkeys].sort()].join('|');
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/** Build deterministic selected juror profiles from a settled roster. */
export function buildDemoSelectedJurors(
  memberPubkeys: readonly string[],
  category: string,
): SelectedJuror[] {
  const sorted = [...memberPubkeys].sort();
  const joinedAt = nowSeconds();
  return sorted.map((pubkey, i): SelectedJuror => {
    const idx = i + 1;
    return {
      idx,
      nostrPubkey: pubkey,
      stakeCapacitySats: DEMO_BOND_AMOUNT_SATS,
      stakeCommitment: {
        amountSats: DEMO_BOND_AMOUNT_SATS,
        bondAddress: makeMockBondAddress(idx),
        bondTxid: makeMockBondTxid(idx),
        bondVout: 0,
        status: 'confirmed',
        committedAt: joinedAt,
      },
      wotScore: 80,
      categories: [category],
      registeredAt: joinedAt,
      priority: idx,
    };
  });
}

/** Build a demo-room membership event template. */
export function buildDemoMembershipEvent(params: {
  roomId: string;
  category: string;
  publisherPubkey?: string;
}): ReturnType<typeof buildJurorCandidacyEvent> {
  const { roomId, category, publisherPubkey } = params;
  const tags: string[][] = [
    ['room', roomId],
    ['category', category],
    ['t', category],
    ['bond', String(DEMO_BOND_AMOUNT_SATS)],
    ['demo', 'court-simulator'],
    ['alt', `BAO Court demo jury room ${roomId.slice(0, 12)}`],
  ];
  if (publisherPubkey) {
    tags.push(['p', publisherPubkey]);
  }
  return {
    kind: BAO_COURT_DEMO_MEMBERSHIP_KIND,
    created_at: nowSeconds(),
    tags,
    content: JSON.stringify({
      categories: [category],
      bondAmountSats: DEMO_BOND_AMOUNT_SATS,
      demo: true,
    }),
  };
}

/** Parse a demo-room membership event. */
export function parseDemoMembershipEvent(event: NostrEvent): DemoRoomMember | null {
  if (event.kind !== BAO_COURT_DEMO_MEMBERSHIP_KIND || !event.pubkey || !isHex64(event.pubkey)) {
    return null;
  }
  const roomTag = event.tags.find((t) => t[0] === 'room');
  if (!roomTag?.[1]) return null;
  const categoryTag = event.tags.find((t) => t[0] === 'category');
  const demoTag = event.tags.find((t) => t[0] === 'demo');
  if (!demoTag || demoTag[1] !== 'court-simulator') return null;

  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(event.content || '{}') as Record<string, unknown>;
  } catch {
    return null;
  }

  const categories = Array.isArray(content.categories)
    ? content.categories.filter((c): c is string => typeof c === 'string')
    : categoryTag?.[1]
      ? [categoryTag[1]]
      : [];

  return {
    pubkey: event.pubkey,
    categories,
    joinedAt: event.created_at,
    eventId: event.id,
  };
}

/**
 * Build a mock BAO Court dispute event for a demo room.
 *
 * Every juror publishes their own copy independently. There is no coordinator;
 * the publishing juror is both challenger and publisher for their local view.
 */
export function buildMockDisputeEvent(params: {
  disputeId: string;
  roomId: string;
  category: string;
  publisherPubkey: string;
  originalOutcome?: string;
  proposedOutcome?: string;
  disputeDeadline?: number;
}): ReturnType<typeof buildDisputeEvent> {
  const {
    disputeId,
    roomId,
    category,
    publisherPubkey,
    originalOutcome = 'Original outcome',
    proposedOutcome = `Demo dispute: ${category}`,
    disputeDeadline = nowSeconds() + 86_400,
  } = params;

  const template = buildDisputeEvent({
    marketId: `demo-${category}`,
    disputeId,
    originalOutcome,
    proposedOutcome,
    challengerPubkey: publisherPubkey,
    evidenceHashes: [],
    disputeDeadline,
    publisherPubkey,
  });

  template.tags.push(['demo', 'court-simulator']);
  template.tags.push(['room', roomId]);
  template.tags.push(['category', category]);
  return template;
}

/** Build a deterministic DKG seed from the room + dispute + sorted juror pubkeys. */
export function deriveDkgSeed(params: {
  roomId: string;
  disputeId: string;
  jurorPubkeys: readonly string[];
}): string {
  const input = [
    params.roomId,
    params.disputeId,
    ...[...params.jurorPubkeys].sort(),
  ].join('|');
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/** Persist the active demo room so a reload can rejoin the lobby. */
export function saveDemoRoom(state: DemoRoomState): void {
  try {
    localStorage.setItem(DEMO_ROOM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors.
  }
}

/** Load a persisted demo room, if any. */
export function loadDemoRoom(): DemoRoomState | null {
  try {
    const raw = localStorage.getItem(DEMO_ROOM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'roomName' in parsed &&
      typeof parsed.roomName === 'string' &&
      'category' in parsed &&
      typeof parsed.category === 'string' &&
      'threshold' in parsed &&
      typeof parsed.threshold === 'number' &&
      'pace' in parsed &&
      (parsed.pace === 'guided' || parsed.pace === 'fast')
    ) {
      return parsed as DemoRoomState;
    }
  } catch {
    // Ignore storage errors.
  }
  return null;
}

/** Clear the persisted demo room. */
export function clearDemoRoom(): void {
  try {
    localStorage.removeItem(DEMO_ROOM_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
