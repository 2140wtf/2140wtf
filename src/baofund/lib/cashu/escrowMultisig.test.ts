// Tests for the 2-of-3 multisig escrow primitive (₿AO escrow, NUT-11).
import { describe, expect, it } from 'vitest';
import { getEncodedToken, isP2PKSpendAuthorised, signP2PKProof, schnorrVerifyMessage } from 'cashu-ts3';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';

import {
  buildMultisigEscrowLock,
  getMultisigDepositLocktime,
  MULTISIG_REQUIRED_SIGNATURES,
  normalizeMultisigPubkey,
  parseMultisigLockSecret,
  validateMultisigEscrowDeposit,
  type MultisigDepositExpectation,
} from './escrowMultisig';

const mintUrl = 'https://mint.example.com';

// Deterministic test keys (never used anywhere else).
const PARTY_A_PRIV = bytesToHex(Uint8Array.from({ length: 32 }, () => 1));
const PARTY_B_PRIV = bytesToHex(Uint8Array.from({ length: 32 }, () => 2));
const OPERATOR_PRIV = bytesToHex(Uint8Array.from({ length: 32 }, () => 3));
const STRANGER_PRIV = bytesToHex(Uint8Array.from({ length: 32 }, () => 4));

const xonly = (priv: string) => bytesToHex(schnorr.getPublicKey(hexToBytes(priv)));
const PARTY_A = xonly(PARTY_A_PRIV);
const PARTY_B = xonly(PARTY_B_PRIV);
const OPERATOR = xonly(OPERATOR_PRIV);
const STRANGER = xonly(STRANGER_PRIV);

const LOCKTIME = Math.floor(Date.now() / 1000) + 24 * 3600;

/** The compressed key list buildMultisigEscrowLock should produce (sorted x-only, 02-prefixed). */
const sortedCompressed = [PARTY_A, PARTY_B, OPERATOR].sort().map((k) => '02' + k);

function makeToken(proofs: Array<{ amount: number; secret: string }>, mint = mintUrl) {
  return getEncodedToken({
    mint,
    proofs: proofs.map((p, i) => ({
      id: '00ad268c6d1f09e6',
      amount: p.amount,
      secret: p.secret,
      C: '02' + String(i + 1).padStart(2, '0').repeat(32),
    })),
    unit: 'sat',
  });
}

/** The exact secret JSON a mint-side swap would store for the 2-of-3 lock. */
function multisigSecret(overrides?: {
  keys?: string[];
  nSigs?: number;
  refund?: string[];
  locktime?: number;
  extraTags?: unknown[];
  nonce?: string;
}): string {
  const keys = overrides?.keys ?? sortedCompressed;
  const tags: unknown[] = [
    ['pubkeys', ...keys.slice(1)],
    ['n_sigs', String(overrides?.nSigs ?? 2)],
    ['refund', ...(overrides?.refund ?? ['02' + PARTY_A])],
    ['locktime', String(overrides?.locktime ?? LOCKTIME)],
    ...(overrides?.extraTags ?? []),
  ];
  return JSON.stringify(['P2PK', { nonce: overrides?.nonce ?? 'a'.repeat(64), data: keys[0], tags }]);
}

function validExpectation(overrides?: Partial<MultisigDepositExpectation>): MultisigDepositExpectation {
  return {
    expectedAmount: 21,
    partyAPubkey: PARTY_A,
    partyBPubkey: PARTY_B,
    operatorPubkey: OPERATOR,
    depositorPubkey: PARTY_A,
    minLocktime: LOCKTIME - 3600,
    allowedMints: [mintUrl],
    ...overrides,
  };
}

