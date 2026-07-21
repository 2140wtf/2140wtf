import { nip44 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

/**
 * Abstract NIP-44 encryption provider.
 *
 * Implementations may be backed by a raw secret key (e.g. nsec stored locally)
 * or by an external signer such as a browser extension or NIP-46 bunker that
 * never exposes the private key.
 */
export interface Nip44Crypto {
  encrypt(plaintext: string, peerPubkey: string): Promise<string> | string;
  decrypt(ciphertext: string, peerPubkey: string): Promise<string> | string;
}

function normalizeSeckey(seckey: string | Uint8Array): Uint8Array {
  return typeof seckey === 'string' ? hexToBytes(seckey) : seckey;
}

/**
 * NIP-44 crypto implementation backed by a raw 32-byte secret key.
 */
export class Nip44SeckeyCrypto implements Nip44Crypto {
  private readonly seckey: Uint8Array;

  constructor(seckey: string | Uint8Array) {
    this.seckey = normalizeSeckey(seckey);
  }

  encrypt(plaintext: string, peerPubkey: string): string {
    const conversationKey = nip44.getConversationKey(this.seckey, peerPubkey);
    return nip44.encrypt(plaintext, conversationKey);
  }

  decrypt(ciphertext: string, peerPubkey: string): string {
    const conversationKey = nip44.getConversationKey(this.seckey, peerPubkey);
    return nip44.decrypt(ciphertext, conversationKey);
  }
}
