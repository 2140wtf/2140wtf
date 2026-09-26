// src/wallet/nip60/passkeyLogin.ts
//
// Passkey-first login for the portable wallet: WebAuthn PRF (from the
// vendored bao-signer) gives a deterministic Nostr keypair - no seed
// phrase, no extension, no custodial file. The identity is wrapped as a
// SPEC-COMPLIANT NIP-44 signer (nostr-tools nip44.v2 conversation key)
// so the NIP-60 wallet can read/write encrypted config + token events
// on the user's relays, interoperably with every other NIP-44 client.

import { registerNativePasskeyAccount, loginNativePasskeyAccount, hasNativePasskeyAccount } from 'bao-signer/client';
import { createNip44IdentitySigner } from 'bao-signer/client';
import type { Nip60Signer, Nip60EventTemplate } from '@/baofund/cashu-wallet/lib/cashu/index';
// Library hex codec (single-codec rule after the v1 hand-rolled-decode
// incident): @noble/hashes validates and decodes; no local nibble math.
import { hexToBytes } from '@noble/hashes/utils.js';

export interface PasskeyIdentity {
  pubkey: string;
  nsec: string;
  signer: Nip60Signer;
}

/** True when this browser supports WebAuthn PRF (passkeys). */
export async function passkeyAvailable(): Promise<boolean> {
  try {
    const { getNativePasskeyAvailability } = await import('bao-signer/client');
    const availability = await getNativePasskeyAvailability();
    return availability.available;
  } catch {
    return false;
  }
}

export function hasPasskeyAccount(): boolean {
  try {
    return hasNativePasskeyAccount();
  } catch {
    return false;
  }
}

/**
 * Register or log in with a passkey and return a NIP-44-capable NIP-60
 * identity signer (spec-compliant conversation keys).
 */
let passkeyLoginInFlight: Promise<PasskeyIdentity> | null = null;

export async function passkeyLogin(): Promise<PasskeyIdentity> {
  // Serialize ceremonies: a 15s UI timeout abandons the promise but the
  // WebAuthn ceremony keeps writing storage; a retry must share it, not
  // interleave enrolment writes.
  if (passkeyLoginInFlight) return passkeyLoginInFlight;
  passkeyLoginInFlight = passkeyLoginCore().finally(() => { passkeyLoginInFlight = null; });
  return passkeyLoginInFlight;
}

async function passkeyLoginCore(): Promise<PasskeyIdentity> {
  let secretKeyHex: string;
  let pubkey: string;

  if (hasNativePasskeyAccount()) {
    const identity = await loginNativePasskeyAccount();
    secretKeyHex = identity.secretKey;
    pubkey = identity.pubkey;
  } else {
    const registered = await registerNativePasskeyAccount();
    secretKeyHex = registered.identity.secretKey;
    pubkey = registered.identity.pubkey;
  }
  if (!/^[0-9a-f]{64}$/.test(secretKeyHex) || !/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error('Passkey returned an invalid keypair');
  }

  const { signer } = createNip44IdentitySigner(hexToBytes(secretKeyHex));
  // NIP-60 signer shape: expose null-safe nip44Encrypt/nip44Decrypt.
  const nip60: Nip60Signer = {
    pubkey,
    nip44Encrypt: async (target, plaintext) => {
      try {
        return await signer.nip44.encrypt(target, plaintext);
      } catch {
        return null;
      }
    },
    nip44Decrypt: async (sender, ciphertext) => {
      try {
        return await signer.nip44.decrypt(sender, ciphertext);
      } catch {
        return null;
      }
    },
    signEvent: async (template: Nip60EventTemplate) => {
      try {
        return (await signer.signEvent(template)) as never;
      } catch {
        return null;
      }
    },
  };
  const identity = createNip44IdentitySigner(hexToBytes(secretKeyHex));
  return { pubkey, nsec: identity.nsec, signer: nip60 };
}

export type { Nip60Signer, Nip60EventTemplate };
