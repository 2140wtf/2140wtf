import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';

import { GroupChatService, type GroupChatSigner } from './groupChatService';
import {
  KIND_GROUP,
  createGroupEvent,
  createWelcomeEvent,
  unwrapWelcomeEvent,
  wrapWelcomeEvent,
} from './nip104Protocol';

const DEFAULT_RELAYS = ['wss://relay.test'];

/**
 * A mock signer that delegates to a real NSecSigner (so signatures and NIP-44
 * payloads are genuinely valid) while spying on every call. Stands in for a
 * browser extension or bunker signer.
 */
function createMockSigner(privkey: Uint8Array) {
  const inner = new NSecSigner(privkey);
  const signer: GroupChatSigner = {
    signEvent: vi.fn((event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => inner.signEvent(event)),
    nip44: {
      encrypt: vi.fn((pubkey: string, plaintext: string) => inner.nip44.encrypt(pubkey, plaintext)),
      decrypt: vi.fn((pubkey: string, ciphertext: string) => inner.nip44.decrypt(pubkey, ciphertext)),
    },
  };
  return signer;
}

function createUser() {
  const privkey = generateSecretKey();
  const pubkey = getPublicKey(privkey).toLowerCase();
  return { pubkey, signer: createMockSigner(privkey) };
}

describe('GroupChatService signer support', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('throws when the signer does not support NIP-44', () => {
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey).toLowerCase();
    const inner = new NSecSigner(privkey);
    const signerWithoutNip44: GroupChatSigner = {
      signEvent: (event) => inner.signEvent(event),
    };

    expect(() => new GroupChatService(pubkey, signerWithoutNip44, DEFAULT_RELAYS)).toThrow(
      'NIP-44',
    );
  });

  it('creates a group and sends messages through a mock signer', async () => {
    const admin = createUser();
    const service = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await service.createGroup('Signer Group', undefined, DEFAULT_RELAYS);
    expect(createResult.success).toBe(true);
    const groupId = createResult.data!.nostrGroupId;

    const send = await service.sendMessage(groupId, 'hello via signer');
    expect(send.success).toBe(true);
    expect(send.data!.content).toBe('hello via signer');

    // The application message was signed through the signer, not a raw key.
    expect(admin.signer.signEvent).toHaveBeenCalled();
  });

  it('encrypts and decrypts welcome events through signer.nip44', async () => {
    const admin = createUser();
    const member = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Welcome Group', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const invite = await adminService.addMember(groupId, member.pubkey);
    expect(invite.success).toBe(true);
    const memberWrap = invite.events?.find((e) =>
      e.tags.some(([name, value]) => name === 'p' && value === member.pubkey),
    );
    expect(memberWrap).toBeDefined();

    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    const join = await memberService.joinFromWelcome(memberWrap!);
    expect(join.success).toBe(true);

    // The member's signer — not a raw private key — decrypted the gift wrap.
    expect(member.signer.nip44!.decrypt).toHaveBeenCalledWith(memberWrap!.pubkey, memberWrap!.content);

    // Both sides can exchange messages end-to-end.
    const send = await adminService.sendMessage(groupId, 'secret message');
    const receive = await memberService.processGroupEvent(send.events![0]);
    expect(receive.success).toBe(true);
    expect(receive.data!.content).toBe('secret message');
  });
});

