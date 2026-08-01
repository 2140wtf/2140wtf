import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hex } from '@scure/base';
import { nip19 } from 'nostr-tools';

import '@/lib/polyfills';
import {
  buildUnsignedPsbt,
  buildUnsignedSilentPaymentPsbt,
  finalizePsbt,
  isLargeAmount,
  LARGE_AMOUNT_USD_THRESHOLD,
  looksLikeSilentPaymentAddress,
  nostrPubkeyToBitcoinAddress,
  npubToBitcoinAddress,
  parseBitcoinUri,
  validateBitcoinAddress,
  validateSilentPaymentAddress,
  type UTXO,
} from '@/lib/bitcoin';
import { encodePsbtV2, parsePsbtV2, extractTxFromSignedPsbtV2 } from '@/lib/psbtV2';
import { NSecSignerBtc } from '@/lib/bitcoin-signers';
import { esploraFetch } from '@/lib/esplora';

// broadcastTransactionDisambiguated tests stub the failover client; the rest
// of this file never touches the network, so a file-wide mock is safe.
vi.mock('@/lib/esplora', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esplora')>()),
  esploraFetch: vi.fn(),
}));

/**
 * Regression test vectors for key-path-only P2TR address derivation using the
 * Nostr pubkey directly as the internal key (no script tree).
 *
 * Each vector was produced by the live bitcoin toolchain and independently
 * validated against the address's bech32m checksum. They serve as regression
 * fixtures: if the derivation ever changes (library upgrade, ECC backend
 * switch, etc.) these tests will fail loudly.
 *
 * Note: these are NOT the addresses in the BIP-341 wallet test vectors,
 * because those vectors use a non-empty script tree (merkle root); our
 * implementation uses a key-path-only spend path (empty merkle root), which
 * is the correct derivation for mapping a Nostr pubkey to a spendable address.
 */
describe('nostrPubkeyToBitcoinAddress', () => {
  it('derives the expected key-path-only Taproot address (fixture 1)', () => {
    const internalPubkey = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d';
    const expected = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

    expect(nostrPubkeyToBitcoinAddress(internalPubkey)).toBe(expected);
  });

  it('derives the expected key-path-only Taproot address (fixture 2)', () => {
    const internalPubkey = '187791b6f712a8ea41c8ecdd0ee77fab3e85263b37e1ec18a3651926b3a6cf27';
    const expected = 'bc1pjxzw9tm6qatyapu3c409dg8k23p4hjlk4ehwwlsum3emjqsaetrqppyu2z';

    expect(nostrPubkeyToBitcoinAddress(internalPubkey)).toBe(expected);
  });

  it('derives the expected key-path-only Taproot address (fixture 3)', () => {
    const internalPubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const expected = 'bc1p2jdrzv2w45xws7qlguk0acmz9clje8fasvhx3kv3cgpmhm8qtzhsq6fyhy';

    expect(nostrPubkeyToBitcoinAddress(internalPubkey)).toBe(expected);
  });

  it('produces a bech32m mainnet address that passes validation', () => {
    const pubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

    const address = nostrPubkeyToBitcoinAddress(pubkey);

    expect(address.startsWith('bc1p')).toBe(true);
    expect(validateBitcoinAddress(address)).toBe(true);
  });

  it('is deterministic — same input yields the same non-empty address', () => {
    // Use a pubkey known to be a valid on-curve secp256k1 x-only point.
    const pubkey = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d';

    const a1 = nostrPubkeyToBitcoinAddress(pubkey);
    const a2 = nostrPubkeyToBitcoinAddress(pubkey);
    expect(a1).toBe(a2);
    expect(a1).not.toBe('');
  });

  it('returns empty string for malformed pubkeys instead of throwing', () => {
    // Too short.
    expect(nostrPubkeyToBitcoinAddress('abc')).toBe('');
    // Non-hex characters.
    expect(nostrPubkeyToBitcoinAddress('z'.repeat(64))).toBe('');
    // Empty string.
    expect(nostrPubkeyToBitcoinAddress('')).toBe('');
    // Odd length (not a whole number of bytes).
    expect(nostrPubkeyToBitcoinAddress('a'.repeat(63))).toBe('');
  });

  it('returns empty string for hex that is not a valid secp256k1 x-only point', () => {
    // Suppress the catch-block console.error for this test so it doesn't
    // pollute the test output. The function is expected to log and return ''.
    const origError = console.error;
    console.error = () => {};
    try {
      // Valid 64-char hex, but not a valid on-curve secp256k1 x-only point.
      expect(nostrPubkeyToBitcoinAddress('e7a2e3b5f1c8d4a6b9c0e1f2d3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2')).toBe('');
    } finally {
      console.error = origError;
    }
  });

  it('accepts both upper- and lower-case hex', () => {
    const lower = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d';
    const upper = lower.toUpperCase();

    expect(nostrPubkeyToBitcoinAddress(lower)).toBe(nostrPubkeyToBitcoinAddress(upper));
  });
});

