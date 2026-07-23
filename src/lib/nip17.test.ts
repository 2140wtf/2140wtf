import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { getEventHash } from 'nostr-tools/pure';

import {
  buildNip17GiftWraps,
  unwrapNip17Message,
  computeNip17ConversationId,
  getNip17Participants,
  createNip17Rumor,
  sealNip17Rumor,
  giftWrapNip17Seal,
  parseNip17Rumor,
  getNip17DmRelays,
  type Rumor,
} from './nip17';

function createTestSigner(secretKey: Uint8Array): {
  getPublicKey: () => Promise<string>;
  signEvent: (t: { kind: number; content: string; created_at: number; tags: string[][] }) => Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  }>;
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
} {
  return {
    getPublicKey: async () => getPublicKey(secretKey),
    signEvent: async (t) => {
      const { finalizeEvent } = await import('nostr-tools/pure');
      return finalizeEvent(t, secretKey) as ReturnType<typeof createTestSigner>['signEvent'] extends (_: unknown) => Promise<infer R> ? R : never;
    },
    nip44: {
      encrypt: async (pubkey, plaintext) => {
        const key = nip44.getConversationKey(secretKey, pubkey);
        return nip44.encrypt(plaintext, key);
      },
      decrypt: async (pubkey, ciphertext) => {
        const key = nip44.getConversationKey(secretKey, pubkey);
        return nip44.decrypt(ciphertext, key);
      },
    },
  };
}

describe('NIP-17 helpers', () => {
  it('builds and unwraps a 1:1 message', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const senderPubkey = getPublicKey(senderSk);
    const recipientPubkey = getPublicKey(recipientSk);

    const senderSigner = createTestSigner(senderSk);
    const recipientSigner = createTestSigner(recipientSk);

    const { rumor, wraps } = await buildNip17GiftWraps(
      senderSigner,
      [recipientPubkey],
      'Hello, NIP-17!',
      { subject: 'Test subject' },
    );

    expect(wraps).toHaveLength(2);
    expect(rumor.content).toBe('Hello, NIP-17!');
    expect(rumor.kind).toBe(14);
    expect(rumor.tags).toContainEqual(['p', recipientPubkey]);
    expect(rumor.tags).toContainEqual(['subject', 'Test subject']);

    // Recipient unwraps their copy
    const recipientWrap = wraps.find((w) => w.tags.some(([name, value]) => name === 'p' && value === recipientPubkey));
    expect(recipientWrap).toBeDefined();
    const received = await unwrapNip17Message(recipientWrap!, recipientSigner);
    expect(received).not.toBeNull();
    expect(received!.content).toBe('Hello, NIP-17!');
    expect(received!.sender).toBe(senderPubkey);
    expect(received!.recipients).toEqual([recipientPubkey]);
    expect(received!.subject).toBe('Test subject');

    // Sender unwraps their self-copy
    const senderWrap = wraps.find((w) => w.tags.some(([name, value]) => name === 'p' && value === senderPubkey));
    expect(senderWrap).toBeDefined();
    const selfCopy = await unwrapNip17Message(senderWrap!, senderSigner);
    expect(selfCopy).not.toBeNull();
    expect(selfCopy!.content).toBe('Hello, NIP-17!');
  });

  it('fails to unwrap a tampered rumor', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const attackerSk = generateSecretKey();

    const senderSigner = createTestSigner(senderSk);
    const recipientSigner = createTestSigner(recipientSk);

    const { wraps } = await buildNip17GiftWraps(senderSigner, [recipientPubkey], 'secret');
    const recipientWrap = wraps.find((w) =>
      w.tags.some(([name, value]) => name === 'p' && value === recipientPubkey),
    )!;

    // An attacker cannot decrypt the recipient's wrap with their own key
    const attackerSigner = createTestSigner(attackerSk);
    const received = await unwrapNip17Message(recipientWrap, attackerSigner);
    expect(received).toBeNull();

    // The legitimate recipient still can
    const legitimate = await unwrapNip17Message(recipientWrap, recipientSigner);
    expect(legitimate).not.toBeNull();
    expect(legitimate!.content).toBe('secret');
  });

  it('computes stable conversation ids', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(computeNip17ConversationId([a, b])).toBe(computeNip17ConversationId([b, a]));
    expect(computeNip17ConversationId([a, b, a])).toBe(computeNip17ConversationId([a, b]));
  });

  it('extracts participants excluding viewer', () => {
    const viewer = 'v'.repeat(64);
    const other = 'o'.repeat(64);
    const message = {
      id: '1',
      wrapId: '1',
      kind: 14,
      sender: other,
      recipients: [viewer],
      content: 'hi',
      tags: [],
      createdAt: 1,
    };
    expect(getNip17Participants(message, viewer)).toEqual([other]);
  });
});


