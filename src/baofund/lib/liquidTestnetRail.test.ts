/**
 * Liquid-testnet rail step 1 acceptance - mirrors testnet4Rail.test.ts:
 * the cross-network rejection matrix (addresses and txids from the WRONG
 * chain fail typed), valid tex addresses parse, the confidential (blinded)
 * form is fail-closed, and the chain-identity anchors are pinned to the
 * live-fetched values so a silent change is caught.
 *
 * The taproot addresses here are built with the SHARED Testnet4 builders -
 * proving the parameterization story: taproot math is chain-agnostic, only
 * the HRP (and probe base) differ per rail.
 */
import { describe, expect, it } from 'vitest';
import {
  LIQUID_TESTNET_GENESIS_HASH,
  LIQUID_TESTNET_NATIVE_ASSET_ID,
  LIQUID_TESTNET_ESPLORA_BASE,
  LIQUID_TESTNET_EXPLORER_BASE,
  LIQUID_TESTNET_HRP,
  LIQUID_TESTNET_NO_VALUE_BADGE,
  LIQUID_TESTNET_RAIL,
  LiquidTestnetRailError,
  isLiquidTestnetRail,
  isLiquidTestnetRailEnabled,
  liquidTestnetExplorerAddressUrl,
  liquidTestnetExplorerTxUrl,
  validateLiquidTestnetAddress,
  validateLiquidTestnetTxid,
} from './liquidTestnetRail';
import { NUMS_INTERNAL_XONLY, hexToBytes, p2trAddress, tweakOutputKey } from './testnet4Taproot';
import { bech32, bech32m } from '@scure/base';

/** Build a syntactically valid segwit address for an arbitrary HRP (negative-matrix factory). */
function segwitAddress(hrp: string, version: number, program: Uint8Array): string {
  const words = [version, ...bech32m.toWords(program)];
  return version === 0 ? bech32.encode(hrp, words as never, 90) : bech32m.encode(hrp, words as never, 90);
}

const P2WPKH_20 = new Uint8Array(20).fill(0x11);
const P2TR_32 = new Uint8Array(32).fill(0x22);

describe('valid tex addresses (unblinded liquid-testnet)', () => {
  it('accepts a v0 bech32 address (tex1q…, 20-byte program)', () => {
    const addr = segwitAddress('tex', 0, P2WPKH_20);
    expect(addr.startsWith('tex1q')).toBe(true);
    const parsed = validateLiquidTestnetAddress(addr);
    expect(parsed.version).toBe(0);
    expect(parsed.programBytes).toEqual(P2WPKH_20);
  });

  it('accepts a v1 bech32m address (tex1p…, 32-byte program) - taproot, built with the SHARED builders', () => {
    const addr = p2trAddress(tweakOutputKey(hexToBytes(NUMS_INTERNAL_XONLY)), 'tex');
    expect(addr.startsWith('tex1p')).toBe(true);
    const parsed = validateLiquidTestnetAddress(addr);
    expect(parsed.version).toBe(1);
    expect(parsed.programBytes).toHaveLength(32);
  });

  it('accepts uppercase (BIP-173 allows all-caps), rejecting mixed case', () => {
    const addr = segwitAddress('tex', 0, P2WPKH_20);
    expect(validateLiquidTestnetAddress(addr.toUpperCase()).version).toBe(0);
    const mixed = addr[0].toUpperCase() + addr.slice(1);
    try {
      validateLiquidTestnetAddress(mixed);
      expect.unreachable('mixed case accepted');
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('malformed_address');
    }
  });
});

describe('cross-network rejection matrix', () => {
  it('rejects bitcoin testnet tb1… as wrong_network (the first rail owns it)', () => {
    try {
      validateLiquidTestnetAddress(segwitAddress('tb', 1, P2TR_32));
      expect.unreachable('tb accepted');
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('wrong_network');
      expect((e as LiquidTestnetRailError).detail).toContain('bitcoin');
    }
  });

  it('rejects mainnet bc1… and regtest bcrt1… as wrong_network', () => {
    expect(() => validateLiquidTestnetAddress(segwitAddress('bc', 0, P2WPKH_20))).toThrowError(LiquidTestnetRailError);
    expect(() => validateLiquidTestnetAddress(segwitAddress('bcrt', 1, P2TR_32))).toThrowError(LiquidTestnetRailError);
  });

  it('rejects Liquid MAINNET ex/lq prefixes as cross_network_rejected (same family, different chain)', () => {
    for (const hrp of ['ex', 'lq']) {
      try {
        validateLiquidTestnetAddress(segwitAddress(hrp, 0, P2WPKH_20));
        expect.unreachable(`liquid mainnet prefix ${hrp} accepted`);
      } catch (e) {
        expect((e as LiquidTestnetRailError).code).toBe('cross_network_rejected');
        expect((e as LiquidTestnetRailError).detail).toContain('MAINNET');
      }
    }
  });

  it('rejects the blinded testnet form tlq1… as confidential_rejected (fail-closed, not malformed)', () => {
    // A blinded address's blinding part changes the payload shape; even a
    // bech32-plausible payload must never be accepted on this rail yet.
    const plausible = segwitAddress('tlq', 1, P2TR_32);
    try {
      validateLiquidTestnetAddress(plausible);
      expect.unreachable('tlq accepted');
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('confidential_rejected');
      expect((e as LiquidTestnetRailError).detail).toContain('blinded');
    }
  });

  it('rejects an unknown HRP as malformed (not silently typed as another network)', () => {
    try {
      validateLiquidTestnetAddress(segwitAddress('xx', 0, P2WPKH_20));
      expect.unreachable('xx accepted');
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('malformed_address');
    }
  });
});