describe('npubToBitcoinAddress', () => {
  it('decodes an npub and derives the matching Taproot address', () => {
    // Any valid Nostr pubkey works — we just verify round-trip consistency.
    const pubkey = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
    const npub = nip19.npubEncode(pubkey);

    const fromHex = nostrPubkeyToBitcoinAddress(pubkey);
    const fromNpub = npubToBitcoinAddress(npub);

    expect(fromNpub).toBe(fromHex);
  });

  it('throws on non-npub NIP-19 input', () => {
    const note = nip19.noteEncode('d6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d');
    expect(() => npubToBitcoinAddress(note)).toThrow(/npub/i);
  });
});

describe('validateBitcoinAddress', () => {
  it('accepts valid bech32m P2TR addresses', () => {
    expect(validateBitcoinAddress('bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5')).toBe(true);
  });

  it('accepts legacy P2PKH and P2SH addresses', () => {
    expect(validateBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
    expect(validateBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(validateBitcoinAddress('')).toBe(false);
    expect(validateBitcoinAddress('not-an-address')).toBe(false);
    // Valid-looking bech32m with broken checksum (flipped last char).
    expect(validateBitcoinAddress('bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z6')).toBe(false);
  });
});

describe('parseBitcoinUri', () => {
  it('returns null for inputs without a bitcoin: scheme', () => {
    expect(parseBitcoinUri('')).toBeNull();
    expect(parseBitcoinUri('bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5')).toBeNull();
    expect(parseBitcoinUri('lightning:lnbc...')).toBeNull();
  });

  it('extracts the address from a bare bitcoin: URI', () => {
    expect(parseBitcoinUri('bitcoin:bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5')).toEqual({
      address: 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
      sp: undefined,
      amountSats: undefined,
    });
  });

  it('is case-insensitive on the scheme', () => {
    expect(parseBitcoinUri('BITCOIN:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toEqual({
      address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      sp: undefined,
      amountSats: undefined,
    });
  });

  it('strips a trailing query string and surfaces the sp parameter', () => {
    const uri = 'bitcoin:bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5?label=Tip&sp=sp1qq';
    expect(parseBitcoinUri(uri)).toEqual({
      address: 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
      sp: 'sp1qq',
      amountSats: undefined,
    });
  });

  it('ignores non-amount/non-sp parameters', () => {
    const uri = 'bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?label=Tip&message=hi';
    expect(parseBitcoinUri(uri)).toEqual({
      address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      sp: undefined,
      amountSats: undefined,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseBitcoinUri('  bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2  ')).toEqual({
      address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      sp: undefined,
      amountSats: undefined,
    });
  });

  it('parses the BIP-21 amount (BTC) into satoshis', () => {
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.5')).toEqual({
      address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      sp: undefined,
      amountSats: 50_000_000,
    });
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.00012345')).toEqual({
      address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      sp: undefined,
      amountSats: 12_345,
    });
  });

  it('parses the smallest satoshi amount exactly without floating-point rounding loss', () => {
    // Regression: 0.00000001 BTC * 1e8 used to evaluate to 0.9999999999999999
    // and floor to 0. It must be exactly 1 sat.
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.00000001')?.amountSats).toBe(1);
  });

  it('omits amountSats when the parameter is malformed or non-positive', () => {
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=abc')?.amountSats).toBeUndefined();
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0')?.amountSats).toBeUndefined();
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=-1')?.amountSats).toBeUndefined();
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=')?.amountSats).toBeUndefined();
    expect(parseBitcoinUri('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2?amount=0.000000019')?.amountSats).toBeUndefined();
  });
});

