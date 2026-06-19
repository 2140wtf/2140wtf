import { describe, expect, it } from 'vitest';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { deriveNutzapKey } from './cashu';

describe('deriveNutzapKey', () => {
  it('derives a deterministic compressed pubkey from a seed phrase', () => {
    const phrase = generateMnemonic(wordlist);
    const a = deriveNutzapKey(phrase);
    const b = deriveNutzapKey(phrase);

    expect(a.pubkey).toBe(b.pubkey);
    expect(a.pubkey).toMatch(/^0[2-3][0-9a-f]{64}$/i);
    expect(a.privkey).toHaveLength(32);

    // The public key matches the private key.
    const pubkeyBytes = secp256k1.getPublicKey(a.privkey, true);
    expect(Buffer.from(pubkeyBytes).toString('hex')).toBe(a.pubkey.toLowerCase());
  });

  it('produces different keys for different seed phrases', () => {
    const a = deriveNutzapKey(generateMnemonic(wordlist));
    const b = deriveNutzapKey(generateMnemonic(wordlist));
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('derives a key different from the BIP-39 seed', () => {
    const phrase = generateMnemonic(wordlist);
    const seed = mnemonicToSeedSync(phrase);
    const nutzap = deriveNutzapKey(phrase);
    // The nutzap private key must not equal the raw seed.
    expect(Buffer.from(nutzap.privkey).toString('hex')).not.toBe(Buffer.from(seed.slice(0, 32)).toString('hex'));
  });
});
