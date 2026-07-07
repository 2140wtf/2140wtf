import { describe, expect, it } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';

import { isTokenLockedToPubkey, getTokenAmount, validateEscrowDeposit } from './cashuEscrow';

const mintUrl = 'https://mint.example.com';
const escrowPubkey = 'a'.repeat(64);
const otherPubkey = 'b'.repeat(64);

function makeToken(proofs: Array<{ id: string; amount: number; secret: string; C: string }>) {
  return getEncodedToken({ mint: mintUrl, proofs, unit: 'sat' });
}

describe('isTokenLockedToPubkey', () => {
  it('returns true when every proof has a NUT-11 ["P2PK", pubkey] secret', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
      { id: 'ks', amount: 5, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C2' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(true);
  });

  it('returns false when a proof is not P2PK-locked', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: 'plain-secret', C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(false);
  });

  it('returns false when a proof is locked to a different pubkey', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', otherPubkey]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(false);
  });

  it('returns false for an invalid token', () => {
    expect(isTokenLockedToPubkey('not-a-token', escrowPubkey)).toBe(false);
  });

  it('rejects array secrets with extra NUT-11 tags by default', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey, ['refund', otherPubkey]]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(false);
  });

  it('accepts array secrets with explicitly allowed extra tags', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey, ['refund', otherPubkey]]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey, { allowedTags: ['refund'] })).toBe(true);
  });

  it('rejects object secrets with unexpected keys', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify({ pubkey: escrowPubkey, refund: otherPubkey }), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(false);
  });

  it('accepts object secrets with only the pubkey key', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify({ pubkey: escrowPubkey }), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, escrowPubkey)).toBe(true);
  });
});

describe('getTokenAmount', () => {
  it('sums the amounts of all proofs in a token entry', () => {
    const token = makeToken([
      { id: 'ks', amount: 7, secret: 's1', C: 'C1' },
      { id: 'ks', amount: 3, secret: 's2', C: 'C2' },
    ]);
    expect(getTokenAmount(token)).toBe(10);
  });

  it('returns 0 for an invalid token', () => {
    expect(getTokenAmount('not-a-token')).toBe(0);
  });
});

describe('validateEscrowDeposit', () => {
  it('returns valid for a correctly locked token of the expected amount', () => {
    const token = makeToken([
      { id: 'ks', amount: 21, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
    ]);
    expect(validateEscrowDeposit(token, 21, escrowPubkey)).toEqual({ valid: true, amount: 21 });
  });

  it('returns an amount-mismatch reason when the token amount does not match', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
    ]);
    const result = validateEscrowDeposit(token, 21, escrowPubkey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Token amount 10 does not match expected 21');
    expect(result.amount).toBe(10);
  });

  it('returns a lock-mismatch reason when the token is not locked to the escrow pubkey', () => {
    const token = makeToken([
      { id: 'ks', amount: 21, secret: JSON.stringify(['P2PK', otherPubkey]), C: 'C1' },
    ]);
    const result = validateEscrowDeposit(token, 21, escrowPubkey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Token is not locked to the escrow pubkey');
    expect(result.amount).toBe(21);
  });
});