describe('isLargeAmount', () => {
  // Assume a BTC price of $100_000 for easy arithmetic. 1 BTC = $100k, so
  // 1 sat = $0.001 and the $100 threshold corresponds to 100_000 sats.
  const PRICE = 100_000;

  it('returns true when the USD value is above the threshold', () => {
    // 200,000 sats @ $100k/BTC = $200 — well above $100.
    expect(isLargeAmount(200_000, PRICE)).toBe(true);
  });

  it('returns true at exactly the threshold', () => {
    // 100,000 sats @ $100k/BTC = $100 — at the threshold (inclusive).
    expect(isLargeAmount(100_000, PRICE)).toBe(true);
  });

  it('returns false below the threshold', () => {
    // 50,000 sats @ $100k/BTC = $50 — below $100.
    expect(isLargeAmount(50_000, PRICE)).toBe(false);
  });

  it('returns false when btcPrice is undefined', () => {
    expect(isLargeAmount(10_000_000, undefined)).toBe(false);
  });

  it('returns false for non-positive sats or prices', () => {
    expect(isLargeAmount(0, PRICE)).toBe(false);
    expect(isLargeAmount(-1, PRICE)).toBe(false);
    expect(isLargeAmount(100_000, 0)).toBe(false);
    expect(isLargeAmount(100_000, -PRICE)).toBe(false);
    expect(isLargeAmount(100_000, NaN)).toBe(false);
  });

  it('exports a sensible default threshold', () => {
    expect(LARGE_AMOUNT_USD_THRESHOLD).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BIP-352 / BIP-375 silent payment send pipeline
// ---------------------------------------------------------------------------

/**
 * BIP-352 reference silent payment address. Used everywhere this module
 * needs to exercise the SP code paths.
 */
const REFERENCE_SP_ADDRESS =
  'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';

/**
 * The wallet's only signing input is the user's Nostr nsec used as a
 * Taproot internal key with no script tree. This fixture pubkey is the
 * x-only key derived from a fixed nsec — handy for both the address and
 * the local-sign path.
 */
const SENDER_PUBKEY_HEX = 'd6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d';
/** A valid 32-byte secp256k1 private key whose pubkey matches the above. */
const SENDER_NSEC_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';

describe('looksLikeSilentPaymentAddress / validateSilentPaymentAddress', () => {
  it('routes sp1… input to the SP path', () => {
    expect(looksLikeSilentPaymentAddress(REFERENCE_SP_ADDRESS)).toBe(true);
    expect(validateSilentPaymentAddress(REFERENCE_SP_ADDRESS)).toBe(true);
  });

  it('refuses regular addresses and garbage', () => {
    expect(looksLikeSilentPaymentAddress('bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5')).toBe(false);
    expect(validateSilentPaymentAddress('')).toBe(false);
    expect(validateSilentPaymentAddress('sp1totallynotreal')).toBe(false);
  });
});

describe('buildUnsignedSilentPaymentPsbt', () => {
  /** A single 200 000-sat P2TR UTXO from the sender to their own address. */
  function senderUtxos(): UTXO[] {
    return [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 200_000,
        status: { confirmed: true },
      },
    ];
  }

  it('emits a PSBT v2 with PSBT_OUT_SP_V0_INFO and a change output', () => {
    const { psbtHex, fee } = buildUnsignedSilentPaymentPsbt(
      SENDER_PUBKEY_HEX,
      REFERENCE_SP_ADDRESS,
      50_000,
      senderUtxos(),
      5, // sat/vB
    );

    const parsed = parsePsbtV2(psbtHex);
    expect(parsed.txVersion).toBe(2);
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.outputs).toHaveLength(2);

    // Output 0 is the SP recipient: no script, has PSBT_OUT_SP_V0_INFO.
    expect(parsed.outputs[0].script).toBeUndefined();
    expect(parsed.outputs[0].amount).toBe(50_000n);
    const spInfo = parsed.outputs[0].unknown.find((u) => u.keyType === 0x09);
    expect(spInfo).toBeDefined();
    expect(spInfo!.value.length).toBe(67);

    // Output 1 is the change: regular P2TR script back to the sender, with
    // amount = input - send - fee. The exact fee depends on output count;
    // we just sanity-check that the value is positive and consistent with
    // total - send - fee.
    expect(parsed.outputs[1].script).toBeDefined();
    expect(parsed.outputs[1].amount).toBe(BigInt(200_000 - 50_000 - fee));
  });

  it('omits the change output when change would be dust', () => {
    // Build a scenario where after subtracting the SP output amount and the
    // 1-output fee, the leftover is below the 546-sat dust limit. With a
    // 5 sat/vB fee rate, a 1-input/1-output P2TR tx costs ≈555 sats. Sending
    // 50_000 sats from a 50_700-sat UTXO leaves 700 - 555 = 145 sats, which
    // is dust — the builder must drop the change output.
    const utxos = [{
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      vout: 0,
      value: 50_700,
      status: { confirmed: true },
    } satisfies UTXO];

    const { psbtHex } = buildUnsignedSilentPaymentPsbt(
      SENDER_PUBKEY_HEX,
      REFERENCE_SP_ADDRESS,
      50_000,
      utxos,
      5,
    );
    const parsed = parsePsbtV2(psbtHex);
    // Just the SP recipient — no dust change.
    expect(parsed.outputs).toHaveLength(1);
    expect(parsed.outputs[0].script).toBeUndefined();
  });

  it('refuses to build when the amount is below the dust limit', () => {
    expect(() =>
      buildUnsignedSilentPaymentPsbt(SENDER_PUBKEY_HEX, REFERENCE_SP_ADDRESS, 100, senderUtxos(), 5),
    ).toThrow(/546/);
  });

  it('refuses to build when there are no UTXOs', () => {
    expect(() =>
      buildUnsignedSilentPaymentPsbt(SENDER_PUBKEY_HEX, REFERENCE_SP_ADDRESS, 50_000, [], 5),
    ).toThrow(/no UTXOs/i);
  });

  it('refuses to build when balance is insufficient for amount + fee', () => {
    const tinyUtxos: UTXO[] = [{
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      vout: 0,
      value: 600, // just barely above dust
      status: { confirmed: true },
    }];
    expect(() =>
      buildUnsignedSilentPaymentPsbt(SENDER_PUBKEY_HEX, REFERENCE_SP_ADDRESS, 50_000, tinyUtxos, 5),
    ).toThrow(/insufficient/i);
  });

  it('refuses a testnet (`tsp1…`) address', () => {
    // Re-encode the reference scan/spend pair with the `tsp` HRP. Easier to
    // pass any tsp1-looking string that decodes (or fails with the testnet
    // error path) — the wallet rejects testnet outright.
    const fakeTsp = 'tsp' + REFERENCE_SP_ADDRESS.slice(2);
    expect(() =>
      buildUnsignedSilentPaymentPsbt(SENDER_PUBKEY_HEX, fakeTsp, 50_000, senderUtxos(), 5),
    ).toThrow();
  });

  it('refuses a malformed sender pubkey', () => {
    expect(() =>
      buildUnsignedSilentPaymentPsbt('not-hex', REFERENCE_SP_ADDRESS, 50_000, senderUtxos(), 5),
    ).toThrow(/sender pubkey/i);
  });
});

describe('NSecSignerBtc.signPsbt — BIP-375 path', () => {
  /**
   * End-to-end: build an unsigned BIP-375 PSBT v2, hand it to a local
   * NSecSignerBtc that owns the matching private key, then extract a raw
   * transaction. The signer must resolve the SP output internally so the
   * extracted tx has a valid P2TR script in place of `PSBT_OUT_SP_V0_INFO`.
   */
  it('resolves PSBT_OUT_SP_V0_INFO and returns an extractable PSBT v2', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();

    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedSilentPaymentPsbt(
      senderPubkey,
      REFERENCE_SP_ADDRESS,
      40_000,
      utxos,
      5,
    );

    const signed = await signer.signPsbt(psbtHex);

    // The signer should have filled in the SP output's script. Parse the
    // result and verify both outputs now carry scripts.
    const parsed = parsePsbtV2(signed);
    expect(parsed.outputs).toHaveLength(2);
    for (const o of parsed.outputs) {
      expect(o.script).toBeDefined();
      // First two bytes should be `OP_1 push32` (BIP-341 P2TR layout).
      expect(o.script![0]).toBe(0x51);
      expect(o.script![1]).toBe(0x20);
      expect(o.script!.length).toBe(34);
    }

    // The recipient output's x-only key must NOT be the sender's own
    // change script — otherwise the SP derivation never ran.
    const recipientXOnly = parsed.outputs[0].script!.slice(2, 34);
    const changeXOnly = parsed.outputs[1].script!.slice(2, 34);
    let same = true;
    for (let i = 0; i < 32; i++) {
      if (recipientXOnly[i] !== changeXOnly[i]) { same = false; break; }
    }
    expect(same).toBe(false);

    // …and the resulting PSBT must extract to a well-formed raw tx.
    const txHex = extractTxFromSignedPsbtV2(signed);
    // `02000000` is txVersion=2 in LE; `0001` is the SegWit marker/flag we
    // expect because Taproot inputs are signed with witnesses.
    expect(txHex.startsWith('020000000001')).toBe(true);
  });

  it('falls back to the regular PSBT v0 path when no SP outputs are present', async () => {
    // Use the existing buildUnsignedPsbt (regular send) — there are no
    // SP_V0_INFO rows, so signPsbt should take the fast path.
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();
    const senderAddr = nostrPubkeyToBitcoinAddress(senderPubkey);
    expect(senderAddr).not.toBe('');

    // Build a vanilla PSBT v0 send to the sender's own address. The
    // signer should not touch any BIP-375 code path.
    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];
    const { psbtHex } = buildUnsignedPsbt(senderPubkey, senderAddr, 40_000, utxos, 5);
    const signed = await signer.signPsbt(psbtHex);
    // Should be a regular PSBT v0 we can hand straight to finalizePsbt.
    expect(() => finalizePsbt(signed)).not.toThrow();
  });

  it('resolves a multi-input BIP-375 PSBT v2 using every input', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();

    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 60_000,
        status: { confirmed: true },
      },
      {
        txid: 'f5184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e17',
        vout: 1,
        value: 60_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedSilentPaymentPsbt(
      senderPubkey,
      REFERENCE_SP_ADDRESS,
      40_000,
      utxos,
      5,
    );

    const signed = await signer.signPsbt(psbtHex);

    const parsed = parsePsbtV2(signed);
    expect(parsed.inputs).toHaveLength(2);
    expect(parsed.outputs).toHaveLength(2);

    // Both outputs must have been resolved to concrete P2TR scripts.
    for (const o of parsed.outputs) {
      expect(o.script).toBeDefined();
      expect(o.script![0]).toBe(0x51);
      expect(o.script![1]).toBe(0x20);
      expect(o.script!.length).toBe(34);
    }

    // The recipient output must differ from the sender's change output,
    // proving the SP derivation ran rather than copying the change script.
    const recipientXOnly = parsed.outputs[0].script!.slice(2, 34);
    const changeXOnly = parsed.outputs[1].script!.slice(2, 34);
    expect(recipientXOnly).not.toEqual(changeXOnly);

    const txHex = extractTxFromSignedPsbtV2(signed);
    expect(txHex.startsWith('020000000001')).toBe(true);
  });

  it('rejects a BIP-375 PSBT whose script output is not the sender change', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();
    const senderScript = btc.p2tr(hexToBytes(senderPubkey), undefined, btc.NETWORK).script;

    // A valid x-only pubkey that is NOT the sender's, used to build a
    // malicious non-change script output.
    const otherPubkey = hexToBytes('187791b6f712a8ea41c8ecdd0ee77fab3e85263b37e1ec18a3651926b3a6cf27');
    const otherScript = btc.p2tr(otherPubkey, undefined, btc.NETWORK).script;

    const scanPubKey = hexToBytes('0220bcfac5b99e04ad1a06ddfb016ee13582609d60b6291e98d01a9bc9a16c96d4');
    const spendPubKey = hexToBytes('025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36');

    const maliciousPsbt = encodePsbtV2({
      inputs: [
        {
          txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
          vout: 0,
          witnessUtxo: { amount: 100_000n, script: senderScript },
          tapInternalKey: hexToBytes(senderPubkey),
        },
      ],
      outputs: [
        {
          type: 'sp',
          amount: 40_000n,
          scanPubKey,
          spendPubKey,
        },
        {
          type: 'script',
          amount: 50_000n,
          script: otherScript,
        },
      ],
    });

    await expect(signer.signPsbt(maliciousPsbt)).rejects.toThrow(/not a change output/i);
  });

  it('accepts a BIP-375 PSBT whose output matches the supplied payment intent', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();

    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedSilentPaymentPsbt(
      senderPubkey,
      REFERENCE_SP_ADDRESS,
      40_000,
      utxos,
      5,
    );

    const signed = await signer.signPsbt(psbtHex, {
      paymentIntents: [{ address: REFERENCE_SP_ADDRESS, amountSats: 40_000 }],
    });

    const txHex = extractTxFromSignedPsbtV2(signed);
    expect(txHex.startsWith('020000000001')).toBe(true);
  });

  it('rejects a BIP-375 PSBT whose output amount does not match the payment intent', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();

    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedSilentPaymentPsbt(
      senderPubkey,
      REFERENCE_SP_ADDRESS,
      40_000,
      utxos,
      5,
    );

    await expect(
      signer.signPsbt(psbtHex, {
        paymentIntents: [{ address: REFERENCE_SP_ADDRESS, amountSats: 39_999 }],
      }),
    ).rejects.toThrow(/BIP-375 transaction/i);
  });
});

