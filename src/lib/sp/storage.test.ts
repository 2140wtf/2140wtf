/**
 * Tests for the BIP-352 SP UTXO storage codec.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_SP_STORAGE,
  archiveSpentUtxos,
  matchedUtxoToStored,
  mergeUtxos,
  parseSPStorage,
  pruneSpUtxos,
  serializeSPStorage,
  spStorageBalance,
  spStorageDTag,
} from './storage';
import type { SPMatchedUtxo } from './scanner';

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('spStorageDTag', () => {
  it('builds a deterministic d-tag from appId', () => {
    expect(spStorageDTag('ditto')).toBe('ditto/hdwallet/sp-utxos');
  });
});

describe('parseSPStorage', () => {
  it('parses a valid document', () => {
    const doc = parseSPStorage(
      JSON.stringify({
        version: 1,
        scanHeight: 100,
        utxos: [
          {
            txid: 'a'.repeat(64),
            vout: 0,
            value: 5000,
            height: 95,
            tweak: 'b'.repeat(64),
            k: 0,
            time: 1700000000,
          },
        ],
        spent: [{ txid: 'c'.repeat(64), vout: 1, value: 1000, height: 90, tweak: 'd'.repeat(64), k: 0 }],
      }),
    );
    expect(doc.scanHeight).toBe(100);
    expect(doc.utxos).toHaveLength(1);
    expect(doc.spent).toHaveLength(1);
  });

  it('returns empty document on invalid JSON', () => {
    const doc = parseSPStorage('not json');
    expect(doc).toEqual(EMPTY_SP_STORAGE);
  });

  it('filters malformed UTXO rows', () => {
    const doc = parseSPStorage(
      JSON.stringify({
        scanHeight: 50,
        utxos: [
          { txid: 'bad', vout: 0, value: 100, height: 10, tweak: 'cc', k: 0 },
          { txid: 'a'.repeat(64), vout: 0, value: 100, height: 10, tweak: 'b'.repeat(64), k: 0 },
        ],
      }),
    );
    expect(doc.utxos).toHaveLength(1);
    expect(doc.utxos[0].txid).toBe('a'.repeat(64));
  });
});

describe('serializeSPStorage', () => {
  it('round-trips through parseSPStorage', () => {
    const doc = {
      version: 1,
      scanHeight: 42,
      utxos: [{ txid: 'a'.repeat(64), vout: 0, value: 1234, height: 40, tweak: 'b'.repeat(64), k: 0 }],
      spent: [],
    };
    const parsed = parseSPStorage(serializeSPStorage(doc));
    expect(parsed.scanHeight).toBe(42);
    expect(parsed.utxos).toEqual(doc.utxos);
  });
});

describe('matchedUtxoToStored', () => {
  it('converts a matched UTXO to stored hex form', () => {
    const m: SPMatchedUtxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 1000,
      height: 10,
      tweak: hexToBytes('b'.repeat(64)),
      k: 0,
    };
    const stored = matchedUtxoToStored(m);
    expect(stored.tweak).toBe('b'.repeat(64));
    expect(stored.txid).toBe(m.txid);
  });
});

describe('mergeUtxos', () => {
  it('deduplicates by txid:vout', () => {
    const a = [{ txid: 'a'.repeat(64), vout: 0, value: 100, height: 1, tweak: 'b'.repeat(64), k: 0 }];
    const b = [{ txid: 'a'.repeat(64), vout: 0, value: 200, height: 1, tweak: 'c'.repeat(64), k: 0 }];
    const merged = mergeUtxos(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe(200);
  });

  it('preserves existing time when fresh entry lacks it', () => {
    const a = [
      {
        txid: 'a'.repeat(64),
        vout: 0,
        value: 100,
        height: 1,
        tweak: 'b'.repeat(64),
        k: 0,
        time: 1700000000,
      },
    ];
    const b = [{ txid: 'a'.repeat(64), vout: 0, value: 200, height: 1, tweak: 'c'.repeat(64), k: 0 }];
    const merged = mergeUtxos(a, b);
    expect(merged[0].time).toBe(1700000000);
  });
});

describe('spStorageBalance', () => {
  it('sums active UTXO values', () => {
    const doc = {
      ...EMPTY_SP_STORAGE,
      utxos: [
        { txid: 'a'.repeat(64), vout: 0, value: 1000, height: 1, tweak: 'b'.repeat(64), k: 0 },
        { txid: 'c'.repeat(64), vout: 0, value: 2000, height: 2, tweak: 'd'.repeat(64), k: 0 },
      ],
    };
    expect(spStorageBalance(doc)).toBe(3000);
  });
});

describe('pruneSpUtxos', () => {
  it('removes spent outpoints', () => {
    const utxos = [
      { txid: 'a'.repeat(64), vout: 0, value: 1000, height: 1, tweak: 'b'.repeat(64), k: 0 },
      { txid: 'c'.repeat(64), vout: 1, value: 2000, height: 2, tweak: 'd'.repeat(64), k: 0 },
    ];
    const pruned = pruneSpUtxos(utxos, [{ txid: 'a'.repeat(64), vout: 0 }]);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].txid).toBe('c'.repeat(64));
  });
});

describe('archiveSpentUtxos', () => {
  it('moves spent UTXOs to the archive', () => {
    const doc = {
      ...EMPTY_SP_STORAGE,
      utxos: [
        { txid: 'a'.repeat(64), vout: 0, value: 1000, height: 1, tweak: 'b'.repeat(64), k: 0 },
        { txid: 'c'.repeat(64), vout: 1, value: 2000, height: 2, tweak: 'd'.repeat(64), k: 0 },
      ],
    };
    const next = archiveSpentUtxos(doc, [{ txid: 'a'.repeat(64), vout: 0 }]);
    expect(next.utxos).toHaveLength(1);
    expect(next.spent).toHaveLength(1);
    expect(next.spent![0].txid).toBe('a'.repeat(64));
  });

  it('deduplicates against existing archive entries', () => {
    const doc = {
      ...EMPTY_SP_STORAGE,
      utxos: [{ txid: 'a'.repeat(64), vout: 0, value: 1000, height: 1, tweak: 'b'.repeat(64), k: 0 }],
      spent: [{ txid: 'a'.repeat(64), vout: 0, value: 1000, height: 1, tweak: 'b'.repeat(64), k: 0 }],
    };
    const next = archiveSpentUtxos(doc, [{ txid: 'a'.repeat(64), vout: 0 }]);
    expect(next.spent).toHaveLength(1);
  });
});
