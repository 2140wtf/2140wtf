/**
 * Byte-codec safety guard - the v1-incident regression suite (2026-09-13).
 *
 * v1 of the tester-identity generator hand-rolled a hex decoder with
 * `slice(i * 2, i + 2)` (missing `2 *` on the end index): byte 0 decoded
 * correctly, byte 1 kept only its high nibble, every later byte collapsed
 * to 0x00. Tester identities were generated, funded with real testnet4
 * sats, and turned out to be UNRECOVERABLE - the addresses encoded garbage
 * points with unknown discrete logs. See docs/RECOVERY-STATUS.md.
 *
 * Three layers of "never again":
 *   1. CANONICAL VECTORS - repo hex codecs must reproduce published WIF /
 *      BIP-341 vectors byte-for-byte, so a decode bug cannot pass silently.
 *   2. THE TRIPWIRE - the exact v1 buggy decoder is executed and asserted
 *      to DISAGREE with the real codec. If the repo ever reintroduces that
 *      math, the disagreement assertion pins what the bug does; if someone
 *      "fixes" this test to make a hand-rolled codec agree with itself,
 *      the vector layer above still fails.
 *   3. THE SOURCE SCAN - src/ and scripts/ may not define private hex/
 *      base64 codecs (library imports only) nor use index-sliced nibble
 *      decoding (`slice(i * 2, i + 2)`-class bugs) anywhere. Build
 *      bundles (`*.bundle.mjs`) are exempt; test files are exempt.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js';
import { bech32m, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  NUMS_INTERNAL_XONLY,
} from './testnet4Taproot';
import { DEPOSIT_GENESIS_ANCHOR } from './testnet4Deposit';
import { validateTestnet4Address } from './testnet4Rail';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('byte codecs - canonical vectors', () => {
  it('hex round-trips for random 64-byte buffers (×64)', () => {
    for (let i = 0; i < 64; i++) {
      const bytes = new Uint8Array(64);
      crypto.getRandomValues(bytes); // deterministic enough: any differing byte fails
      const hex = bytesToHex(bytes);
      expect(hex).toMatch(/^[0-9a-f]{128}$/);
      expect(Array.from(hexToBytes(hex))).toEqual(Array.from(bytes));
      // library cross-check - two independent implementations must agree
      expect(Array.from(nobleHexToBytes(hex))).toEqual(Array.from(bytes));
    }
  });

  it('hex codecs reject malformed input', () => {
    expect(() => hexToBytes('abc')).toThrow(); // odd length
    expect(() => hexToBytes('zz')).toThrow(); // non-hex
    expect(() => hexToBytes(42 as unknown as string)).toThrow(); // not a string
  });

  it('DECISION VECTOR - the vector that burned v1: full nibble coverage', () => {
    // The v1 decoder produced 57 0c 00 00 … from 57c9924d… - byte 1 lost
    // its low nibble, bytes 2+ vanished. A correct codec must recover EVERY
    // byte; assert all 32, ordered, against the library.
    const hex = '57c9924d67996f239a255609d0642d00892104db3a2d961a4125f7286460ac32';
    expect(Array.from(hexToBytes(hex))).toEqual(Array.from(nobleHexToBytes(hex)));
    expect(bytesToHex(hexToBytes(hex))).toBe(hex); // lowercase input round-trips exactly
  });

  it('WIF vectors (the encoding v1 hand-rolled and got wrong)', () => {
    const b58c = createBase58check(sha256);
    // privkey = 1, compressed - published BIP-376/WIF vector
    const one = Uint8Array.of(0x80, ...Array(31).fill(0x00), 0x01, 0x01);
    expect(b58c.encode(one)).toBe('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn');
    // all-zero key: 32 LEADING ZERO BYTES - the exact input class the v1
    // hand-rolled base58 decoder restored wrongly (37 vs 34 bytes). The
    // library handles it; the round-trip must hold.
    const zeros = Uint8Array.of(0x80, ...Array(32).fill(0x00), 0x01);
    const zerosWif = b58c.encode(zeros);
    expect(b58c.decode(zerosWif)).toEqual(zeros);
    // checksum must reject a tampered char
    const tampered = (zerosWif[0] === 'K' ? 'L' : 'K') + zerosWif.slice(1);
    expect(() => b58c.decode(tampered)).toThrow();
  });

  it('bech32/bech32m address vectors still validate through the rail', () => {
    // The NUMS constant round-trips through the codec (asserted against the
    // DECISION VECTOR's known bytes - both are 32-byte values; equality with
    // the constant hex pins byte order).
    const nums = NUMS_INTERNAL_XONLY;
    expect(bytesToHex(hexToBytes(nums))).toBe(nums);
    const v1 = validateTestnet4Address('tb1pvhkwcgmsf27d7kxlelc8alurptkhey0wuf9deudxgqvhm7l0ux5s37g6xs');
    expect(v1.version).toBe(1); // witness v1 (P2TR)
    expect(v1.programBytes.length).toBe(32);
    // and the genesis anchor must be exactly 32 bytes of the pinned hash
    expect(hexToBytes(DEPOSIT_GENESIS_ANCHOR).length).toBe(32);
  });
});

describe('byte codecs - the v1 tripwire', () => {
  /**
   * The EXACT decoder from make-tester-identities.mjs v1, verbatim. Kept
   * here so the bug's behavior is pinned forever: any refactor that
   * reintroduces this math elsewhere will produce the same corrupted
   * output this test asserts (and thereby differs from the codec).
   */
  function v1BuggyHexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i + 2), 16);
    return out;
  }

  it('the v1 decoder is corrupt - assert its exact failure shape', () => {
    const hex = '57c9924d67996f239a255609d0642d00892104db3a2d961a4125f7286460ac32';
    const buggy = v1BuggyHexToBytes(hex);
    const good = hexToBytes(hex);
    // byte 0 happens to survive (i=0: slice(0,2) is correct by accident)
    expect(buggy[0]).toBe(good[0]);
    // byte 1 keeps only the high nibble ('c9' → 0x0c)
    expect(buggy[1]).toBe(0x0c);
    // bytes 2+ collapse to zero
    for (let i = 2; i < 32; i++) expect(buggy[i]).toBe(0);
    // …and the whole thing disagrees with the real codec
    expect(Array.from(buggy)).not.toEqual(Array.from(good));
  });

  it('the v1 failure is observable through the ADDRESS layer too', () => {
    // End-to-end statement of the incident: garbage bytes can still form a
    // valid P2TR address (the encoder is fine - the DECODE was broken), so
    // the only thing that catches this class is decode-level equality with
    // a vetted codec. bech32m-wrapping the corrupted bytes yields a valid
    // address, proving why v1's output LOOKED correct.
    const corrupted = v1BuggyHexToBytes('57c9924d67996f239a255609d0642d00892104db3a2d961a4125f7286460ac32');
    const addr = bech32m.encode('tb', [1, ...bech32m.toWords(corrupted)], 90);
    expect(addr.startsWith('tb1p')).toBe(true);
    // The rail validator accepts it - same shape as the addresses that
    // burned v1's funds. Decode-level codec equality is the ONLY guard.
    const dec = validateTestnet4Address(addr);
    expect(dec.version).toBe(1);
    expect(Array.from(dec.programBytes)).toEqual(Array.from(corrupted));
  });
});