import * as btc from '@scure/btc-signer';
import {
  BroadcastOutcomeUnknownError,
  broadcastTransactionDisambiguated,
  createBitcoinTransaction,
  txidFromRawTx,
  MAX_FEE_RATE_SATS_PER_VB,
  signPsbtLocal,
} from '@/lib/bitcoin';

describe('buildUnsignedPsbt safety guards', () => {
  function hexToBytes(h: string): Uint8Array {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  /** A single 100 000-sat P2TR UTXO from the sender to their own address. */
  function senderUtxos(): UTXO[] {
    return [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];
  }

  const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

  it('rejects an invalid sender pubkey', () => {
    expect(() =>
      buildUnsignedPsbt('not-hex', recipientAddress, 10_000, senderUtxos(), 5),
    ).toThrow(/sender public key/i);
  });

  it('rejects an invalid recipient address', () => {
    expect(() =>
      buildUnsignedPsbt(SENDER_PUBKEY_HEX, 'not-an-address', 10_000, senderUtxos(), 5),
    ).toThrow(/Invalid recipient/i);
  });

  it('rejects a testnet recipient address on the mainnet path', () => {
    // Derive a valid testnet P2TR address from the same pubkey; the mainnet
    // validator should reject it to prevent accidental network mismatch.
    const testnetAddr = btc.p2tr(
      hexToBytes(SENDER_PUBKEY_HEX),
      undefined,
      btc.TEST_NETWORK,
    ).address;
    expect(testnetAddr).toMatch(/^tb1/);
    expect(() =>
      buildUnsignedPsbt(SENDER_PUBKEY_HEX, testnetAddr!, 10_000, senderUtxos(), 5),
    ).toThrow(/Invalid recipient/i);
  });

  it('rejects fee rates above the sanity cap', () => {
    expect(() =>
      buildUnsignedPsbt(
        SENDER_PUBKEY_HEX,
        recipientAddress,
        10_000,
        senderUtxos(),
        MAX_FEE_RATE_SATS_PER_VB + 1,
      ),
    ).toThrow(/Fee rate must be between 1 and/i);
  });

  it('rejects fee rates below 1 sat/vB', () => {
    expect(() =>
      buildUnsignedPsbt(SENDER_PUBKEY_HEX, recipientAddress, 10_000, senderUtxos(), 0),
    ).toThrow(/Fee rate must be between 1 and/i);
  });
});

describe('signPsbtLocal', () => {
  it('signs a regular PSBT v0 and produces a finalizable PSBT', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();

    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];
    const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

    const { psbtHex } = buildUnsignedPsbt(
      senderPubkey,
      recipientAddress,
      40_000,
      utxos,
      5,
    );

    const signed = signPsbtLocal(psbtHex, SENDER_NSEC_HEX);
    expect(() => finalizePsbt(signed)).not.toThrow();
  });

  it('accepts payment intents that match the transaction outputs', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();
    const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
    const amountSats = 40_000;
    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedPsbt(senderPubkey, recipientAddress, amountSats, utxos, 5);

    expect(() =>
      signPsbtLocal(psbtHex, SENDER_NSEC_HEX, {
        paymentIntents: [{ address: recipientAddress, amountSats }],
      }),
    ).not.toThrow();
  });

  it('rejects payment intents whose amount does not match the output', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const senderPubkey = await signer.getPublicKey();
    const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];

    const { psbtHex } = buildUnsignedPsbt(senderPubkey, recipientAddress, 40_000, utxos, 5);

    expect(() =>
      signPsbtLocal(psbtHex, SENDER_NSEC_HEX, {
        paymentIntents: [{ address: recipientAddress, amountSats: 39_999 }],
      }),
    ).toThrow(/approved payment intent/);
  });

  it('rejects unexpected extra outputs beyond the payment intent and change', async () => {
    function hexToBytes(h: string): Uint8Array {
      const out = new Uint8Array(h.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    const signer = new NSecSignerBtc(hexToBytes(SENDER_NSEC_HEX));
    const _senderPubkey = await signer.getPublicKey();
    const senderPrivKey = hexToBytes(SENDER_NSEC_HEX);
    const senderInternal = btc.utils.pubSchnorr(senderPrivKey);
    const senderScript = btc.p2tr(senderInternal, undefined, btc.NETWORK).script;
    const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
    const otherAddress = 'bc1pjxzw9tm6qatyapu3c409dg8k23p4hjlk4ehwwlsum3emjqsaetrqppyu2z';

    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderInternal,
    });
    tx.addOutputAddress(recipientAddress, 40_000n, btc.NETWORK);
    tx.addOutputAddress(otherAddress, 10_000n, btc.NETWORK);

    expect(() =>
      signPsbtLocal(hex.encode(tx.toPSBT()), SENDER_NSEC_HEX, {
        paymentIntents: [{ address: recipientAddress, amountSats: 40_000 }],
      }),
    ).toThrow(/approved payment intent/);
  });
});

