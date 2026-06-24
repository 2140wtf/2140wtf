import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { BAO_COURT_JUROR_CANDIDACY_KIND, BAO_COURT_SELECTION_KIND } from '@bao/frost-court';

import {
  BAO_COURT_DEMO_MEMBERSHIP_KIND,
  DEMO_BOND_AMOUNT_SATS,
  buildDemoMembershipEvent,
  buildDemoSelectedJurors,
  deriveDkgSeed,
  deriveMockDisputeId,
  deriveRoomId,
  generateSimulatedJurors,
  loadSimulatedSelection,
  parseDemoMembershipEvent,
  publishSimulatedJury,
  saveSimulatedSelection,
} from './baoCourtSimulator';

describe('BAO Court simulator', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates deterministic peer jurors with valid nostr pubkeys', () => {
    const peers = generateSimulatedJurors(2, ['world'], 50_000);
    expect(peers).toHaveLength(2);
    expect(peers[0].idx).toBe(2);
    expect(peers[1].idx).toBe(3);

    for (const peer of peers) {
      expect(peer.nostrPubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(peer.stakeCapacitySats).toBe(50_000);
      expect(peer.stakeCommitment.status).toBe('confirmed');
      expect(peer.stakeCommitment.amountSats).toBe(50_000);
      expect(peer.categories).toEqual(['world']);
    }
  });

  it('publishes peer candidacies and a selection event', async () => {
    const published: NostrEvent[] = [];
    const fakeNostr = {
      event: async (event: NostrEvent) => {
        published.push(event);
      },
    };

    const jury = await publishSimulatedJury({
      nostr: fakeNostr,
      disputeId: 'd'.repeat(64),
      marketId: 'demo-market',
      userPubkey: 'u'.repeat(64),
      userBondAmountSats: 25_000,
      peerCount: 2,
      categories: ['world'],
    });

    expect(jury.selected).toHaveLength(3);
    expect(jury.selected[0].idx).toBe(1);
    expect(jury.selected[0].nostrPubkey).toBe('u'.repeat(64));

    const candidacies = published.filter((e) => e.kind === BAO_COURT_JUROR_CANDIDACY_KIND);
    expect(candidacies).toHaveLength(2);
    for (const event of candidacies) {
      expect(event.tags.some((t) => t[0] === 'demo' && t[1] === 'court-simulator')).toBe(true);
      expect(event.pubkey).not.toBe('u'.repeat(64));
    }

    const selection = jury.selectionTemplate;
    expect(selection.kind).toBe(BAO_COURT_SELECTION_KIND);
    expect(selection.tags.some((t) => t[0] === 'demo' && t[1] === 'court-simulator')).toBe(true);

    const selectedTags = selection.tags.filter((t) => t[0] === 'selected');
    expect(selectedTags).toHaveLength(3);
  });

  it('persists and restores a simulated selection', () => {
    const disputeId = 'd'.repeat(64);
    const peer = generateSimulatedJurors(1, ['world'], 10_000)[0];
    const selected = [{
      idx: peer.idx,
      nostrPubkey: peer.nostrPubkey,
      stakeCapacitySats: peer.stakeCapacitySats,
      stakeCommitment: peer.stakeCommitment,
      wotScore: peer.wotScore,
      categories: peer.categories,
      registeredAt: peer.registeredAt,
      priority: peer.idx,
    }];

    expect(loadSimulatedSelection(disputeId)).toBeNull();
    saveSimulatedSelection(disputeId, selected);
    const restored = loadSimulatedSelection(disputeId);
    expect(restored).toHaveLength(1);
    expect(restored?.[0].nostrPubkey).toBe(selected[0].nostrPubkey);
  });

  describe('demo rooms', () => {
    it('derives stable room ids from name and category', () => {
      const a = deriveRoomId('Crypto Demo', 'crypto');
      const b = deriveRoomId('crypto demo', 'crypto');
      const c = deriveRoomId('crypto demo', 'politics');
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('derives deterministic dispute ids that change with members', () => {
      const roomId = deriveRoomId('room', 'world');
      const membersA = ['a'.repeat(64), 'b'.repeat(64)];
      const membersB = ['a'.repeat(64), 'c'.repeat(64)];
      expect(deriveMockDisputeId(roomId, membersA)).toBe(deriveMockDisputeId(roomId, membersA));
      expect(deriveMockDisputeId(roomId, membersA)).not.toBe(deriveMockDisputeId(roomId, membersB));
    });

    it('builds and parses demo membership events', () => {
      const roomId = deriveRoomId('room', 'world');
      const template = buildDemoMembershipEvent({ roomId, category: 'world' });
      expect(template.kind).toBe(BAO_COURT_DEMO_MEMBERSHIP_KIND);
      expect(template.tags).toContainEqual(['room', roomId]);
      expect(template.tags).toContainEqual(['category', 'world']);
      expect(template.tags).toContainEqual(['bond', String(DEMO_BOND_AMOUNT_SATS)]);
      expect(template.tags).toContainEqual(['demo', 'court-simulator']);

      const parsed = parseDemoMembershipEvent({
        ...template,
        id: 'event-id',
        pubkey: 'a'.repeat(64),
        sig: 'sig',
      } as NostrEvent);
      expect(parsed?.pubkey).toBe('a'.repeat(64));
      expect(parsed?.categories).toEqual(['world']);
    });

    it('builds demo selected jurors with 1 000 000 fake sats', () => {
      const jurors = buildDemoSelectedJurors(['a'.repeat(64), 'b'.repeat(64)], 'crypto');
      expect(jurors).toHaveLength(2);
      expect(jurors[0].idx).toBe(1);
      expect(jurors[0].stakeCapacitySats).toBe(DEMO_BOND_AMOUNT_SATS);
      expect(jurors[0].stakeCommitment.amountSats).toBe(DEMO_BOND_AMOUNT_SATS);
    });

    it('derives deterministic DKG seeds', () => {
      const seed = deriveDkgSeed({
        roomId: deriveRoomId('room', 'world'),
        disputeId: deriveMockDisputeId(deriveRoomId('room', 'world'), ['a'.repeat(64)]),
        jurorPubkeys: ['a'.repeat(64), 'b'.repeat(64)],
      });
      expect(seed).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
