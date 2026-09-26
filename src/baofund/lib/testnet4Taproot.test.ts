/**
 * Testnet4 rail step 2 tests - tapscript/taptree math anchored to the
 * BIP-341 wallet test vectors (embedded verbatim from
 * bitcoin/bips bip-0341/wallet-test-vectors.json, scriptPubKey section) and
 * byte-exact leaf tests. Third-party vectors, never self-generated: if the
 * tagged-hash, tweak or merkle math drifts, these fail loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  LEAF_VERSION_BASE,
  NUMS_INTERNAL_XONLY,
  TESTNET4_PARAMS,
  TaprootRailError,
  bytesToHex,
  buildContributionOutput,
  donorRefundLeaf,
  founderClaimLeaf,
  hashlockThresholdLeaves,
  hexToBytes,
  leadInvestorHashlockLeaf,
  numsInternalPoint,
  p2trAddress,
  p2trScriptPubKey,
  penaltyCsvLeaf,
  penaltyRecoveryLeaf,
  scriptNum,
  taptreeRoot,
  tweakOutputKey,
} from './testnet4Taproot';

// ── BIP-341 wallet test vectors (scriptPubKey section) ──────────────────────
// Embedded verbatim from bitcoin/bips bip-0341/wallet-test-vectors.json -
// each vector has its OWN internal key; trees are right-nested [left, right].

interface BipLeaf { script: string; leafVersion?: number }
type BipTree = BipLeaf | [BipTree, BipTree];

const BIP341_VECTORS: Array<{
  internalPubkey: string;
  scriptTree: BipTree | null;
  merkleRoot: string | null;
  tweakedPubkey: string;
  scriptPubKey: string;
  bip350Address: string;
}> = [
  {
    // vector 0: keypath only (no script tree)
    internalPubkey: 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d',
    scriptTree: null,
    merkleRoot: null,
    tweakedPubkey: '53a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343',
    scriptPubKey: '512053a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343',
    bip350Address: 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
  },
  {
    // vector 1: single leaf v192
    internalPubkey: '187791b6f712a8ea41c8ecdd0ee77fab3e85263b37e1ec18a3651926b3a6cf27',
    scriptTree: { script: '20d85a959b0290bf19bb89ed43c916be835475d013da4b362117393e25a48229b8ac', leafVersion: 192 },
    merkleRoot: '5b75adecf53548f3ec6ad7d78383bf84cc57b55a3127c72b9a2481752dd88b21',
    tweakedPubkey: '147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3',
    scriptPubKey: '5120147c9c57132f6e7ecddba9800bb0c4449251c92a1e60371ee77557b6620f3ea3',
    bip350Address: 'bc1pz37fc4cn9ah8anwm4xqqhvxygjf9rjf2resrw8h8w4tmvcs0863sa2e586',
  },
  {
    // vector 2: single leaf v192
    internalPubkey: '93478e9488f956df2396be2ce6c5cced75f900dfa18e7dabd2428aae78451820',
    scriptTree: { script: '20b617298552a72ade070667e86ca63b8f5789a9fe8731ef91202a91c9f3459007ac', leafVersion: 192 },
    merkleRoot: 'c525714a7f49c28aedbbba78c005931a81c234b2f6c99a73e4d06082adc8bf2b',
    tweakedPubkey: 'e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e',
    scriptPubKey: '5120e4d810fd50586274face62b8a807eb9719cef49c04177cc6b76a9a4251d5450e',
    bip350Address: 'bc1punvppl2stp38f7kwv2u2spltjuvuaayuqsthe34hd2dyy5w4g58qqfuag5',
  },
  {
    // vector 3: [v192 leaf, v250 leaf]
    internalPubkey: 'ee4fe085983462a184015d1f782d6a5f8b9c2b60130aff050ce221ecf3786592',
    scriptTree: [
      { script: '20387671353e273264c495656e27e39ba899ea8fee3bb69fb2a680e22093447d48ac', leafVersion: 192 },
      { script: '06424950333431', leafVersion: 250 },
    ],
    merkleRoot: '6c2dc106ab816b73f9d07e3cd1ef2c8c1256f519748e0813e4edd2405d277bef',
    tweakedPubkey: '712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5',
    scriptPubKey: '5120712447206d7a5238acc7ff53fbe94a3b64539ad291c7cdbc490b7577e4b17df5',
    bip350Address: 'bc1pwyjywgrd0ffr3tx8laflh6228dj98xkjj8rum0zfpd6h0e930h6saqxrrm',
  },
  {
    // vector 4: [v192 leaf, v192 leaf]
    internalPubkey: 'f9f400803e683727b14f463836e1e78e1c64417638aa066919291a225f0e8dd8',
    scriptTree: [
      { script: '2044b178d64c32c4a05cc4f4d1407268f764c940d20ce97abfd44db5c3592b72fdac', leafVersion: 192 },
      { script: '07546170726f6f74', leafVersion: 192 },
    ],
    merkleRoot: 'ab179431c28d3b68fb798957faf5497d69c883c6fb1e1cd9f81483d87bac90cc',
    tweakedPubkey: '77e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220',
    scriptPubKey: '512077e30a5522dd9f894c3f8b8bd4c4b2cf82ca7da8a3ea6a239655c39c050ab220',
    bip350Address: 'bc1pwl3s54fzmk0cjnpl3w9af39je7pv5ldg504x5guk2hpecpg2kgsqaqstjq',
  },
  {
    // vector 5: 3 leaves, right-nested [l1, [l2, l3]]
    internalPubkey: 'e0dfe2300b0dd746a3f8674dfd4525623639042569d829c7f0eed9602d263e6f',
    scriptTree: [
      { script: '2072ea6adcf1d371dea8fba1035a09f3d24ed5a059799bae114084130ee5898e69ac', leafVersion: 192 },
      [
        { script: '202352d137f2f3ab38d1eaa976758873377fa5ebb817372c71e2c542313d4abda8ac', leafVersion: 192 },
        { script: '207337c0dd4253cb86f2c43a2351aadd82cccb12a172cd120452b9bb8324f2186aac', leafVersion: 192 },
      ],
    ],
    merkleRoot: 'ccbd66c6f7e8fdab47b3a486f59d28262be857f30d4773f2d5ea47f7761ce0e2',
    tweakedPubkey: '91b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605',
    scriptPubKey: '512091b64d5324723a985170e4dc5a0f84c041804f2cd12660fa5dec09fc21783605',
    bip350Address: 'bc1pjxmy65eywgafs5tsunw95ruycpqcqnev6ynxp7jaasylcgtcxczs6n332e',
  },
  {
    // vector 6: 3 leaves, right-nested
    internalPubkey: '55adf4e8967fbd2e29f20ac896e60c3b0f1d5b0efa9d34941b5958c7b0a0312d',
    scriptTree: [
      { script: '2071981521ad9fc9036687364118fb6ccd2035b96a423c59c5430e98310a11abe2ac', leafVersion: 192 },
      [
        { script: '20d5094d2dbe9b76e2c245a2b89b6006888952e2faa6a149ae318d69e520617748ac', leafVersion: 192 },
        { script: '20c440b462ad48c7a77f94cd4532d8f2119dcebbd7c9764557e62726419b08ad4cac', leafVersion: 192 },
      ],
    ],
    merkleRoot: '2f6b2c5397b6d68ca18e09a3f05161668ffe93a988582d55c6f07bd5b3329def',
    tweakedPubkey: '75169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831',
    scriptPubKey: '512075169f4001aa68f15bbed28b218df1d0a62cbbcf1188c6665110c293c907b831',
    bip350Address: 'bc1pw5tf7sqp4f50zka7629jrr036znzew70zxyvvej3zrpf8jg8hqcssyuewe',
  },
];

function bipTreeToTapTree(t: BipTree): Parameters<typeof taptreeRoot>[0] {
  if (Array.isArray(t)) return { l: bipTreeToTapTree(t[0]), r: bipTreeToTapTree(t[1]) };
  return { script: hexToBytes(t.script), leafVersion: t.leafVersion };
}

describe('BIP-341 wallet vectors: tweak, merkle root, output key', () => {
  for (const [i, v] of BIP341_VECTORS.entries()) {
    it(`vector ${i} - merkle root, tweaked key, scriptPubKey, address`, () => {
      const root = v.scriptTree === null ? undefined : taptreeRoot(bipTreeToTapTree(v.scriptTree));
      if (v.merkleRoot === null) {
        expect(root).toBeUndefined();
      } else {
        expect(bytesToHex(root!)).toBe(v.merkleRoot);
      }
      const out = tweakOutputKey(hexToBytes(v.internalPubkey), root);
      expect(bytesToHex(out)).toBe(v.tweakedPubkey);
      // P2TR scriptPubKey = 51 20 <key> (34 bytes) - verbatim from the BIP
      expect(bytesToHex(p2trScriptPubKey(out))).toBe(v.scriptPubKey);
      expect(v.scriptPubKey.length).toBe(68); // 2 opcode bytes + 64 hex chars
      // BIP-350 bech32m address (mainnet hrp bc, verbatim from the BIP)
      expect(p2trAddress(out, 'bc')).toBe(v.bip350Address);
    });
  }
});

describe('scriptNum (BIP-62 minimal encoding)', () => {
  it('encodes CLTV values minimally', () => {
    expect(bytesToHex(scriptNum(0))).toBe('');
    expect(bytesToHex(scriptNum(1))).toBe('01');
    expect(bytesToHex(scriptNum(72))).toBe('48');
    expect(bytesToHex(scriptNum(500_000))).toBe('20a107');
    expect(bytesToHex(scriptNum(0x1234_5678))).toBe('78563412');
  });

  it('adds the sign-bit slot byte when the top byte has the high bit set', () => {
    // 0x8000 → little-endian 00 80; high bit of 0x80 set → append 0x00
    expect(bytesToHex(scriptNum(0x8000))).toBe('008000');
  });

  it('rejects out-of-range', () => {
    expect(() => scriptNum(-1)).toThrowError(TaprootRailError);
    expect(() => scriptNum(0x1_0000_0000)).toThrowError(TaprootRailError);
    expect(() => scriptNum(1.5)).toThrowError(TaprootRailError);
  });
});

describe('locktime domain validation (BIP-65 threshold)', () => {
  const key = hexToBytes(NUMS_INTERNAL_XONLY);
  it('founder leaf: block heights below threshold, unix time at/above', () => {
    expect(() => founderClaimLeaf(key, 400_000, 'blocks')).not.toThrow();
    expect(() => founderClaimLeaf(key, 1_700_000_000, 'seconds')).not.toThrow();
  });

  it('founder leaf: cross-domain values fail typed', () => {
    expect(() => founderClaimLeaf(key, 600_000_000, 'blocks')).toThrowError(TaprootRailError);
    expect(() => founderClaimLeaf(key, 400_000_000, 'seconds')).toThrowError(TaprootRailError);
    try {
      founderClaimLeaf(key, 600_000_000, 'blocks');
    } catch (e) {
      expect((e as TaprootRailError).code).toBe('bad_locktime');
    }
  });

  it('donor refund leaf rejects the same cross-domain mistakes', () => {
    expect(() => donorRefundLeaf(key, 72, 'blocks')).not.toThrow();
    expect(() => donorRefundLeaf(key, 400_000, 'seconds')).toThrowError(TaprootRailError);
  });

  it('penalty CSV leaf rejects 0 and block-domain violations', () => {
    expect(() => penaltyCsvLeaf(key, 0)).toThrowError(TaprootRailError);
    expect(() => penaltyCsvLeaf(key, 600_000_000)).toThrowError(TaprootRailError);
    expect(() => penaltyCsvLeaf(key, 144)).not.toThrow();
  });
});

describe('leaf builders - byte-exact scripts', () => {
  const FOUNDER = hexToBytes('aa'.repeat(32));
  const DONOR = hexToBytes('bb'.repeat(32));
  const INVESTOR = hexToBytes('cc'.repeat(32));
  const RECOVERY = hexToBytes('dd'.repeat(32));

  it('founder_claim: <key> OP_CHECKSIGVERIFY <n> OP_CLTV', () => {
    const { script } = founderClaimLeaf(FOUNDER, 12345, 'blocks');
    // 12345 = 0x3039 → minimal scriptNum 39 30 (2 bytes, little-endian)
    expect(bytesToHex(script)).toBe(
      '20' + 'aa'.repeat(32) + 'ad' + '023930' + 'b1',
    );
  });

  it('donor_refund has the donor key and the same opcode shape', () => {
    const { script } = donorRefundLeaf(DONOR, 72, 'blocks');
    expect(bytesToHex(script)).toBe('20' + 'bb'.repeat(32) + 'ad' + '0148' + 'b1');
  });

  it('penalty_csv uses OP_CHECKSEQUENCEVERIFY (b2)', () => {
    const { script } = penaltyCsvLeaf(INVESTOR, 144);
    expect(bytesToHex(script)).toBe('20' + 'cc'.repeat(32) + 'ad' + '029000' + 'b2');
  });

  it('penalty_recovery_2of2: <recovery> CHECKSIGVERIFY <investor> CHECKSIG', () => {
    const { script } = penaltyRecoveryLeaf(RECOVERY, INVESTOR);
    expect(bytesToHex(script)).toBe(
      '20' + 'dd'.repeat(32) + 'ad' + '20' + 'cc'.repeat(32) + 'ac',
    );
  });

  it('lead hashlock leaf: hash256 commitment is 32B and opcodes land', () => {
    const h = hexToBytes('11'.repeat(32));
    const { script } = leadInvestorHashlockLeaf(RECOVERY, INVESTOR, h);
    expect(bytesToHex(script)).toBe(
      '20' + 'dd'.repeat(32) + 'ad' + '20' + 'cc'.repeat(32) + 'ad' + 'aa' + '20' + '11'.repeat(32) + '87',
    );
    expect(() => leadInvestorHashlockLeaf(RECOVERY, INVESTOR, hexToBytes('11'.repeat(31)))).toThrowError(
      TaprootRailError,
    );
  });

  it('all leaves carry the tapscript leaf version 0xc0', () => {
    for (const leaf of [
      founderClaimLeaf(FOUNDER, 100, 'blocks'),
      donorRefundLeaf(DONOR, 100, 'blocks'),
      penaltyCsvLeaf(INVESTOR, 10),
      penaltyRecoveryLeaf(RECOVERY, INVESTOR),
    ]) {
      expect(leaf.leafVersion).toBe(LEAF_VERSION_BASE);
    }
  });
});

describe('hashlock threshold tree (Angor penalty-free path)', () => {
  const INVESTOR = hexToBytes('cc'.repeat(32));
  const hashes = Array.from({ length: 5 }, (_, i) => hexToBytes((i + 1).toString().padStart(2, '0').repeat(32)));

  it('C(5,3) = 10 leaves, each = 3× (HASH256 PUSH32 EQUALVERIFY) + investor key + CHECKSIG', () => {
    const leaves = hashlockThresholdLeaves(INVESTOR, hashes, 3);
    expect(leaves).toHaveLength(10);
    for (const l of leaves) {
      // 3 × (1 OP_HASH256 + 1 PUSH32(33) + 1 OP_EQUALVERIFY) + 1 PUSH32 + 1 CHECKSIG
      expect(l.script.length).toBe(3 * (1 + 33 + 1) + 32 + 1 + 1);
      expect(l.leafVersion).toBe(LEAF_VERSION_BASE);
      // Every commitment MUST be consumed by a comparison: without
      // OP_EQUALVERIFY the trailing OP_CHECKSIG pops the pushed hash constant
      // as its signature and the leaf is unsatisfiable.
      const eqVerifyCount = l.script.reduce((n, b) => n + (b === 0x88 ? 1 : 0), 0);
      expect(eqVerifyCount).toBe(3);
    }
    // All combinations distinct
    const set = new Set(leaves.map((l) => bytesToHex(l.script)));
    expect(set.size).toBe(10);
  });

  it('every threshold leaf enforces exactly k hash comparisons (execution semantics)', () => {
    for (const k of [1, 2, 3, 4, 5]) {
      const leaves = hashlockThresholdLeaves(INVESTOR, hashes, k);
      for (const leaf of leaves) {
        const eqVerifyCount = leaf.script.reduce((n, b) => n + (b === 0x88 ? 1 : 0), 0);
        expect(eqVerifyCount).toBe(k);
      }
    }
  });

  it('C(4,4) = 1 leaf; threshold > n fails; oversized trees fail typed', () => {
    expect(hashlockThresholdLeaves(INVESTOR, hashes.slice(0, 4), 4)).toHaveLength(1);
    expect(() => hashlockThresholdLeaves(INVESTOR, hashes, 6)).toThrowError(TaprootRailError);
    expect(() => hashlockThresholdLeaves(INVESTOR, hashes, 2, 5)).toThrowError(TaprootRailError);
  });
});

describe('NUMS internal key + contribution assembly', () => {
  it('NUMS point is the pinned constant, lifts to a valid point', () => {
    expect(NUMS_INTERNAL_XONLY).toBe('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');
    expect(() => numsInternalPoint()).not.toThrow();
  });

  it('builds a tb-prefixed P2TR address from a full leaf set, deterministically', () => {
    const keys = {
      donorKeyXOnly: hexToBytes('aa'.repeat(32)),
      founderKeyXOnly: hexToBytes('bb'.repeat(32)),
      founderRecoveryKeyXOnly: hexToBytes('cc'.repeat(32)),
      investorKeyXOnly: hexToBytes('dd'.repeat(32)),
    };
    const times = {
      release: 1_700_000_000,
      releaseDomain: 'seconds' as const,
      refundDeadline: 200,
      refundDomain: 'blocks' as const,
      penaltyBlocks: 144,
      expiry: 1_800_000_000,
      expiryDomain: 'seconds' as const,
    };
    const a = buildContributionOutput(keys, times);
    const b = buildContributionOutput(keys, times);
    expect(a.address).toBe(b.address);
    expect(a.address.startsWith('tb1p')).toBe(true);
    expect(a.leaves.map((l) => l.name)).toEqual([
      'founder_claim',
      'donor_refund',
      'penalty_recovery_2of2',
      'penalty_csv',
      'project_expiry',
    ]);
    // Address round-trips through the step-1 validator
    const parsed = (async () => {
      const { validateTestnet4Address } = await import('./testnet4Rail');
      return validateTestnet4Address(a.address);
    })();
    return parsed.then((p) => expect(p.version).toBe(1));
  });

  it('adding the hashlock tree changes the output key (tree affects tweak)', () => {
    const base = {
      donorKeyXOnly: hexToBytes('aa'.repeat(32)),
      founderKeyXOnly: hexToBytes('bb'.repeat(32)),
      founderRecoveryKeyXOnly: hexToBytes('cc'.repeat(32)),
      investorKeyXOnly: hexToBytes('dd'.repeat(32)),
    };
    const times = {
      release: 1_700_000_000,
      releaseDomain: 'seconds' as const,
      refundDeadline: 200,
      refundDomain: 'blocks' as const,
      penaltyBlocks: 144,
      expiry: 1_800_000_000,
      expiryDomain: 'seconds' as const,
    };
    const without = buildContributionOutput(base, times);
    const withTree = buildContributionOutput(
      { ...base, leadSecretHashes: [hexToBytes('22'.repeat(32)), hexToBytes('33'.repeat(32))], leadThreshold: 1 },
      times,
    );
    expect(bytesToHex(without.outputXOnly)).not.toBe(bytesToHex(withTree.outputXOnly));
    expect(withTree.leaves.some((l) => l.name.startsWith('hashlock_threshold_'))).toBe(true);
  });

  it('network params flow into the address (mainnet-parity principle)', () => {
    expect(TESTNET4_PARAMS.hrp).toBe('tb');
    expect(TESTNET4_PARAMS.refundLocktimeBlocks).toBe(72);
  });
});