describe('normalizeMultisigPubkey', () => {
  it('accepts x-only and compressed forms, rejects garbage', () => {
    expect(normalizeMultisigPubkey(PARTY_A)).toBe(PARTY_A);
    expect(normalizeMultisigPubkey('02' + PARTY_A)).toBe(PARTY_A);
    expect(normalizeMultisigPubkey('03' + PARTY_A)).toBe(PARTY_A);
    expect(normalizeMultisigPubkey(('02' + PARTY_A).toUpperCase())).toBe(PARTY_A);
    expect(normalizeMultisigPubkey('04' + PARTY_A)).toBeNull();
    expect(normalizeMultisigPubkey('xyz')).toBeNull();
    expect(normalizeMultisigPubkey(null)).toBeNull();
  });
});

describe('buildMultisigEscrowLock', () => {
  it('produces the sorted 2-of-3 lock with refund and locktime', () => {
    const lock = buildMultisigEscrowLock({
      partyAPubkey: PARTY_A,
      partyBPubkey: '03' + PARTY_B, // compressed input form accepted
      operatorPubkey: OPERATOR,
      refundPubkey: PARTY_A,
      locktime: LOCKTIME,
    });
    expect(lock.pubkey).toEqual(sortedCompressed);
    expect(lock.requiredSignatures).toBe(MULTISIG_REQUIRED_SIGNATURES);
    expect(lock.locktime).toBe(LOCKTIME);
    expect(lock.refundKeys).toEqual(['02' + PARTY_A]);
  });

  it('rejects invalid keys, duplicate parties, foreign refund keys, bad locktimes', () => {
    const base = {
      partyAPubkey: PARTY_A,
      partyBPubkey: PARTY_B,
      operatorPubkey: OPERATOR,
      refundPubkey: PARTY_A,
      locktime: LOCKTIME,
    };
    expect(() => buildMultisigEscrowLock({ ...base, partyAPubkey: 'nope' })).toThrow('Invalid escrow pubkey');
    expect(() => buildMultisigEscrowLock({ ...base, partyBPubkey: PARTY_A })).toThrow('distinct');
    expect(() => buildMultisigEscrowLock({ ...base, operatorPubkey: PARTY_A })).toThrow('distinct');
    expect(() => buildMultisigEscrowLock({ ...base, refundPubkey: STRANGER })).toThrow('one of the two escrow parties');
    expect(() => buildMultisigEscrowLock({ ...base, locktime: -5 })).toThrow('locktime');
    expect(() => buildMultisigEscrowLock({ ...base, locktime: 1.5 })).toThrow('locktime');
  });
});

describe('parseMultisigLockSecret', () => {
  it('parses the real NUT-11 object form', () => {
    const lock = parseMultisigLockSecret(multisigSecret());
    expect(lock).not.toBeNull();
    expect(lock!.lockKeys).toEqual([PARTY_A, PARTY_B, OPERATOR].sort());
    expect(lock!.requiredSignatures).toBe(2);
    expect(lock!.locktime).toBe(LOCKTIME);
    expect(lock!.refundKeys).toEqual([PARTY_A]);
    expect(lock!.requiredRefundSignatures).toBe(1);
  });

  it('parses the legacy string form', () => {
    const legacy = JSON.stringify([
      'P2PK',
      '02' + PARTY_A,
      ['pubkeys', '02' + PARTY_B, '02' + OPERATOR],
      ['n_sigs', '2'],
    ]);
    const lock = parseMultisigLockSecret(legacy);
    expect(lock!.lockKeys).toEqual([PARTY_A, PARTY_B, OPERATOR].sort());
    expect(lock!.requiredSignatures).toBe(2);
  });

  it('returns null for non-P2PK and malformed secrets', () => {
    expect(parseMultisigLockSecret('not json')).toBeNull();
    expect(parseMultisigLockSecret('{"pubkey":"x"}')).toBeNull();
    expect(parseMultisigLockSecret(JSON.stringify(['HTLC', { data: 'x' }]))).toBeNull();
    expect(parseMultisigLockSecret(JSON.stringify(['P2PK', { data: 'zz' }]))).toBeNull();
    expect(parseMultisigLockSecret(42)).toBeNull();
  });

  it('rejects duplicate security-critical tags (NUT-11 first/last-occurrence ambiguity)', () => {
    // A second occurrence of any spending-condition tag lets a first-occurrence
    // consumer (cashu-ts) and a last-occurrence consumer (this parser) read
    // different locks from the same secret; refusal is the only safe answer.
    expect(parseMultisigLockSecret(multisigSecret())).not.toBeNull();
    expect(parseMultisigLockSecret(multisigSecret({ extraTags: [['pubkeys', '02' + STRANGER]] }))).toBeNull();
    expect(parseMultisigLockSecret(multisigSecret({ extraTags: [['locktime', String(LOCKTIME + 1)]] }))).toBeNull();
    expect(parseMultisigLockSecret(multisigSecret({ extraTags: [['n_sigs', '1']] }))).toBeNull();
    expect(parseMultisigLockSecret(multisigSecret({ extraTags: [['refund', '02' + STRANGER]] }))).toBeNull();
    expect(
      parseMultisigLockSecret(
        multisigSecret({ extraTags: [['n_sigs_refund', '1'], ['n_sigs_refund', '1']] }),
      ),
    ).toBeNull();
    // Unknown tags stay tolerated (they do not change the lock shape).
    expect(parseMultisigLockSecret(multisigSecret({ extraTags: [['sigflag', 'SIG_ALL']] }))).not.toBeNull();
  });
});