describe('signPsbtLocal safety inspections', () => {
  function hexToBytes(h: string): Uint8Array {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
  const senderPrivKey = hexToBytes(SENDER_NSEC_HEX);
  const senderPubkey = btc.utils.pubSchnorr(senderPrivKey);
  const senderScript = btc.p2tr(senderPubkey, undefined, btc.NETWORK).script;

  function psbtHexFromTx(tx: btc.Transaction): string {
    return hex.encode(tx.toPSBT());
  }

  it('rejects a PSBT whose input is missing a witness UTXO', () => {
    const tx = new btc.Transaction();
    tx.addInput({ txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16', index: 0 });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/witness/i);
  });

  it('rejects a PSBT with a zero-value input', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 0n, script: senderScript },
      tapInternalKey: senderPubkey,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/zero/i);
  });

  it('rejects a PSBT with an input owned by a different pubkey', () => {
    // A valid x-only pubkey that is NOT the sender's.
    const otherPubkey = hexToBytes('187791b6f712a8ea41c8ecdd0ee77fab3e85263b37e1ec18a3651926b3a6cf27');
    const otherScript = btc.p2tr(otherPubkey, undefined, btc.NETWORK).script;
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: otherScript },
      tapInternalKey: otherPubkey,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/not owned/i);
  });

  it('rejects a PSBT that requests a non-standard sighash', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderPubkey,
      sighashType: btc.SigHash.NONE,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/sighash/i);
  });

  it('rejects a PSBT whose outputs exceed its inputs', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 1000n, script: senderScript },
      tapInternalKey: senderPubkey,
    });
    tx.addOutputAddress(recipientAddress, 2000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/outputs exceed/i);
  });
});