describe('GroupChatService security fixes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('promoteAdmin produces rotation Welcomes that keep members in sync', async () => {
    const admin = createUser();
    const member = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Promotions', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const invite = await adminService.addMember(groupId, member.pubkey);
    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    await memberService.joinFromWelcome(invite.events![0]);

    const promote = await adminService.promoteAdmin(groupId, member.pubkey);
    expect(promote.success).toBe(true);
    // The service hands the caller gift-wrapped Welcomes to publish; without
    // them the group would fork permanently.
    expect(promote.events!.length).toBeGreaterThan(0);
    const memberWrap = promote.events!.find((e) =>
      e.tags.some(([name, value]) => name === 'p' && value === member.pubkey),
    );
    expect(memberWrap).toBeDefined();

    // A member that receives the Welcome converges on the new epoch instead of forking.
    const join = await memberService.joinFromWelcome(memberWrap!);
    expect(join.success).toBe(true);
    expect(memberService.getGroup(groupId)!.epoch).toBe(2);
    expect(memberService.getGroup(groupId)!.adminPubkeys).toContain(member.pubkey);

    // The promoted admin can send at the new epoch and the old admin can read it.
    const send = await memberService.sendMessage(groupId, 'post-promotion');
    const receive = await adminService.processGroupEvent(send.events![0]);
    expect(receive.success).toBe(true);
    expect(receive.data!.content).toBe('post-promotion');
  });

  it('rejects a Welcome forwarded to an outsider', async () => {
    const admin = createUser();
    const member = createUser();
    const outsider = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Forwarding', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const invite = await adminService.addMember(groupId, member.pubkey);
    const memberWrap = invite.events!.find((e) =>
      e.tags.some(([name, value]) => name === 'p' && value === member.pubkey),
    )!;

    // A malicious member decrypts their Welcome and re-wraps it for an outsider.
    const welcomeEvent = await unwrapWelcomeEvent(memberWrap, member.signer);
    expect(welcomeEvent).not.toBeNull();
    const forwardedWrap = await wrapWelcomeEvent(welcomeEvent!, outsider.pubkey);

    const outsiderService = new GroupChatService(outsider.pubkey, outsider.signer, DEFAULT_RELAYS);
    const join = await outsiderService.joinFromWelcome(forwardedWrap);
    expect(join.success).toBe(false);
    expect(join.error).toMatch(/not addressed/);
    expect(outsiderService.getGroup(groupId)).toBeUndefined();

    // The intended recipient can still join.
    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    const legitJoin = await memberService.joinFromWelcome(memberWrap);
    expect(legitJoin.success).toBe(true);
  });

  it('rejects Welcome payloads without a recipient binding', async () => {
    const admin = createUser();
    const member = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Legacy Welcome', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    // A legacy (or crafted) Welcome from the admin that lacks a recipient.
    const payload = JSON.stringify({
      groupId,
      epoch: 1,
      type: 'member_add',
      rootSecret: 'a'.repeat(64),
      exporterSecret: 'b'.repeat(64),
      members: [admin.pubkey, member.pubkey],
      metadata: JSON.stringify({
        nostrGroupId: groupId,
        name: 'Legacy Welcome',
        adminPubkeys: [admin.pubkey],
        relays: DEFAULT_RELAYS,
      }),
    });
    const welcomeEvent = await createWelcomeEvent(admin.pubkey, admin.signer, payload, 'placeholder', DEFAULT_RELAYS, 1);
    const wrap = await wrapWelcomeEvent(welcomeEvent, member.pubkey);

    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    const join = await memberService.joinFromWelcome(wrap);
    expect(join.success).toBe(false);
    expect(join.error).toMatch(/not addressed/);
  });

  it('rejects future-epoch events beyond the epoch gap instead of buffering them', async () => {
    const admin = createUser();
    const service = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await service.createGroup('Epoch Gap', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const flood = await createGroupEvent(groupId, 'junk', 'a'.repeat(64), 999999);
    const result = await service.processGroupEvent(flood);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/epoch too far/);

    const pending = (service as unknown as { pendingGroupEvents: Map<string, NostrEvent[]> })
      .pendingGroupEvents.get(groupId);
    expect(pending ?? []).toHaveLength(0);
  });

  it('caps the future-epoch buffer and evicts the oldest events', async () => {
    const admin = createUser();
    const service = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await service.createGroup('Buffer Cap', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    // Epoch 1 is within the allowed gap, so these are buffered.
    const first = await createGroupEvent(groupId, 'm0', 'a'.repeat(64), 1);
    await service.processGroupEvent(first);
    let lastId = '';
    for (let i = 1; i <= 210; i++) {
      const event = await createGroupEvent(groupId, `m${i}`, 'a'.repeat(64), 1);
      lastId = event.id;
      await service.processGroupEvent(event);
    }

    const pending = (service as unknown as { pendingGroupEvents: Map<string, NostrEvent[]> })
      .pendingGroupEvents.get(groupId)!;
    expect(pending).toHaveLength(200);
    // The oldest event was evicted; the newest is retained.
    expect(pending.some((e) => e.id === first.id)).toBe(false);
    expect(pending.some((e) => e.id === lastId)).toBe(true);
  });

  it('drops absurdly old future-epoch events instead of buffering them', async () => {
    const admin = createUser();
    const service = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await service.createGroup('Old Events', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const oldEvent = finalizeEvent({
      kind: KIND_GROUP,
      created_at: Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60,
      tags: [
        ['h', groupId],
        ['epoch', '1'],
      ],
      content: 'ancient ciphertext',
    }, generateSecretKey()) as unknown as NostrEvent;

    const result = await service.processGroupEvent(oldEvent);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too old/);

    const pending = (service as unknown as { pendingGroupEvents: Map<string, NostrEvent[]> })
      .pendingGroupEvents.get(groupId);
    expect(pending ?? []).toHaveLength(0);
  });

  it('leaveGroup rotates the epoch and notifies remaining members', async () => {
    const admin = createUser();
    const member = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Leaving', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const invite = await adminService.addMember(groupId, member.pubkey);
    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    await memberService.joinFromWelcome(invite.events![0]);

    const leave = await memberService.leaveGroup(groupId);
    expect(leave.success).toBe(true);
    // The leaver produces rotation Welcomes for the remaining members.
    expect(leave.events).toHaveLength(1);
    const adminWrap = leave.events!.find((e) =>
      e.tags.some(([name, value]) => name === 'p' && value === admin.pubkey),
    )!;

    // The leaver wiped their local state.
    expect(memberService.getGroup(groupId)).toBeUndefined();

    // The remaining member treats the leave notice as a rotation trigger.
    const rotation = await adminService.joinFromWelcome(adminWrap);
    expect(rotation.success).toBe(true);
    const group = adminService.getGroup(groupId)!;
    expect(group.epoch).toBe(2);
    expect(group.members).not.toContain(member.pubkey);

    // Post-rotation traffic uses the new epoch, which the leaver never received.
    const send = await adminService.sendMessage(groupId, 'after leave');
    expect(send.data!.epoch).toBe(2);
  });

  it('rejects leave notices from non-members', async () => {
    const admin = createUser();
    const attacker = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Fake Leave', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const payload = JSON.stringify({
      groupId,
      epoch: 1,
      type: 'member_leave',
      recipient: admin.pubkey,
      rootSecret: 'a'.repeat(64),
      exporterSecret: 'b'.repeat(64),
      members: [admin.pubkey],
      metadata: JSON.stringify({
        nostrGroupId: groupId,
        name: 'Fake Leave',
        adminPubkeys: [admin.pubkey],
        relays: DEFAULT_RELAYS,
      }),
    });
    const fakeNotice = await createWelcomeEvent(attacker.pubkey, attacker.signer, payload, 'placeholder', DEFAULT_RELAYS, 1);
    const wrap = await wrapWelcomeEvent(fakeNotice, admin.pubkey);

    const result = await adminService.joinFromWelcome(wrap);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not from a group member/);
  });

  it('blocks the sole admin from leaving while other members remain', async () => {
    const admin = createUser();
    const member = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Sole Admin', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;
    await adminService.addMember(groupId, member.pubkey);

    const leave = await adminService.leaveGroup(groupId);
    expect(leave.success).toBe(false);
    expect(leave.error).toMatch(/Transfer admin role/);
    expect(adminService.getGroup(groupId)).toBeDefined();
  });

  it('sendMessage tags and encrypts with the same epoch under concurrent rotation', async () => {
    const admin = createUser();
    const member = createUser();
    const other = createUser();
    const adminService = new GroupChatService(admin.pubkey, admin.signer, DEFAULT_RELAYS);

    const createResult = await adminService.createGroup('Atomic', undefined, DEFAULT_RELAYS);
    const groupId = createResult.data!.nostrGroupId;

    const invite = await adminService.addMember(groupId, member.pubkey);
    const memberService = new GroupChatService(member.pubkey, member.signer, DEFAULT_RELAYS);
    await memberService.joinFromWelcome(invite.events![0]);

    // Gate the next signEvent call so a rotation can try to interleave between
    // reading the exporter secret and creating the group event.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signEventMock = vi.mocked(admin.signer.signEvent);
    const originalSign = signEventMock.getMockImplementation()!;
    signEventMock.mockImplementationOnce(async (event) => {
      await gate;
      return originalSign(event);
    });

    const sendPromise = adminService.sendMessage(groupId, 'atomic message');
    // Wait until sendMessage is blocked inside the signer.
    await vi.waitFor(() => expect(signEventMock).toHaveBeenCalled());
    const rotatePromise = adminService.addMember(groupId, other.pubkey);
    release();

    const [send, rotate] = await Promise.all([sendPromise, rotatePromise]);
    expect(send.success).toBe(true);
    expect(rotate.success).toBe(true);

    // The event is tagged with the same epoch whose key encrypted it (epoch 1),
    // not the epoch the concurrent rotation bumped the group to (epoch 2).
    const epochTag = send.events![0].tags.find(([name]) => name === 'epoch')?.[1];
    expect(epochTag).toBe('1');
    expect(send.data!.epoch).toBe(1);

    // A member who catches up to epoch 2 can still decrypt the epoch-1 message.
    const catchUpWrap = rotate.events!.find((e) =>
      e.tags.some(([name, value]) => name === 'p' && value === member.pubkey),
    )!;
    const catchUp = await memberService.joinFromWelcome(catchUpWrap);
    expect(catchUp.success).toBe(true);

    const received = await memberService.processGroupEvent(send.events![0]);
    expect(received.success).toBe(true);
    expect(received.data!.content).toBe('atomic message');
  });
});