describe('malformed address matrix', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['tex1q', 'too short'],
    ['tex', 'no separator'],
    ['1qxyzabcdefgh', 'no HRP'],
    [`tex1q${'q'.repeat(100)}`, 'over 90 chars'],
    ['tex1qnonconst!!', 'bad charset'],
  ];
  for (const [input, why] of cases) {
    it(`rejects: ${why} (${input.slice(0, 18)})`, () => {
      expect(() => validateLiquidTestnetAddress(input)).toThrowError(LiquidTestnetRailError);
    });
  }

  it('rejects a v0 program of invalid length (e.g. 21 bytes)', () => {
    const addr = segwitAddress('tex', 0, new Uint8Array(21).fill(0x33));
    try {
      validateLiquidTestnetAddress(addr);
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('malformed_address');
      expect((e as LiquidTestnetRailError).detail).toContain('20 or 32');
    }
  });

  it('rejects a program outside 2–40 bytes', () => {
    expect(() => validateLiquidTestnetAddress(segwitAddress('tex', 1, new Uint8Array(41).fill(0x44)))).toThrowError(
      LiquidTestnetRailError,
    );
  });
});

describe('txid namespace', () => {
  const good = 'b'.repeat(64);
  it('accepts a 64-char lowercase hex txid', () => {
    expect(validateLiquidTestnetTxid(good)).toBe(good);
  });

  it('rejects uppercase (fail-closed, no silent canonicalization)', () => {
    expect(() => validateLiquidTestnetTxid(good.toUpperCase())).toThrowError(LiquidTestnetRailError);
    try {
      validateLiquidTestnetTxid('B'.repeat(64));
    } catch (e) {
      expect((e as LiquidTestnetRailError).code).toBe('malformed_txid');
    }
  });

  it('rejects wrong shapes: 63/65 chars, non-hex, whitespace', () => {
    expect(() => validateLiquidTestnetTxid('a'.repeat(63))).toThrowError(LiquidTestnetRailError);
    expect(() => validateLiquidTestnetTxid('a'.repeat(65))).toThrowError(LiquidTestnetRailError);
    expect(() => validateLiquidTestnetTxid(`${'g'.repeat(63)}0`)).toThrowError(LiquidTestnetRailError);
    expect(() => validateLiquidTestnetTxid(` ${good} `)).toThrowError(LiquidTestnetRailError);
  });
});

describe('chain-identity anchors (pinned to live-fetched values)', () => {
  it('pins the liquid-testnet genesis hash used by the probe layer', () => {
    expect(LIQUID_TESTNET_GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(LIQUID_TESTNET_GENESIS_HASH).toBe(
      'a771da8e52ee6ad581ed1e9a99825e5b3b7992225534eaa2ae23244fe26ab1c1',
    );
  });

  it('pins the native LBTC asset id', () => {
    expect(LIQUID_TESTNET_NATIVE_ASSET_ID).toMatch(/^[0-9a-f]{64}$/);
    expect(LIQUID_TESTNET_NATIVE_ASSET_ID).toBe(
      '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
    );
  });

  it('exposes the probe base, HRP and rail id contracts', () => {
    expect(LIQUID_TESTNET_ESPLORA_BASE).toBe('https://blockstream.info/liquidtestnet/api');
    expect(LIQUID_TESTNET_HRP).toBe('tex');
    expect(LIQUID_TESTNET_RAIL).toBe('liquid-testnet');
    expect(isLiquidTestnetRail('liquid-testnet')).toBe(true);
    expect(isLiquidTestnetRail('btc-testnet4')).toBe(false);
    expect(isLiquidTestnetRail('liquid')).toBe(false);
  });
});

describe('frontend surface (mirrors step-5 exports)', () => {
  const TX = 'cc'.repeat(32);

  it('builds explorer tx/address URLs from validated inputs', () => {
    expect(LIQUID_TESTNET_EXPLORER_BASE).toBe('https://blockstream.info/liquidtestnet');
    expect(liquidTestnetExplorerTxUrl(TX)).toBe(`https://blockstream.info/liquidtestnet/tx/${TX}`);
    // A REAL taproot tex address built with the shared builders.
    const addr = p2trAddress(tweakOutputKey(hexToBytes(NUMS_INTERNAL_XONLY)), 'tex');
    expect(addr.startsWith('tex1p')).toBe(true);
    expect(liquidTestnetExplorerAddressUrl(addr)).toBe(`https://blockstream.info/liquidtestnet/address/${addr}`);
  });

  it('refuses to link to a malformed txid or a foreign-chain address', () => {
    expect(() => liquidTestnetExplorerTxUrl('A'.repeat(64))).toThrow(/lowercase/);
    expect(() => liquidTestnetExplorerAddressUrl('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toThrow(
      /wrong_network/,
    );
    // 'lq1…' is liquid MAINNET - cross-network, not confidential.
    expect(() => liquidTestnetExplorerAddressUrl('lq1qqbadinput')).toThrow(/cross_network_rejected/);
  });

  it('badge text is exact and no-value', () => {
    expect(LIQUID_TESTNET_NO_VALUE_BADGE).toBe('LIQUID TESTNET · NO VALUE');
  });

  it('gate mirror reads VITE_BAO_LQ_ENABLED per call - only exact "1" enables; default off', () => {
    expect(isLiquidTestnetRailEnabled()).toBe(false); // fail closed - flag not wired yet
    (import.meta.env as Record<string, string>).VITE_BAO_LQ_ENABLED = '1';
    expect(isLiquidTestnetRailEnabled()).toBe(true);
    (import.meta.env as Record<string, string>).VITE_BAO_LQ_ENABLED = '0';
    expect(isLiquidTestnetRailEnabled()).toBe(false);
    delete (import.meta.env as Record<string, string>).VITE_BAO_LQ_ENABLED;
  });
});