describe('createBitcoinTransaction', () => {
  it('builds, signs, and finalizes a valid mainnet Taproot transaction', () => {
    const utxos: UTXO[] = [
      {
        txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
        vout: 0,
        value: 100_000,
        status: { confirmed: true },
      },
    ];
    const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

    const { txHex, fee } = createBitcoinTransaction(
      SENDER_NSEC_HEX,
      recipientAddress,
      40_000,
      utxos,
      5,
    );

    expect(fee).toBeGreaterThan(0);
    // Version 2 + SegWit marker/flag + at least one witness input.
    expect(txHex.startsWith('020000000001')).toBe(true);
  });
});

describe('signPsbtLocal additional adversarial cases', () => {
  function hexToBytes(h: string): Uint8Array {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  const recipientAddress = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
  const senderPrivKey = hexToBytes(SENDER_NSEC_HEX);
  const senderPubkey = btc.utils.pubSchnorr(senderPrivKey);
  const senderScript = btc.p2tr(senderPubkey, undefined, btc.NETWORK).script;

  function psbtHexFromTx(tx: btc.Transaction): string {
    return hex.encode(tx.toPSBT());
  }

  it('rejects a non-P2TR input (missing tapInternalKey)', () => {
    // P2WPKH witness v0 script: OP_0 push20 <20-byte pubkey hash>
    const p2wpkhScript = hexToBytes('0014' + 'a'.repeat(40));
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: p2wpkhScript },
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/Taproot/i);
  });

  it('rejects SIGHASH_SINGLE', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderPubkey,
      sighashType: btc.SigHash.SINGLE,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/sighash/i);
  });

  it('rejects SIGHASH_ALL | ANYONECANPAY (0x81)', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderPubkey,
      // Use the raw bitmask; @scure does not export ANYONECANPAY as a named constant.
      sighashType: 0x81,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);
    expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow(/sighash/i);
  });

  it('zeroizes the private key after a successful signing', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderPubkey,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);

    let zeroized = false;
    const spy = vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (this: Uint8Array, value: number) {
      if (value === 0 && this.length === 32) {
        zeroized = true;
      }
      return this;
    });
    try {
      signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX);
    } finally {
      spy.mockRestore();
    }
    expect(zeroized).toBe(true);
  });

  it('zeroizes the private key even when signing fails', () => {
    const tx = new btc.Transaction();
    tx.addInput({
      txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
      index: 0,
      witnessUtxo: { amount: 100_000n, script: senderScript },
      tapInternalKey: senderPubkey,
      sighashType: btc.SigHash.NONE,
    });
    tx.addOutputAddress(recipientAddress, 1000n, btc.NETWORK);

    let zeroized = false;
    const spy = vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (this: Uint8Array, value: number) {
      if (value === 0 && this.length === 32) {
        zeroized = true;
      }
      return this;
    });
    try {
      expect(() => signPsbtLocal(psbtHexFromTx(tx), SENDER_NSEC_HEX)).toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(zeroized).toBe(true);
  });
});


