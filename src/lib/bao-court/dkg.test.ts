import { describe, expect, it } from 'vitest';
import * as frost from '@vbyte/frost';
import { hexToBytes } from '@noble/hashes/utils.js';

import { PedersenDkgAdapter, generateFrostKeys } from './dkg';
import { buildAttestationMessage, deriveXOnlyPubkey } from './crypto';
import type { SelectedJuror } from './types';

function makeJuror(idx: number): SelectedJuror {
  return {
    idx,
    nostrPubkey: '0'.repeat(63) + String(idx),
    stakeCapacitySats: 10_000,
    stakeCommitment: {
      amountSats: 10_000,
      bondAddress: 'bc1q...',
      status: 'confirmed',
      committedAt: 1_700_000_000,
    },
    wotScore: 80,
    categories: ['world'],
    registeredAt: 1_700_000_000,
    priority: idx,
  };
}

describe('PedersenDkgAdapter', () => {
  const jurors = [makeJuror(1), makeJuror(2), makeJuror(3)];

  it('produces a valid DkgRecord and secret shares', () => {
    const { record, shares } = new PedersenDkgAdapter().run({
      marketId: 'demo-market',
      disputeId: 'a'.repeat(64),
      threshold: 2,
      jurors,
    });

    expect(record.marketId).toBe('demo-market');
    expect(record.threshold).toBe(2);
    expect(record.participants).toBe(3);
    expect(record.groupPubkey).toMatch(/^[0-9a-f]{66}$/);
    expect(record.groupPubkeyXOnly).toMatch(/^[0-9a-f]{64}$/);
    expect(record.verificationShares).toHaveLength(3);
    expect(shares).toHaveLength(3);

    for (const share of shares) {
      const expected = deriveXOnlyPubkey(share.seckey);
      const actual = record.verificationShares.find((v) => v.idx === share.idx)?.pubkey;
      expect(actual).toBe(expected);
    }
  });

  it('produces shares that can sign and verify an attestation', () => {
    const { record, shares } = generateFrostKeys({
      marketId: 'demo-market',
      disputeId: 'a'.repeat(64),
      threshold: 2,
      jurors,
    });

    const message = buildAttestationMessage('demo-market', 'YES', 1, 'a'.repeat(64));
    const commitments = shares.map((s) => frost.Lib.create_commit_pkg(s));
    const ctx = frost.Lib.get_group_signing_ctx(record.groupPubkey, commitments, message);

    const shareSigs = shares.map((share) => {
      const commit = frost.Lib.get_commit_pkg(commitments, share);
      const sig = frost.Lib.sign_msg(ctx, share, commit);
      expect(frost.Lib.verify_partial_sig(ctx, commit, sig.pubkey, sig.psig)).toBe(true);
      return { idx: share.idx, pubkey: sig.pubkey, psig: sig.psig };
    });

    const signatureHex = frost.Lib.combine_partial_sigs(ctx, shareSigs);
    expect(frost.Lib.verify_final_sig(ctx, hexToBytes(message), hexToBytes(signatureHex))).toBe(
      true,
    );
  });

  it('disqualifies a participant that sends an invalid share', () => {
    const { record, shares } = new PedersenDkgAdapter({
      corruptShare: { accused: 1, victim: 2 },
    }).run({
      marketId: 'demo-market',
      disputeId: 'a'.repeat(64),
      threshold: 2,
      jurors,
    });

    // Juror 1 should be disqualified, leaving 2 and 3 as a 2-of-2 group.
    expect(record.participants).toBe(2);
    expect(record.jurorPubkeys).not.toContain(jurors[0].nostrPubkey);
    expect(shares).toHaveLength(2);

    // The remaining shares must still sign and verify.
    const message = buildAttestationMessage('demo-market', 'NO', 1, 'a'.repeat(64));
    const commitments = shares.map((s) => frost.Lib.create_commit_pkg(s));
    const ctx = frost.Lib.get_group_signing_ctx(record.groupPubkey, commitments, message);
    const shareSigs = shares.map((share) => {
      const commit = frost.Lib.get_commit_pkg(commitments, share);
      const sig = frost.Lib.sign_msg(ctx, share, commit);
      return { idx: share.idx, pubkey: sig.pubkey, psig: sig.psig };
    });
    const signatureHex = frost.Lib.combine_partial_sigs(ctx, shareSigs);
    expect(frost.Lib.verify_final_sig(ctx, hexToBytes(message), hexToBytes(signatureHex))).toBe(
      true,
    );
  });

  it('rejects duplicate juror indices', () => {
    expect(() =>
      generateFrostKeys({
        marketId: 'demo-market',
        disputeId: 'a'.repeat(64),
        threshold: 2,
        jurors: [makeJuror(1), makeJuror(1)],
      }),
    ).toThrow('Duplicate juror indices');
  });

  it('rejects fewer participants than threshold', () => {
    expect(() =>
      generateFrostKeys({
        marketId: 'demo-market',
        disputeId: 'a'.repeat(64),
        threshold: 3,
        jurors: [makeJuror(1), makeJuror(2)],
      }),
    ).toThrow('Participants cannot be less than threshold');
  });
});
