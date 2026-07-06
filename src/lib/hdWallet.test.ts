import { describe, expect, it } from 'vitest';
import { HARDENED_OFFSET } from '@scure/bip32';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { nip19 } from 'nostr-tools';

import {
  BITCOIN_WALLET_PATH,
  bitcoinWalletNodeFromNsec,
  deriveAddress,
  deriveAddressRange,
  deriveChangeAddress,
  deriveReceiveAddress,
  deriveWalletSeedFromNsec,
  findNextUnusedAddressIndex,
  isChangePath,
  isReceivePath,
  legacyAddressFromNsec,
  parseBip32Path,
  pathToChainAndIndex,
  selectUtxos,
  buildTapBip32Derivation,
} from '@/lib/hdWallet';
import {
  buildUnsignedPsbtHd,
  finalizePsbt,
  signPsbtLocalHd,
  validateBitcoinAddress,
} from '@/lib/bitcoin';
import { NSecSignerBtc } from '@/lib/bitcoin-signers';

describe('hdWallet', () => {
  const nsec = 'nsec18r3zls8ssy40kgphe3lv6e64zetpug47xhd8zku9uhewpzyxlnyscq7sc0';
  const decoded = nip19.decode(nsec);
  const nsecBytes = decoded.data as Uint8Array;

  it('derives a deterministic 64-byte wallet seed from a nsec', () => {
    const seed1 = deriveWalletSeedFromNsec(nsecBytes);
    const seed2 = deriveWalletSeedFromNsec(nsecBytes);
    expect(seed1).toHaveLength(64);
    expect(seed2).toHaveLength(64);
    expect(hex.encode(seed1)).toBe(hex.encode(seed2));
  });

  it('throws on invalid nsec length', () => {
    expect(() => deriveWalletSeedFromNsec(new Uint8Array(31))).toThrow();
    expect(() => deriveWalletSeedFromNsec(new Uint8Array(33))).toThrow();
  });

  it('derives the Bitcoin wallet account node', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    expect(account.privateKey).toBeDefined();
    expect(account.publicKey).toBeDefined();
    expect(account.depth).toBe(3);
  });

  it('derives Taproot receive and change addresses', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);

    const receive0 = deriveReceiveAddress(account, 0);
    expect(receive0.address).toMatch(/^bc1p/);
    expect(receive0.chain).toBe(0);
    expect(receive0.index).toBe(0);
    expect(receive0.path).toBe(`${BITCOIN_WALLET_PATH}/0/0`);
    expect(receive0.pubkeyHex).toHaveLength(64);

    const change0 = deriveChangeAddress(account, 0);
    expect(change0.address).toMatch(/^bc1p/);
    expect(change0.chain).toBe(1);
    expect(change0.index).toBe(0);
    expect(change0.path).toBe(`${BITCOIN_WALLET_PATH}/1/0`);

    // Receive and change at the same index should differ.
    expect(receive0.address).not.toBe(change0.address);
  });

  it('derives addresses deterministically', () => {
    const account1 = bitcoinWalletNodeFromNsec(nsecBytes);
    const account2 = bitcoinWalletNodeFromNsec(nsecBytes);
    expect(deriveReceiveAddress(account1, 5).address).toBe(
      deriveReceiveAddress(account2, 5).address,
    );
  });

  it('derives a range of addresses', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const range = deriveAddressRange(account, 0, 0, 5);
    expect(range).toHaveLength(5);
    range.forEach((a, i) => {
      expect(a.index).toBe(i);
      expect(a.chain).toBe(0);
      expect(a.address).toMatch(/^bc1p/);
    });
  });

  it('finds the next unused address index', async () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);

    // Mark index 0 and 1 as used; index 2 should be returned.
    const isUsed = (address: string) => {
      const used = [
        deriveReceiveAddress(account, 0).address,
        deriveReceiveAddress(account, 1).address,
      ];
      return used.includes(address);
    };

    const next = await findNextUnusedAddressIndex(account, 0, isUsed, 0, 5);
    expect(next).toBe(2);
  });

  it('finds the next unused index across a gap', async () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);

    // Mark 0, 1, 3 used; 2 is unused but followed by used 3, so it should not
    // be chosen with gap limit 2. The first index followed by gapLimit unused
    // addresses is 4.
    const usedSet = new Set([
      deriveReceiveAddress(account, 0).address,
      deriveReceiveAddress(account, 1).address,
      deriveReceiveAddress(account, 3).address,
    ]);

    const next = await findNextUnusedAddressIndex(
      account,
      0,
      (addr) => usedSet.has(addr),
      0,
      2,
    );
    expect(next).toBe(4);
  });

  it('throws on invalid chain', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    expect(() => deriveAddress(account, 2, 0)).toThrow();
  });

  it('parses BIP-32 paths', () => {
    expect(parseBip32Path("m/86'/0'/0'/0/5")).toEqual([
      86 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0,
      5,
    ]);
    expect(parseBip32Path("86'/0'/0'/0/5")).toEqual([
      86 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0,
      5,
    ]);
  });

  it('classifies receive and change paths', () => {
    expect(isReceivePath(`${BITCOIN_WALLET_PATH}/0/0`)).toBe(true);
    expect(isReceivePath(`${BITCOIN_WALLET_PATH}/1/0`)).toBe(false);
    expect(isChangePath(`${BITCOIN_WALLET_PATH}/1/0`)).toBe(true);
    expect(isChangePath(`${BITCOIN_WALLET_PATH}/0/0`)).toBe(false);
  });

  it('extracts chain and index from path', () => {
    expect(pathToChainAndIndex(`${BITCOIN_WALLET_PATH}/0/7`)).toEqual({ chain: 0, index: 7 });
    expect(pathToChainAndIndex(`${BITCOIN_WALLET_PATH}/1/3`)).toEqual({ chain: 1, index: 3 });
    expect(() => pathToChainAndIndex("m/44'/0'/0'/0/0")).toThrow();
  });

  it('selects UTXOs without sweeping the wallet', () => {
    const utxos = [
      { txid: 'a', vout: 0, value: 1_000_000, status: { confirmed: true }, address: 'bc1p1', path: `${BITCOIN_WALLET_PATH}/0/0`, pubkeyHex: '00'.repeat(32) },
      { txid: 'b', vout: 0, value: 500_000, status: { confirmed: true }, address: 'bc1p2', path: `${BITCOIN_WALLET_PATH}/0/1`, pubkeyHex: '00'.repeat(32) },
      { txid: 'c', vout: 0, value: 100_000, status: { confirmed: true }, address: 'bc1p3', path: `${BITCOIN_WALLET_PATH}/0/2`, pubkeyHex: '00'.repeat(32) },
    ];

    const result = selectUtxos(utxos, 600_000, 10, 1);
    // Largest-first should pick the 1M sat UTXO and return change.
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].txid).toBe('a');
    expect(result.change).toBeGreaterThan(0);
  });

  it('selects multiple UTXOs when one is not enough', () => {
    const utxos = [
      { txid: 'a', vout: 0, value: 100_000, status: { confirmed: true }, address: 'bc1p1', path: `${BITCOIN_WALLET_PATH}/0/0`, pubkeyHex: '00'.repeat(32) },
      { txid: 'b', vout: 0, value: 200_000, status: { confirmed: true }, address: 'bc1p2', path: `${BITCOIN_WALLET_PATH}/0/1`, pubkeyHex: '00'.repeat(32) },
      { txid: 'c', vout: 0, value: 400_000, status: { confirmed: true }, address: 'bc1p3', path: `${BITCOIN_WALLET_PATH}/0/2`, pubkeyHex: '00'.repeat(32) },
    ];

    const result = selectUtxos(utxos, 500_000, 10, 1);
    expect(result.selected).toHaveLength(2);
    expect(result.selected.map((u) => u.txid).sort()).toEqual(['b', 'c']);
  });

  it('throws when UTXOs cannot cover the target', () => {
    const utxos = [
      { txid: 'a', vout: 0, value: 10_000, status: { confirmed: true }, address: 'bc1p1', path: `${BITCOIN_WALLET_PATH}/0/0`, pubkeyHex: '00'.repeat(32) },
    ];
    expect(() => selectUtxos(utxos, 100_000, 10, 1)).toThrow(/Insufficient funds/);
  });

  it('builds and signs an HD PSBT end-to-end', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const receive = deriveReceiveAddress(account, 0);
    const change = deriveChangeAddress(account, 0);

    // Fake a UTXO at the first receive address.
    const hdUtxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 1_000_000,
      status: { confirmed: true },
      address: receive.address,
      path: receive.path,
      pubkeyHex: receive.pubkeyHex,
    };

    const recipient = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
    expect(validateBitcoinAddress(recipient)).toBe(true);

    const { psbtHex, fee, changeAddress } = buildUnsignedPsbtHd(
      account,
      [{ address: recipient, amountSats: 100_000 }],
      [hdUtxo],
      change,
      10,
    );

    expect(psbtHex).toBeTruthy();
    expect(fee).toBeGreaterThan(0);
    expect(changeAddress).toBe(change.address);

    // Sign with the HD account node.
    const signedHex = signPsbtLocalHd(psbtHex, account);
    expect(signedHex).toBeTruthy();

    // Finalize and extract.
    const txHex = finalizePsbt(signedHex);
    expect(txHex).toMatch(/^[0-9a-f]+$/i);
  });

  it('signs an HD PSBT through NSecSignerBtc routing', async () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const receive = deriveReceiveAddress(account, 0);
    const change = deriveChangeAddress(account, 0);

    // Fake a UTXO at the first receive address.
    const hdUtxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 1_000_000,
      status: { confirmed: true },
      address: receive.address,
      path: receive.path,
      pubkeyHex: receive.pubkeyHex,
    };

    const recipient = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

    const { psbtHex } = buildUnsignedPsbtHd(
      account,
      [{ address: recipient, amountSats: 100_000 }],
      [hdUtxo],
      change,
      10,
    );

    // Sign through the signer interface — this exercises the tapBip32Derivation
    // routing that was previously broken for PSBT v0 HD PSBTs.
    const signer = new NSecSignerBtc(nsecBytes);
    const signedHex = await signer.signPsbt(psbtHex);
    expect(signedHex).toBeTruthy();

    const txHex = finalizePsbt(signedHex);
    expect(txHex).toMatch(/^[0-9a-f]+$/i);
  });

  it('derives the legacy single-address Taproot address from a nsec', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const legacy = legacyAddressFromNsec(nsecBytes);
    const receive0 = deriveReceiveAddress(account, 0);

    // Legacy address (pubkey-as-internal-key) is different from the first HD
    // receive address (BIP-86 tweaked key).
    expect(legacy).toMatch(/^bc1p/);
    expect(legacy).not.toBe(receive0.address);
  });

  it('mixes legacy and HD UTXOs in a single PSBT and signs them', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const receive = deriveReceiveAddress(account, 0);
    const change = deriveChangeAddress(account, 0);
    const legacyAddress = legacyAddressFromNsec(nsecBytes);
    const legacyPubkeyHex = hex.encode(btc.utils.pubSchnorr(nsecBytes));

    const hdUtxo = {
      txid: 'a'.repeat(64),
      vout: 0,
      value: 600_000,
      status: { confirmed: true },
      address: receive.address,
      path: receive.path,
      pubkeyHex: receive.pubkeyHex,
    };

    const legacyUtxo = {
      txid: 'b'.repeat(64),
      vout: 0,
      value: 500_000,
      status: { confirmed: true },
      address: legacyAddress,
      path: 'legacy' as const,
      pubkeyHex: legacyPubkeyHex,
    };

    const recipient = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';

    const { psbtHex, fee, changeAddress } = buildUnsignedPsbtHd(
      account,
      [{ address: recipient, amountSats: 100_000 }],
      [hdUtxo, legacyUtxo],
      change,
      10,
    );

    expect(psbtHex).toBeTruthy();
    expect(fee).toBeGreaterThan(0);
    expect(changeAddress).toBe(change.address);

    // Sign with the HD account node. The local signer should handle both the
    // HD-derived input and the legacy single-key input.
    const signedHex = signPsbtLocalHd(psbtHex, account, nsecBytes);
    expect(signedHex).toBeTruthy();

    const txHex = finalizePsbt(signedHex);
    expect(txHex).toMatch(/^[0-9a-f]+$/i);
  });

  it('builds tapBip32Derivation entries', () => {
    const account = bitcoinWalletNodeFromNsec(nsecBytes);
    const derived = deriveReceiveAddress(account, 5);
    const [pubkey, { hashes, der }] = buildTapBip32Derivation(account, derived);

    expect(hex.encode(pubkey)).toBe(derived.pubkeyHex);
    expect(hashes).toHaveLength(0);
    expect(der.path).toEqual(parseBip32Path(derived.path));
    expect(der.fingerprint).toBe(account.fingerprint);
  });
});
