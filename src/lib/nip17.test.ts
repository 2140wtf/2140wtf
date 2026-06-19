import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';

import {
  buildNip17GiftWraps,
  unwrapNip17Message,
  computeNip17ConversationId,
  getNip17Participants,
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
      sender: other,
      recipients: [viewer],
      content: 'hi',
      createdAt: 1,
    };
    expect(getNip17Participants(message, viewer)).toEqual([other]);
  });
});
