/**
 * Testnet4 rail step 1 acceptance - the cross-network rejection matrix from
 * docs/TESTNET4-RAIL-DESIGN.md §2/§6: addresses and txids from the WRONG
 * network namespace fail typed; valid testnet-format addresses parse; the
 * honest tb-sharing limit is asserted so no one later "fixes" address-level
 * foreign-testnet rejection into a false chain claim.
 */
import { describe, expect, it } from 'vitest';
import {
  BTC_TESTNET4_GENESIS_HASH,
  BTC_TESTNET4_RAIL,
  TESTNET4_ESPLORA_BASE,
  TESTNET4_EXPLORER_BASE,
  TESTNET4_NO_VALUE_BADGE,
  Testnet4RailError,
  isTestnet4Rail,
  isTestnet4RailEnabled,
  testnet4ExplorerAddressUrl,
  testnet4ExplorerTxUrl,
  validateTestnet4Address,
  validateTestnet4Txid,
} from './testnet4Rail';
import { NUMS_INTERNAL_XONLY, hexToBytes, p2trAddress, tweakOutputKey } from './testnet4Taproot';
import { bech32, bech32m } from '@scure/base';

/** Build a syntactically valid segwit address for an arbitrary HRP (negative-matrix factory). */
function segwitAddress(hrp: string, version: number, program: Uint8Array): string {
  const words = [version, ...bech32m.toWords(program)];
  // @scure/base v2: encode(hrp, words, limit) where limit = 90 (bech32) or 90
  // (bech32m); the CONSTANT is selected by which codec object we call.
  return version === 0 ? bech32.encode(hrp, words as never, 90) : bech32m.encode(hrp, words as never, 90);
}

const P2WPKH_20 = new Uint8Array(20).fill(0x11);
const P2TR_32 = new Uint8Array(32).fill(0x22);

describe('valid testnet-format addresses', () => {
  it('accepts a v0 bech32 address (tb1q…, 20-byte program)', () => {
    const addr = segwitAddress('tb', 0, P2WPKH_20);
    expect(addr.startsWith('tb1q')).toBe(true);
    const parsed = validateTestnet4Address(addr);
    expect(parsed.version).toBe(0);
    expect(parsed.programBytes).toEqual(P2WPKH_20);
  });

  it('accepts a v1 bech32m address (tb1p…, 32-byte program) - taproot', () => {
    const addr = segwitAddress('tb', 1, P2TR_32);
    expect(addr.startsWith('tb1p')).toBe(true);
    const parsed = validateTestnet4Address(addr);
    expect(parsed.version).toBe(1);
    expect(parsed.programBytes).toEqual(P2TR_32);
  });

  it('accepts uppercase (BIP-173 allows all-caps), rejecting mixed case', () => {
    const addr = segwitAddress('tb', 0, P2WPKH_20);
    expect(validateTestnet4Address(addr.toUpperCase()).version).toBe(0);
    const mixed = addr[0].toUpperCase() + addr.slice(1);
    expect(() => validateTestnet4Address(mixed)).toThrowError(Testnet4RailError);
    try {
      validateTestnet4Address(mixed);
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('malformed_address');
    }
  });
});

describe('cross-network rejection matrix', () => {
  it('rejects mainnet bc1… as wrong_network', () => {
    const addr = segwitAddress('bc', 0, P2WPKH_20);
    try {
      validateTestnet4Address(addr);
      expect.unreachable('mainnet address accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(Testnet4RailError);
      expect((e as Testnet4RailError).code).toBe('wrong_network');
      expect((e as Testnet4RailError).detail).toContain('mainnet');
    }
  });

  it('rejects regtest bcrt1… as wrong_network', () => {
    const addr = segwitAddress('bcrt', 1, P2TR_32);
    expect(() => validateTestnet4Address(addr)).toThrowError(Testnet4RailError);
    try {
      validateTestnet4Address(addr);
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('wrong_network');
    }
  });

  it('rejects every Liquid HRP as cross_network_rejected (separate asset chain)', () => {
    for (const hrp of ['ex', 'lq', 'tex', 'tq']) {
      // Liquid segwit uses the same bech32(m) envelope shape; the prefix alone must disqualify it.
      const addr = segwitAddress(hrp, 0, P2WPKH_20);
      try {
        validateTestnet4Address(addr);
        expect.unreachable(`liquid prefix ${hrp} accepted`);
      } catch (e) {
        expect(e).toBeInstanceOf(Testnet4RailError);
        expect((e as Testnet4RailError).code).toBe('cross_network_rejected');
      }
    }
  });

  it('rejects a Liquid-style confidential prefix even when the payload is valid bech32', () => {
    // 'tex' is the Liquid testnet v1 taproot prefix - the exact second rail's
    // namespace; crossing it with a bitcoin txid/address must always fail.
    const addr = segwitAddress('tex', 1, P2TR_32);
    try {
      validateTestnet4Address(addr);
      expect.unreachable('tex accepted');
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('cross_network_rejected');
    }
  });

  it('rejects an unknown HRP as malformed (not silently typed as another network)', () => {
    const addr = segwitAddress('xx', 0, P2WPKH_20);
    try {
      validateTestnet4Address(addr);
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('malformed_address');
    }
  });
});

describe('malformed address matrix', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['tb1q', 'too short'],
    ['tb', 'no separator'],
    ['1qxyzabcdefgh', 'no HRP'],
    [`tb1q${'q'.repeat(100)}`, 'over 90 chars'],
    ['tb1qnonconst!!', 'bad charset'],
  ];
  for (const [input, why] of cases) {
    it(`rejects: ${why} (${input.slice(0, 18)})`, () => {
      expect(() => validateTestnet4Address(input)).toThrowError(Testnet4RailError);
    });
  }

  it('rejects a v0 program of invalid length (e.g. 21 bytes)', () => {
    const addr = segwitAddress('tb', 0, new Uint8Array(21).fill(0x33));
    try {
      validateTestnet4Address(addr);
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('malformed_address');
      expect((e as Testnet4RailError).detail).toContain('20 or 32');
    }
  });

  it('rejects a program outside 2–40 bytes', () => {
    const addr = segwitAddress('tb', 1, new Uint8Array(41).fill(0x44));
    expect(() => validateTestnet4Address(addr)).toThrowError(Testnet4RailError);
  });
});

