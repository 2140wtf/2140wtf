import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';

import { GroupChatService, type GroupChatSigner } from './groupChatService';

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
