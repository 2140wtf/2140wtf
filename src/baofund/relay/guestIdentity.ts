/**
 * guestIdentity - login-free Nostr identity for BAO Fund.
 *
 * A per-browser seeded key (random hex in localStorage), mirroring the
 * guest-login model of the parent apps. Signs NIP-98 (kind-27235) auth
 * events and kind-38003 creation intents via nostr-tools.finalizeEvent.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes, bytesToHex, randomBytes } from '@noble/hashes/utils.js';

const KEY_STORAGE = 'bao-fund-guest-key';

export function getGuestKeyHex(): string {
  const existing = localStorage.getItem(KEY_STORAGE);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const sk = bytesToHex(randomBytes(32));
  localStorage.setItem(KEY_STORAGE, sk);
  return sk;
}

export function getGuestPubkeyHex(): string {
  return getPublicKey(hexToBytes(getGuestKeyHex()));
}

export interface BaoSigner {
  signEvent(event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }): Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>;
  /** BIP-340 schnorr signature over a raw 32-byte hash (hex) - needed for
   *  on-chain escrow releases. Optional: passkey/NIP-46 signers may not
   *  expose raw-hash signing; callers must fail gracefully. */
  signSchnorr?(hashHex: string): Promise<string>;
}

/** A SignerLike that signs with the guest key (NIP-98 and intents). */
export function createGuestSigner(): BaoSigner {
  const skHex = getGuestKeyHex();
  return {
    async signEvent(event) {
      const signed = finalizeEvent(
        { kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content },
        hexToBytes(skHex),
      );
      return signed as {
        id: string;
        pubkey: string;
        sig: string;
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
      };
    },
  };
}
