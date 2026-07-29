import { beforeEach, describe, expect, it } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';

import { isTokenLockedToPubkey, getTokenAmount, validateEscrowDeposit, extractTokenLockPubkeys, normalizeEscrowPubkey, savePendingEscrowClaim, loadPendingEscrowClaims, clearPendingEscrowClaim, type PendingEscrowClaim } from './cashuEscrow';

const mintUrl = 'https://mint.example.com';
const escrowPubkey = 'a'.repeat(64);
const otherPubkey = 'b'.repeat(64);

function makeToken(proofs: Array<{ id: string; amount: number; secret: string; C: string }>, mint = mintUrl) {
  return getEncodedToken({ mint, proofs, unit: 'sat' });
}

describe('normalizeEscrowPubkey', () => {
  it('passes through lowercase x-only keys', () => {
    expect(normalizeEscrowPubkey(escrowPubkey)).toBe(escrowPubkey);
  });

  it('strips the 02/03 prefix from compressed keys', () => {
    expect(normalizeEscrowPubkey('02' + escrowPubkey)).toBe(escrowPubkey);
    expect(normalizeEscrowPubkey('03' + escrowPubkey)).toBe(escrowPubkey);
  });

  it('lowercases uppercase input', () => {
    expect(normalizeEscrowPubkey('02' + 'A'.repeat(64))).toBe(escrowPubkey);
    expect(normalizeEscrowPubkey('A'.repeat(64))).toBe(escrowPubkey);
  });

  it('returns null for malformed keys', () => {
    expect(normalizeEscrowPubkey('04' + escrowPubkey)).toBeNull();
    expect(normalizeEscrowPubkey('xyz')).toBeNull();
    expect(normalizeEscrowPubkey('')).toBeNull();
    expect(normalizeEscrowPubkey(null)).toBeNull();
    expect(normalizeEscrowPubkey(undefined)).toBeNull();
  });
});

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

  it('treats compressed 66-char locks and x-only 64-char keys as equal', () => {
    // Battle escrow keys are derived compressed (66-char) while P2PK locks in
    // tokens are usually x-only — both directions must compare equal.
    const compressed = '02' + escrowPubkey;
    const tokenLockedCompressed = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', compressed]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(tokenLockedCompressed, escrowPubkey)).toBe(true);

    const tokenLockedXonly = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(tokenLockedXonly, compressed)).toBe(true);
  });

  it('returns false when the expected pubkey is malformed', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
    ]);
    expect(isTokenLockedToPubkey(token, 'not-a-key')).toBe(false);
  });
});

describe('extractTokenLockPubkeys', () => {
  it('returns [] for a bearer token', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: 'plain-secret', C: 'C1' },
    ]);
    expect(extractTokenLockPubkeys(token)).toEqual([]);
  });

  it('extracts the distinct lock pubkeys across proofs', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
      { id: 'ks', amount: 5, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C2' },
      { id: 'ks', amount: 1, secret: JSON.stringify(['P2PK', otherPubkey]), C: 'C3' },
    ]);
    expect(extractTokenLockPubkeys(token).sort()).toEqual([escrowPubkey, otherPubkey].sort());
  });

  it('normalizes compressed keys to lowercase and skips unparseable proofs', () => {
    const compressed = '02' + 'A'.repeat(64);
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', compressed]), C: 'C1' },
      { id: 'ks', amount: 5, secret: 'not-json', C: 'C2' },
    ]);
    expect(extractTokenLockPubkeys(token)).toEqual([compressed.toLowerCase()]);
  });

  it('returns [] for an invalid token', () => {
    expect(extractTokenLockPubkeys('not-a-token')).toEqual([]);
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

  it('accepts a compressed 66-char escrow pubkey against x-only token locks', () => {
    const token = makeToken([
      { id: 'ks', amount: 21, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' },
    ]);
    expect(validateEscrowDeposit(token, 21, '02' + escrowPubkey)).toEqual({ valid: true, amount: 21 });
  });

  describe('mint allowlist', () => {
    const lockedProof = { id: 'ks', amount: 21, secret: JSON.stringify(['P2PK', escrowPubkey]), C: 'C1' };

    it('accepts a deposit from an allowed mint', () => {
      const token = makeToken([lockedProof]);
      expect(validateEscrowDeposit(token, 21, escrowPubkey, [mintUrl]).valid).toBe(true);
    });

    it('normalizes mint URLs (case + trailing slash) before comparing', () => {
      const token = makeToken([lockedProof]);
      expect(validateEscrowDeposit(token, 21, escrowPubkey, ['https://MINT.example.com/']).valid).toBe(true);
    });

    it('rejects a deposit from a mint outside the allowlist', () => {
      const token = makeToken([lockedProof], 'https://evil.mint');
      const result = validateEscrowDeposit(token, 21, escrowPubkey, [mintUrl]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('evil.mint');
    });

    it('skips the mint check when no allowlist is provided', () => {
      const token = makeToken([lockedProof], 'https://any.mint');
      expect(validateEscrowDeposit(token, 21, escrowPubkey).valid).toBe(true);
      expect(validateEscrowDeposit(token, 21, escrowPubkey, []).valid).toBe(true);
    });
  });
});

describe('pending escrow claim journal (hunt regression [18])', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const claim: PendingEscrowClaim = {
    battleId: 'battle-1',
    winnerPubkey: escrowPubkey,
    hostPubkey: escrowPubkey,
    guestPubkey: otherPubkey,
    hostDepositToken: 'cashuAhost',
    guestDepositToken: 'cashuAguest',
    finishedEvent: { id: 'ev', kind: 1 },
    prizeAmount: 21,
    createdAt: 1721000000000,
    attempts: 0,
  };

  it('round-trips a claim through localStorage', () => {
    savePendingEscrowClaim(claim);
    const loaded = loadPendingEscrowClaims();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(claim);
  });

  it('persists the release token so a receive failure never re-asks the operator', () => {
    savePendingEscrowClaim({ ...claim, releaseToken: 'cashuArelease', attempts: 2 });
    const loaded = loadPendingEscrowClaims();
    expect(loaded[0]?.releaseToken).toBe('cashuArelease');
    expect(loaded[0]?.attempts).toBe(2);
  });

  it('clear removes only the matching battle entry', () => {
    savePendingEscrowClaim(claim);
    savePendingEscrowClaim({ ...claim, battleId: 'battle-2' });
    clearPendingEscrowClaim('battle-1');
    const loaded = loadPendingEscrowClaims();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.battleId).toBe('battle-2');
  });

  it('skips malformed entries instead of throwing', () => {
    localStorage.setItem('bao_battle_claim_broken', '{not json');
    localStorage.setItem('bao_battle_claim_missing-fields', JSON.stringify({ battleId: 'x' }));
    savePendingEscrowClaim(claim);
    const loaded = loadPendingEscrowClaims();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.battleId).toBe('battle-1');
  });
});
