// src/wallet/keySchedule.test.ts
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import { BAO_KDF_PREFIX, KDF_LABELS, deriveSubkey, deriveSubkey32 } from './keySchedule';
import { deriveFreshWalletKey, deriveIdentityPrivkey } from './nip60/identity';

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const MASTER = new Uint8Array(
  Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'),
);

describe('deriveSubkey (Carbonado port)', () => {
  it('matches a known HMAC-SHA512 test vector', () => {
    // Computed independently with node:crypto:
    // createHmac('sha512', MASTER).update('baofund-kdf/v1/test-label').digest()
    const expected =
      'cf01b39b89810ce1dc04489c989568bdca16722660175de879ac994dcf496864' +
      'adf517320c79628906ae64096da82e96dca743a537734935093f63d80bdc02a1';
    expect(toHex(deriveSubkey(MASTER, 'test-label'))).toBe(expected);
  });

  it('cross-checks against node:crypto for arbitrary labels', () => {
    for (const label of ['wallet-sync', 'a', 'x'.repeat(64), 'etm-hmac-style-label-42']) {
      const expected = createHmac('sha512', Buffer.from(MASTER))
        .update(BAO_KDF_PREFIX + label)
        .digest('hex');
      expect(toHex(deriveSubkey(MASTER, label))).toBe(expected);
    }
  });

  it('produces 64 bytes (and 32 bytes via deriveSubkey32)', () => {
    expect(deriveSubkey(MASTER, 'test-label')).toHaveLength(64);
    expect(deriveSubkey32(MASTER, 'test-label')).toHaveLength(32);
    expect(toHex(deriveSubkey32(MASTER, 'test-label'))).toBe(
      toHex(deriveSubkey(MASTER, 'test-label')).slice(0, 64),
    );
  });

  it('domain-separates labels, masters, and the prefix', () => {
    const base = deriveSubkey(MASTER, 'label-a');
    expect(toHex(base)).not.toBe(toHex(deriveSubkey(MASTER, 'label-b')));
    expect(toHex(base)).not.toBe(toHex(deriveSubkey(new Uint8Array(32).fill(1), 'label-a')));
    // The prefix must be load-bearing: without it the derivation would collide
    // with any bare-HMAC scheme sharing the same labels.
    const bare = createHmac('sha512', Buffer.from(MASTER)).update('label-a').digest('hex');
    expect(toHex(base)).not.toBe(bare);
  });

  it('exposes the registry: evidence master + its two purpose labels + chat member identity', () => {
    expect(Object.keys(KDF_LABELS)).toEqual(['evidenceEncryption', 'evidenceEncCtr', 'evidenceEncEtm', 'chatRoomIdentity']);
    expect(KDF_LABELS.evidenceEncryption).toBe('evidence-encryption');
    expect(KDF_LABELS.evidenceEncCtr).toBe('evidence-enc-ctr');
    expect(KDF_LABELS.evidenceEncEtm).toBe('evidence-enc-etm');
    expect(KDF_LABELS.chatRoomIdentity).toBe('chat-room-identity');
  });

  it('context-separates derivations of the same label (per-artifact keys)', () => {
    const ctxA = new Uint8Array([1, 2, 3]);
    const ctxB = new Uint8Array([4, 5, 6]);
    const base = toHex(deriveSubkey(MASTER, 'test-label'));
    const withA = toHex(deriveSubkey(MASTER, 'test-label', ctxA));
    const withB = toHex(deriveSubkey(MASTER, 'test-label', ctxB));
    expect(withA).not.toBe(base);
    expect(withB).not.toBe(base);
    expect(withA).not.toBe(withB);
    // Cross-check against node:crypto (context is appended after the label).
    const expectedA = createHmac('sha512', Buffer.from(MASTER))
      .update(Buffer.concat([Buffer.from(BAO_KDF_PREFIX + 'test-label'), Buffer.from(ctxA)]))
      .digest('hex');
    expect(withA).toBe(expectedA);
    // Empty context is byte-identical to no context (backward compatible).
    expect(toHex(deriveSubkey(MASTER, 'test-label', new Uint8Array(0)))).toBe(base);
  });

  it('rejects weak masters and malformed labels', () => {
    expect(() => deriveSubkey(new Uint8Array(0), 'ok-label')).toThrow(/at least 32 bytes/);
    expect(() => deriveSubkey(new Uint8Array(31), 'ok-label')).toThrow(/at least 32 bytes/);
    expect(() => deriveSubkey(MASTER, '')).toThrow(/label/);
    expect(() => deriveSubkey(MASTER, 'Upper')).toThrow(/label/);
    expect(() => deriveSubkey(MASTER, 'has_underscore')).toThrow(/label/);
    expect(() => deriveSubkey(MASTER, 'x'.repeat(65))).toThrow(/label/);
    expect(() => deriveSubkey(MASTER, 'ok-label')).not.toThrow();
  });
});

describe('frozen legacy key derivations (regression locks)', () => {
  // These lock the EXISTING wallet key schedule. Changing either info-string
  // (or the hash construction) changes every existing user's keys and breaks
  // cross-app wallet recovery. If one of these fails, the change is wrong -
  // new derivations belong in keySchedule.ts, not here.
  const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  it('deriveIdentityPrivkey keeps the baofund:identity:v1 derivation', () => {
    // Independently computed: PBKDF2-HMAC-SHA512(mnemonic, 'mnemonic', 2048, 64)
    // then sha256('baofund:identity:v1' || seed).
    expect(toHex(deriveIdentityPrivkey(MNEMONIC))).toBe(
      'aac75ea43460eefd3f06adfa24c485439ea44cec14db69a9a3d15bc12d03f263',
    );
  });

  it('deriveFreshWalletKey keeps the baofund:walletkey:v1 derivation', () => {
    const identity = deriveIdentityPrivkey(MNEMONIC);
    // Independently computed: sha256('baofund:walletkey:v1' || identity).
    expect(toHex(deriveFreshWalletKey(identity))).toBe(
      '5efa44a84f1cd465864ca72d42812a56e38bf7e3b72bc4c6ae5c110c71084079',
    );
  });

  it('still rejects invalid mnemonics', () => {
    expect(() => deriveIdentityPrivkey('not a valid mnemonic')).toThrow(/Invalid BIP-39/);
  });
});