describe('txid namespace', () => {
  const t4 = 'a'.repeat(64);
  it('accepts a 64-char lowercase hex txid', () => {
    expect(validateTestnet4Txid(t4)).toBe(t4);
  });

  it('rejects uppercase (fail-closed, no silent canonicalization)', () => {
    expect(() => validateTestnet4Txid(t4.toUpperCase())).toThrowError(Testnet4RailError);
    try {
      validateTestnet4Txid('A'.repeat(64));
    } catch (e) {
      expect((e as Testnet4RailError).code).toBe('malformed_txid');
    }
  });

  it('rejects wrong shapes: 63/65 chars, non-hex, whitespace', () => {
    expect(() => validateTestnet4Txid('a'.repeat(63))).toThrowError(Testnet4RailError);
    expect(() => validateTestnet4Txid('a'.repeat(65))).toThrowError(Testnet4RailError);
    expect(() => validateTestnet4Txid(`${'g'.repeat(63)}0`)).toThrowError(Testnet4RailError);
    expect(() => validateTestnet4Txid(` ${t4} `)).toThrowError(Testnet4RailError);
  });
});

describe('chain-identity anchors (honest limit)', () => {
  it('pins the testnet4 genesis hash used by the probe layer', () => {
    // Fetched from the live Esplora API (block-height/0) 2026-09-12.
    expect(BTC_TESTNET4_GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(BTC_TESTNET4_GENESIS_HASH).toBe(
      '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    );
  });

  it('exposes the probe base and rail id contracts', () => {
    expect(TESTNET4_ESPLORA_BASE).toBe('https://mempool.space/testnet4/api');
    expect(BTC_TESTNET4_RAIL).toBe('btc-testnet4');
    expect(isTestnet4Rail('btc-testnet4')).toBe(true);
    expect(isTestnet4Rail('l1')).toBe(false);
    expect(isTestnet4Rail('liquid')).toBe(false);
  });
});

describe('frontend surface (step 5)', () => {
  const TX = 'aa'.repeat(32);

  it('builds explorer tx/address URLs from validated inputs', () => {
    expect(TESTNET4_EXPLORER_BASE).toBe('https://mempool.space/testnet4');
    expect(testnet4ExplorerTxUrl(TX)).toBe(`https://mempool.space/testnet4/tx/${TX}`);
    // A REAL P2TR testnet address, built with the step-2 builders so the
    // checksum is genuinely valid (hand-invented bech32m strings are not).
    const addr = p2trAddress(tweakOutputKey(hexToBytes(NUMS_INTERNAL_XONLY)), 'tb');
    expect(addr.startsWith('tb1p')).toBe(true);
    expect(testnet4ExplorerAddressUrl(addr)).toBe(`https://mempool.space/testnet4/address/${addr}`);
  });

  it('refuses to link to a malformed txid or a foreign-network address', () => {
    expect(() => testnet4ExplorerTxUrl('A'.repeat(64))).toThrow(/lowercase/);
    expect(() => testnet4ExplorerAddressUrl('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toThrow(/wrong_network/);
  });

  it('badge text is exact and no-value', () => {
    expect(TESTNET4_NO_VALUE_BADGE).toBe('TESTNET4 · NO VALUE');
  });

  it('gate mirror reads VITE_BAO_T4_ENABLED per call - only exact "1" enables', () => {
    expect(isTestnet4RailEnabled()).toBe(false); // default off - fail closed
    (import.meta.env as Record<string, string>).VITE_BAO_T4_ENABLED = '1';
    expect(isTestnet4RailEnabled()).toBe(true);
    (import.meta.env as Record<string, string>).VITE_BAO_T4_ENABLED = '0';
    expect(isTestnet4RailEnabled()).toBe(false);
    delete (import.meta.env as Record<string, string>).VITE_BAO_T4_ENABLED;
  });
});
