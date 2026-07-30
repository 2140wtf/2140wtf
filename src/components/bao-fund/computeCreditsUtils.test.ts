import { describe, expect, it } from 'vitest';
import { getEncodedToken } from '@cashu/cashu-ts';

import { creditOutboxStorageKey, hasUnsupportedLockSecrets } from './computeCreditsUtils';
import { extractTokenLockPubkeys } from '@/pets/battle/lib/cashuEscrow';

const mintUrl = 'https://mint.example.com';
const lockPubkey = 'a'.repeat(64);

function makeToken(proofs: Array<{ id: string; amount: number; secret: string; C: string }>, mint = mintUrl) {
  return getEncodedToken({ mint, proofs, unit: 'sat' });
}

describe('creditOutboxStorageKey', () => {
  it('is scoped by funder pubkey — a shared browser must not leak account A\'s token to account B', () => {
    const a = creditOutboxStorageKey('pubkeyA', 'req1');
    const b = creditOutboxStorageKey('pubkeyB', 'req1');
    expect(a).not.toBe(b);
    expect(a).toContain('pubkeyA');
    expect(a).toContain('req1');
  });

  it('has a stable fallback for a logged-out viewer', () => {
    expect(creditOutboxStorageKey(undefined, 'req1')).toBe('bao_credit_outbox_logged-out_req1');
  });
});

describe('hasUnsupportedLockSecrets', () => {
  it('detects P2PK secrets carrying NUT-11 tags that extractTokenLockPubkeys skips', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['P2PK', lockPubkey, ['locktime', '999999999']]), C: 'C1' },
    ]);
    // The lock extractor yields nothing (tagged secrets are skipped)…
    expect(extractTokenLockPubkeys(token)).toEqual([]);
    // …so the redeem flow must NOT treat the token as bearer.
    expect(hasUnsupportedLockSecrets(token)).toBe(true);
  });

  it('detects the standard NUT-11 object form (nonce/data/tags)', () => {
    const token = makeToken([
      {
        id: 'ks',
        amount: 10,
        secret: JSON.stringify(['P2PK', { nonce: 'n', data: '02' + lockPubkey, tags: [['refund', lockPubkey]] }]),
        C: 'C1',
      },
    ]);
    expect(extractTokenLockPubkeys(token)).toEqual([]);
    expect(hasUnsupportedLockSecrets(token)).toBe(true);
  });

  it('detects HTLC-locked tokens', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: JSON.stringify(['HTLC', { nonce: 'n', data: 'deadbeef' }]), C: 'C1' },
    ]);
    expect(hasUnsupportedLockSecrets(token)).toBe(true);
  });

  it('returns false for a plain bearer token', () => {
    const token = makeToken([
      { id: 'ks', amount: 10, secret: 'plain-bearer-secret', C: 'C1' },
    ]);
    expect(hasUnsupportedLockSecrets(token)).toBe(false);
  });

  it('returns false for an undecodable token', () => {
    expect(hasUnsupportedLockSecrets('not-a-token')).toBe(false);
  });
});