describe('NIP-17 adversarial simulator', () => {
  it('rejects a gift wrap with an invalid signature', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const senderSigner = createTestSigner(senderSk);
    const recipientSigner = createTestSigner(recipientSk);

    const { wraps } = await buildNip17GiftWraps(senderSigner, [recipientPubkey], 'secret');
    const wrap = wraps[0]!;

    // Corrupt the signature
    const corrupted = { ...wrap, sig: '0'.repeat(128) };
    const received = await unwrapNip17Message(corrupted, recipientSigner);
    expect(received).toBeNull();
  });

  it('rejects a seal whose author does not match the rumor author', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const attackerSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const senderSigner = createTestSigner(senderSk);
    const recipientSigner = createTestSigner(recipientSk);
    const attackerSigner = createTestSigner(attackerSk);

    const rumor = await createNip17Rumor(senderSigner, [recipientPubkey], 'secret');
    // An attacker creates a seal claiming to be from the sender, but signs with their own key.
    const forgedSeal = await sealNip17Rumor(attackerSigner, rumor, recipientPubkey);
    const wrap = giftWrapNip17Seal(forgedSeal, recipientPubkey);

    const received = await unwrapNip17Message(wrap, recipientSigner);
    expect(received).toBeNull();
  });

  it('rejects a rumor with a forged id hash', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const senderSigner = createTestSigner(senderSk);
    const recipientSigner = createTestSigner(recipientSk);

    const rumor = await createNip17Rumor(senderSigner, [recipientPubkey], 'secret');
    const tamperedRumor: Rumor = { ...rumor, content: 'tampered', id: rumor.id };
    const seal = await sealNip17Rumor(senderSigner, tamperedRumor, recipientPubkey);
    const wrap = giftWrapNip17Seal(seal, recipientPubkey);

    const received = await unwrapNip17Message(wrap, recipientSigner);
    expect(received).toBeNull();
  });

  it('rejects a rumor from the future', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const senderSigner = createTestSigner(senderSk);

    const rumor = await createNip17Rumor(senderSigner, [recipientPubkey], 'hi');
    rumor.created_at = Math.floor(Date.now() / 1000) + 600;
    rumor.id = getEventHash(rumor);

    const parsed = parseNip17Rumor(rumor);
    expect(parsed).toBeNull();
  });

  it('rejects an oversized rumor', async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPubkey = getPublicKey(recipientSk);
    const senderSigner = createTestSigner(senderSk);

    const rumor = await createNip17Rumor(senderSigner, [recipientPubkey], 'x'.repeat(20000));
    const parsed = parseNip17Rumor(rumor);
    expect(parsed).toBeNull();
  });

  it('rejects a malformed rumor shape', async () => {
    const malformed = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      content: 'hi',
      created_at: 1,
      kind: 14,
      tags: 'not-an-array',
    } as unknown as Parameters<typeof parseNip17Rumor>[0];
    expect(parseNip17Rumor(malformed)).toBeNull();
  });

  it('extracts DM relays from a kind 10050 event', () => {
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      kind: 10050,
      content: '',
      created_at: 1,
      tags: [
        ['relay', 'wss://dm.example.com'],
        ['relay', 'not-a-url'],
        ['relay', 'wss://dm2.example.com'],
      ],
    };
    expect(getNip17DmRelays(event)).toEqual(['wss://dm.example.com', 'wss://dm2.example.com']);
  });
});
