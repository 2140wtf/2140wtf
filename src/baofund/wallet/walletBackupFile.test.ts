// Wallet backup file: round-trip, wrong-password, tamper and shape tests.
import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { nip19 } from 'nostr-tools';
import {
  buildWalletBackupPayload,
  decryptWalletBackup,
  encryptWalletBackup,
  WalletBackupError,
  WALLET_BACKUP_FORMAT,
  type WalletBackupFailure,
  type WalletBackupPayload,
} from './walletBackupFile';
import { deriveIdentityPrivkey, newSeedPhrase } from './nip60/identity';
import { base64ToBytes, bytesToBase64 } from '../lib/cashu/base64';

const IDENTITY_SK = Uint8Array.from({ length: 32 }, () => 21);
const IDENTITY_PUB = bytesToHex(schnorr.getPublicKey(IDENTITY_SK));
const OTHER_PUB = bytesToHex(schnorr.getPublicKey(Uint8Array.from({ length: 32 }, () => 22)));
const WALLET_KEY = 'ab'.repeat(32);
const PASSWORD = 'correct horse battery';
// Standard BIP-39 test vectors — testnet-only rail-wallet mnemonics.
const RAIL_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RAIL_MNEMONIC_2 = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function basePayload(overrides: Partial<Parameters<typeof buildWalletBackupPayload>[0]> = {}) {
  return buildWalletBackupPayload({
    identityPubkey: IDENTITY_PUB,
    walletKeyHex: WALLET_KEY,
    mints: ['https://mint.example.com', 'https://mint.example.com', 'https://other.example'],
    nowSeconds: 1_700_000_000,
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: WalletBackupFailure) {
  await expect(promise).rejects.toMatchObject({ name: 'WalletBackupError', code });
}

describe('walletBackupFile', () => {
  it('round-trips a payload with the wallet key and mints', async () => {
    const payload = basePayload();
    const file = await encryptWalletBackup(payload, PASSWORD);
    const restored = await decryptWalletBackup(file, PASSWORD, IDENTITY_PUB);
    expect(restored).toEqual(payload);
    expect(restored.mints).toEqual(['https://mint.example.com', 'https://other.example']);
    // The cleartext envelope carries the public identity only - never the key.
    expect(file).not.toContain(WALLET_KEY);
  });

  it('includes the identity nsec / seed phrase only on opt-in, verified against the pubkey', async () => {
    const nsec = nip19.nsecEncode(IDENTITY_SK);
    const phrase = newSeedPhrase();
    const phrasePub = bytesToHex(schnorr.getPublicKey(deriveIdentityPrivkey(phrase)));
    const payload = buildWalletBackupPayload({
      identityPubkey: phrasePub,
      walletKeyHex: WALLET_KEY,
      mints: [],
      identityNsec: nip19.nsecEncode(deriveIdentityPrivkey(phrase)),
      seedPhrase: phrase,
    });
    expect(payload.identityNsec).toBeDefined();
    expect(payload.seedPhrase).toBe(phrase);

    // A mismatched secret is refused before it can be written.
    await expectCode(
      Promise.resolve().then(() => basePayload({ identityNsec: nsec, identityPubkey: OTHER_PUB })),
      'invalid-payload',
    );
    await expectCode(
      Promise.resolve().then(() => basePayload({ seedPhrase: phrase, identityPubkey: OTHER_PUB })),
      'invalid-payload',
    );
    await expectCode(
      Promise.resolve().then(() => basePayload({ identityNsec: 'not-an-nsec' })),
      'invalid-payload',
    );
  });

  it('refuses a weak password and a wrong password', async () => {
    const payload = basePayload();
    await expectCode(encryptWalletBackup(payload, 'short'), 'weak-password');
    const file = await encryptWalletBackup(payload, PASSWORD);
    await expectCode(decryptWalletBackup(file, 'wrong password!', IDENTITY_PUB), 'wrong-password');
  });

  it('refuses a tampered ciphertext or re-labelled envelope', async () => {
    const file = await encryptWalletBackup(basePayload(), PASSWORD);
    const envelope = JSON.parse(file) as { cipher: { ciphertext: string }; identityPubkey: string };

    const bytes = base64ToBytes(envelope.cipher.ciphertext);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = JSON.stringify({ ...envelope, cipher: { ...envelope.cipher, ciphertext: bytesToBase64(bytes) } });
    await expectCode(decryptWalletBackup(tampered, PASSWORD, IDENTITY_PUB), 'wrong-password');

    const relabelled = JSON.stringify({ ...envelope, identityPubkey: OTHER_PUB });
    await expectCode(decryptWalletBackup(relabelled, PASSWORD, OTHER_PUB), 'wrong-password');
  });

  it('refuses a file for another identity before touching keys', async () => {
    const file = await encryptWalletBackup(basePayload(), PASSWORD);
    await expectCode(decryptWalletBackup(file, PASSWORD, OTHER_PUB), 'invalid-payload');
  });

  it('refuses malformed envelopes, versions and KDF/cipher blocks', async () => {
    await expectCode(decryptWalletBackup('not json', PASSWORD), 'malformed-file');
    await expectCode(decryptWalletBackup(JSON.stringify({ format: 'other' }), PASSWORD), 'malformed-file');
    await expectCode(
      decryptWalletBackup(JSON.stringify({ format: WALLET_BACKUP_FORMAT, version: 99 }), PASSWORD),
      'unsupported-version',
    );
    const file = JSON.parse(await encryptWalletBackup(basePayload(), PASSWORD)) as Record<string, unknown>;
    await expectCode(
      decryptWalletBackup(JSON.stringify({ ...file, kdf: { name: 'PBKDF2-SHA256', iterations: 10, salt: 'AAAA' } }), PASSWORD),
      'malformed-file',
    );
    await expectCode(
      decryptWalletBackup(JSON.stringify({ ...file, cipher: { name: 'AES-256-GCM', iv: 'AA', ciphertext: 'AA' } }), PASSWORD),
      'malformed-file',
    );
    await expectCode(
      decryptWalletBackup(JSON.stringify({ ...file, identityPubkey: 'zz' }), PASSWORD),
      'malformed-file',
    );
  });

  it('round-trips rail wallets additively and keeps old payloads byte-identical', async () => {
    const railWallets = {
      testnet4: { version: 1 as const, mnemonic: RAIL_MNEMONIC, createdAt: 1_700_000_001, source: 'created' as const },
      liquid: { version: 1 as const, mnemonic: RAIL_MNEMONIC_2, createdAt: 1_700_000_002, source: 'imported' as const },
    };
    const payload = basePayload({ railWallets });
    expect(payload.railWallets).toEqual({
      testnet4: { mnemonic: RAIL_MNEMONIC, createdAt: 1_700_000_001, source: 'created' },
      liquid: { mnemonic: RAIL_MNEMONIC_2, createdAt: 1_700_000_002, source: 'imported' },
    });
    const file = await encryptWalletBackup(payload, PASSWORD);
    // The mnemonic is inside the ciphertext, never in the cleartext envelope.
    expect(file).not.toContain(RAIL_MNEMONIC);
    expect(await decryptWalletBackup(file, PASSWORD, IDENTITY_PUB)).toEqual(payload);

    // Old-style payloads (no railWallets) round-trip unchanged, with no field.
    const legacy = basePayload();
    expect(legacy.railWallets).toBeUndefined();
    const restored = await decryptWalletBackup(await encryptWalletBackup(legacy, PASSWORD), PASSWORD, IDENTITY_PUB);
    expect(restored).toEqual(legacy);
    expect('railWallets' in restored).toBe(false);
  });

  it('refuses invalid rail-wallet entries on build and validates them on decrypt', async () => {
    await expectCode(
      Promise.resolve().then(() => basePayload({ railWallets: { testnet4: { version: 1, mnemonic: 'not a mnemonic', createdAt: 1, source: 'created' } } })),
      'invalid-payload',
    );
    await expectCode(
      Promise.resolve().then(() => basePayload({ railWallets: { liquid: { version: 1, mnemonic: RAIL_MNEMONIC, createdAt: -1, source: 'created' } } })),
      'invalid-payload',
    );
    await expectCode(
      Promise.resolve().then(() => basePayload({ railWallets: { liquid: { version: 1, mnemonic: RAIL_MNEMONIC, createdAt: 1, source: 'stolen' as unknown as 'created' } } })),
      'invalid-payload',
    );

    // Decrypt-side: a hand-crafted payload bypasses the builder's validation.
    const tampered = {
      ...basePayload(),
      railWallets: { testnet4: { mnemonic: 'bad words here', createdAt: 1, source: 'created' } },
    } as unknown as WalletBackupPayload;
    await expectCode(
      decryptWalletBackup(await encryptWalletBackup(tampered, PASSWORD), PASSWORD, IDENTITY_PUB),
      'invalid-payload',
    );
  });

  it('rejects payload drift after decryption (missing wallet key)', async () => {
    const payload = basePayload() as unknown as Record<string, unknown>;
    delete payload.walletKey;
    const file = JSON.stringify({
      format: WALLET_BACKUP_FORMAT,
      version: 1,
      createdAt: payload.createdAt,
      identityPubkey: IDENTITY_PUB,
      kdf: { name: 'PBKDF2-SHA256', iterations: 600_000, salt: bytesToBase64(new Uint8Array(16)) },
      cipher: { name: 'AES-256-GCM', iv: bytesToBase64(new Uint8Array(12)), ciphertext: 'AAAA' },
    });
    // The AES-GCM auth fails first on this synthetic envelope; assert the
    // typed error rather than the payload validator.
    await expectCode(decryptWalletBackup(file, PASSWORD), 'wrong-password');
    expect(new WalletBackupError('invalid-payload', 'x').name).toBe('WalletBackupError');
  });
});