describe('broadcastTransactionDisambiguated', () => {
  // A real signed tx: the disambiguator derives the txid from the raw bytes
  // and probes `/tx/{txid}` after a failed broadcast.
  const DONATION_TX_HEX = createBitcoinTransaction(
    SENDER_NSEC_HEX,
    'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5',
    40_000,
    [{ txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16', vout: 0, value: 100_000, status: { confirmed: true } }],
    5,
  ).txHex;
  const TXID = txidFromRawTx(DONATION_TX_HEX);
  const URLS = ['https://a.example/api', 'https://b.example/api'];
  const PROBE = { probeRounds: 2, probeDelayMs: 0 };
  const mockEsplora = vi.mocked(esploraFetch);

  beforeEach(() => { mockEsplora.mockReset(); });

  it('derives the txid from the raw transaction bytes', () => {
    expect(TXID).toMatch(/^[0-9a-f]{64}$/);
    expect(TXID).toBe(btc.Transaction.fromRaw(hex.decode(DONATION_TX_HEX)).id);
  });

  it('returns the broadcast txid on a clean broadcast, without probing', async () => {
    mockEsplora.mockResolvedValueOnce(new Response('f'.repeat(64), { status: 200 }));
    await expect(broadcastTransactionDisambiguated(DONATION_TX_HEX, URLS, undefined, PROBE))
      .resolves.toBe('f'.repeat(64));
    expect(mockEsplora).toHaveBeenCalledTimes(1);
  });

  it('a dropped-connection broadcast that actually LANDED resolves as success via the probe', async () => {
    // The POST dies after the node accepted the tx (timeout, socket hang-up).
    // Blind-retrying here would build a second transaction and double-pay.
    mockEsplora.mockImplementation(async (_urls: string[], path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') throw new Error('socket hang up');
      if (path === `/tx/${TXID}`) return new Response('{}', { status: 200 });
      throw new Error(`unexpected path ${path}`);
    });
    await expect(broadcastTransactionDisambiguated(DONATION_TX_HEX, URLS, undefined, PROBE))
      .resolves.toBe(TXID);
  });

  it('an "already in mempool" 400 resolves as success via the probe', async () => {
    mockEsplora.mockImplementation(async (_urls: string[], path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return new Response('already in mempool', { status: 400 });
      if (path === `/tx/${TXID}`) return new Response('{}', { status: 200 });
      throw new Error(`unexpected path ${path}`);
    });
    await expect(broadcastTransactionDisambiguated(DONATION_TX_HEX, URLS, undefined, PROBE))
      .resolves.toBe(TXID);
  });

  it('a definitive rejection with the tx nowhere visible stays retry-safe failed', async () => {
    mockEsplora.mockImplementation(async (_urls: string[], path: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return new Response('bad-txns-inputs-missingorspent', { status: 400 });
      if (path === `/tx/${TXID}`) return new Response('Transaction not found', { status: 404 });
      throw new Error(`unexpected path ${path}`);
    });
    const err = await broadcastTransactionDisambiguated(DONATION_TX_HEX, URLS, undefined, PROBE).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BroadcastOutcomeUnknownError);
    expect(String(err.message)).toContain('Broadcast failed (400)');
  });

  it('broadcast failure with the probe ALSO unreachable is outcome-unknown, not retry-safe', async () => {
    mockEsplora.mockRejectedValue(new Error('network down'));
    const err = await broadcastTransactionDisambiguated(DONATION_TX_HEX, URLS, undefined, PROBE).catch((e) => e);
    expect(err).toBeInstanceOf(BroadcastOutcomeUnknownError);
    // Names the txid so the user can check before deciding, and never
    // invites a blind retry.
    expect(String(err.message)).toContain(TXID);
    expect(String(err.message)).toMatch(/do NOT retry/i);
  });
});