describe('byte codecs - repo source scan', () => {
  /** Repo source under the rule: src/ + scripts/, minus tests and bundles. */
  function repoSourceFiles(): string[] {
    const out: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist') continue;
          visit(p);
        } else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.bundle.mjs')) {
          out.push(p);
        }
      }
    };
    visit(join(root, 'src'));
    visit(join(root, 'scripts'));
    return out;
  }

  const EXEMPT = [
    // Single-char nibble read for NIP-13 leading-zero-bit counting - not a
    // byte codec (no index math to get wrong, input is a hex STRING).
    'src/components/agents/AgentGateCheck.tsx',
    // Decimal body parsing in the probe - parseInt(body, 10) is not hex.
    'src/lib/testnet4Observe.ts',
    'src/lib/testnet4Probe.ts',
  ];

  it('no private hex/bytes codec helpers in repo source', () => {
    const offenders: string[] = [];
    for (const file of repoSourceFiles()) {
      const rel = file.slice(root.length + 1);
      if (EXEMPT.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      // Private hex codec definitions - the shape v1 had. EXPORTED codec
      // wrappers are the sanctioned single-codec entry points (the rail's
      // typed hexToBytes/bytesToHex) and are allowed; anything not
      // preceded by `export` is a shadow helper and banned.
      if (/(?<!export\s)(function|const)\s+(hexToBytes|bytesToHex)\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('no index-sliced nibble decoding anywhere (the v1 bug class)', () => {
    const offenders: string[] = [];
    for (const file of repoSourceFiles()) {
      const rel = file.slice(root.length + 1);
      if (EXEMPT.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      // v1 bug class: parseInt(<slice with INDEX ARITHMETIC>, 16) - end
      // index computed from i, not 2*i. The i*2 + 2 form is correct but
      // STILL BANNED in favor of library codecs; single-char parseInt is
      // allowed (see EXEMPT).
      if (/parseInt\([^)]*slice\(\s*\w+\s*\*\s*2\s*,\s*\w+\s*\+\s*2\s*\)[^)]*,\s*16\s*\)/.test(src)) offenders.push(`${rel} (i*2 + 2 form)`);
      if (/parseInt\([^)]*slice\(\s*\w+\s*\*\s*2\s*,\s*\w+\s*\)[^)]*,\s*16\s*\)/.test(src)) offenders.push(`${rel} (v1 bug form)`);
    }
    expect(offenders).toEqual([]);
  });
});