describe('validateMultisigEscrowDeposit', () => {
  it('accepts a well-formed deposit', () => {
    const token = makeToken([
      { amount: 13, secret: multisigSecret({ nonce: '1'.repeat(64) }) },
      { amount: 8, secret: multisigSecret({ nonce: '2'.repeat(64) }) },
    ]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result).toEqual({ valid: true, amount: 21 });
  });

  it('rejects wrong amounts', () => {
    const token = makeToken([{ amount: 20, secret: multisigSecret() }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/amount 20/);
  });

  it('rejects duplicate proofs (same secret counted twice)', () => {
    const dupSecret = multisigSecret();
    const token = makeToken([
      { amount: 13, secret: dupSecret },
      { amount: 8, secret: dupSecret },
    ]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/duplicate proofs/);
  });

  it('rejects a refund lock that needs more than one signature from a single key', () => {
    // One depositor key can never produce 2 signatures at the mint -> the
    // deposit would be permanently unrefundable.
    const token = makeToken([{ amount: 21, secret: multisigSecret({ extraTags: [['n_sigs_refund', '2']] }) }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/more than one signature/);
  });

  it('rejects a single-key (legacy custodial) lock', () => {
    const legacySecret = JSON.stringify(['P2PK', { nonce: 'a'.repeat(64), data: '02' + OPERATOR, tags: [] }]);
    const token = makeToken([{ amount: 21, secret: legacySecret }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/two players and the escrow operator/);
  });

  it('rejects a swapped-in stranger key', () => {
    const keys = [PARTY_A, PARTY_B, STRANGER].sort().map((k) => '02' + k);
    const token = makeToken([{ amount: 21, secret: multisigSecret({ keys }) }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
  });

  it('rejects n_sigs = 1 (unilateral operator release)', () => {
    const token = makeToken([{ amount: 21, secret: multisigSecret({ nSigs: 1 }) }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/two-of-three/);
  });

  it('rejects a refund key that is not the depositor', () => {
    const token = makeToken([{ amount: 21, secret: multisigSecret({ refund: ['02' + PARTY_B] }) }]);
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/refund key is not the depositor/);
  });

  it('rejects a missing or too-soon locktime', () => {
    const noLocktime = JSON.stringify([
      'P2PK',
      {
        nonce: 'a'.repeat(64),
        data: sortedCompressed[0],
        tags: [
          ['pubkeys', ...sortedCompressed.slice(1)],
          ['n_sigs', '2'],
          ['refund', '02' + PARTY_A],
        ],
      },
    ]);
    expect(validateMultisigEscrowDeposit(makeToken([{ amount: 21, secret: noLocktime }]), validExpectation()).reason)
      .toMatch(/locktime/);

    const soon = makeToken([{ amount: 21, secret: multisigSecret({ locktime: LOCKTIME - 7200 }) }]);
    expect(validateMultisigEscrowDeposit(soon, validExpectation()).reason).toMatch(/locktime/);
  });

  it('rejects a disallowed mint', () => {
    const token = makeToken([{ amount: 21, secret: multisigSecret() }], 'https://other.mint.example.com');
    const result = validateMultisigEscrowDeposit(token, validExpectation());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/agreed escrow mint/);
  });

  it('rejects empty and malformed tokens', () => {
    expect(validateMultisigEscrowDeposit('garbage', validExpectation()).valid).toBe(false);
    expect(validateMultisigEscrowDeposit('', validExpectation()).valid).toBe(false);
  });
});

describe('getMultisigDepositLocktime', () => {
  it('returns the soonest locktime across proofs', () => {
    const token = makeToken([
      { amount: 13, secret: multisigSecret({ locktime: LOCKTIME + 500 }) },
      { amount: 8, secret: multisigSecret() },
    ]);
    expect(getMultisigDepositLocktime(token)).toBe(LOCKTIME);
  });

  it('returns null when any proof lacks a locktime or the token is invalid', () => {
    const bearer = makeToken([{ amount: 21, secret: 'plain-secret' }]);
    expect(getMultisigDepositLocktime(bearer)).toBeNull();
    expect(getMultisigDepositLocktime('garbage')).toBeNull();
  });
});

describe('two-of-three witness assembly (operator co-sign + winner receive)', () => {
  /**
   * The release flow in miniature, with real schnorr signatures and no mint:
   * the operator signs each deposit proof (1st sig), then the winner's wallet
   * signs the same proofs at receive time (2nd sig). Both signatures must
   * verify against the secret, and neither party may sign twice.
   */
  it('operator + winner produce two distinct valid signatures', () => {
    const proof = {
      id: '00ad268c6d1f09e6',
      amount: 21,
      secret: multisigSecret(),
      C: '02' + '22'.repeat(32),
    };

    // cashu-ts 3.x: signP2PKProof (singular) still throws on a not-required
    // or already-signed proof; the plural variant logs and returns instead.
    const operatorSigned = signP2PKProof(proof, OPERATOR_PRIV);
    expect(operatorSigned.witness).toEqual(
      expect.objectContaining({ signatures: [expect.any(String)] }),
    );

    const fullySigned = signP2PKProof(operatorSigned, PARTY_A_PRIV);
    const sigs = (fullySigned.witness as { signatures: string[] }).signatures;
    expect(sigs).toHaveLength(2);
    expect(new Set(sigs).size).toBe(2);

    // Both signatures verify against the secret for their respective keys.
    expect(schnorrVerifyMessage(sigs[0], proof.secret, OPERATOR)).toBe(true);
    expect(schnorrVerifyMessage(sigs[1], proof.secret, PARTY_A)).toBe(true);
  });

  it('refuses a signature from a key outside the lock', () => {
    const proof = { id: 'x', amount: 21, secret: multisigSecret(), C: '02' + '22'.repeat(32) };
    expect(() => signP2PKProof(proof, STRANGER_PRIV)).toThrow(/Signature not required/);
  });

  it('refuses a second signature from the same key', () => {
    const proof = { id: 'x', amount: 21, secret: multisigSecret(), C: '02' + '22'.repeat(32) };
    const signed = signP2PKProof(proof, OPERATOR_PRIV);
    expect(() => signP2PKProof(signed, OPERATOR_PRIV)).toThrow(/already signed/);
  });

  it('authorizes the refund key (and only the refund key) after the locktime', () => {
    const expired = multisigSecret({ locktime: Math.floor(Date.now() / 1000) - 60 });
    const proof = { id: 'x', amount: 21, secret: expired, C: '02' + '22'.repeat(32) };
    // Depositor (refund key) can sign alone post-locktime...
    const refunded = signP2PKProof(proof, PARTY_A_PRIV);
    expect(refunded.witness).toBeDefined();
    expect(isP2PKSpendAuthorised(refunded)).toBe(true);
    // ...while a main-key signature alone is NOT authorized. cashu-ts 3.x's
    // client signer offers to sign with the main keys on an expired lock too
    // (its expected-witness set is main ∪ refund), but the spend check - what
    // the mint applies - only accepts the refund path.
    const operatorOnly = signP2PKProof(proof, OPERATOR_PRIV);
    expect(operatorOnly.witness).toBeDefined();
    expect(isP2PKSpendAuthorised(operatorOnly)).toBe(false);
    const partyBOnly = signP2PKProof(proof, PARTY_B_PRIV);
    expect(isP2PKSpendAuthorised(partyBOnly)).toBe(false);
  });
});

describe('validateMultisigEscrowDeposit - mutation fuzz (WS9)', () => {
  it('rejects every single-field mutation of a valid two-proof deposit', () => {
    const good = () => makeToken([
      { amount: 13, secret: multisigSecret({ nonce: '1'.repeat(64) }) },
      { amount: 8, secret: multisigSecret({ nonce: '2'.repeat(64) }) },
    ]);
    expect(validateMultisigEscrowDeposit(good(), validExpectation()).valid).toBe(true);

    const mutations: Array<{ name: string; token: string; expectation?: Partial<MultisigDepositExpectation> }> = [
      { name: 'duplicate secret', token: makeToken([
        { amount: 13, secret: multisigSecret({ nonce: '1'.repeat(64) }) },
        { amount: 8, secret: multisigSecret({ nonce: '1'.repeat(64) }) },
      ]) },
      { name: 'single signature required', token: makeToken([{ amount: 21, secret: multisigSecret({ nSigs: 1 }) }]) },
      { name: 'three signatures required', token: makeToken([{ amount: 21, secret: multisigSecret({ nSigs: 3 }) }]) },
      { name: 'two refund signatures', token: makeToken([{ amount: 21, secret: multisigSecret({ extraTags: [['n_sigs_refund', '2']] }) }]) },
      { name: 'refund key is the other party', token: makeToken([{ amount: 21, secret: multisigSecret({ refund: ['02' + PARTY_B] }) }]) },
      { name: 'locktime below the minimum', token: makeToken([{ amount: 21, secret: multisigSecret({ locktime: LOCKTIME - 7200 }) }]) },
      { name: 'lock key set missing the operator', token: makeToken([{ amount: 21, secret: multisigSecret({ keys: ['02' + PARTY_A, '02' + PARTY_B].sort() }) }]) },
      { name: 'plain (non-P2PK) secret', token: makeToken([{ amount: 21, secret: 'not-a-p2pk-lock' }]) },
      { name: 'wrong mint', token: makeToken([{ amount: 21, secret: multisigSecret() }], 'https://other.example.com') },
      { name: 'wrong amount', token: makeToken([{ amount: 21, secret: multisigSecret() }]), expectation: { expectedAmount: 42 } },
    ];
    for (const m of mutations) {
      const result = validateMultisigEscrowDeposit(m.token, validExpectation(m.expectation));
      expect(result.valid, m.name).toBe(false);
    }
  });

  it('never throws on random garbage secrets', () => {
    let a = 0x9e3779b9;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    for (let i = 0; i < 200; i++) {
      const secret = JSON.stringify(['P2PK', {
        nonce: rnd().toString(16).padStart(16, '0').repeat(4),
        data: '02' + rnd().toString(16).padStart(64, '0').slice(0, 64),
        tags: [['pubkeys', '02' + rnd().toString(16).padStart(64, '0').slice(0, 64)], ['n_sigs', String(rnd() % 5)], ['locktime', String(rnd() % 10_000_000_000)]],
      }]);
      const token = makeToken([{ amount: 1 + (rnd() % 100), secret }]);
      expect(() => validateMultisigEscrowDeposit(token, validExpectation())).not.toThrow();
    }
  });
});
