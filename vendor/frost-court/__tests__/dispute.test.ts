import { describe, expect, it } from 'vitest';

import { hashCommit, tallyVotes, deriveDisputeGroupPubkey } from '../dispute';
import type { JurorVote } from '../types';

describe('dispute helpers', () => {
  it('hashCommit is deterministic and sensitive to salt', () => {
    const h1 = hashCommit('YES', 'salt-a');
    const h2 = hashCommit('YES', 'salt-b');
    const h3 = hashCommit('NO', 'salt-a');
    const h4 = hashCommit('YES', 'salt-a');

    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toBe(h4);
  });

  it('tallyVotes picks the majority outcome', () => {
    const votes: JurorVote[] = [
      { idx: 1, pubkey: 'a'.repeat(64), commit: hashCommit('YES', 's1'), reveal: { outcome: 'YES', salt: 's1' } },
      { idx: 2, pubkey: 'b'.repeat(64), commit: hashCommit('YES', 's2'), reveal: { outcome: 'YES', salt: 's2' } },
      { idx: 3, pubkey: 'c'.repeat(64), commit: hashCommit('NO', 's3'), reveal: { outcome: 'NO', salt: 's3' } },
    ];

    const result = tallyVotes(votes);
    expect(result.outcome).toBe('YES');
    expect(result.supportingVotes).toHaveLength(2);
  });

  it('tallyVotes rejects commit-reveal mismatches', () => {
    const votes: JurorVote[] = [
      { idx: 1, pubkey: 'a'.repeat(64), commit: hashCommit('YES', 's1'), reveal: { outcome: 'NO', salt: 's1' } },
    ];

    expect(() => tallyVotes(votes)).toThrow('commit-reveal mismatch');
  });

  it('deriveDisputeGroupPubkey returns a valid x-only pubkey', () => {
    const pk = deriveDisputeGroupPubkey('g'.repeat(64), 'd'.repeat(64));
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
    // Derivation is deterministic.
    expect(pk).toBe(deriveDisputeGroupPubkey('g'.repeat(64), 'd'.repeat(64)));
  });
});
