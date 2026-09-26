/**
 * liquid-testnet rail - step 1 of the second settlement adapter (sibling of
 * docs/TESTNET4-RAIL-DESIGN.md §6.1). Rail identity, address validation and
 * the typed cross-network rejection rules for the LIQUID TESTNET chain -
 * an ELEMENTS sidechain: same segwit/taproot script semantics as bitcoin
 * (so the Testnet4 tapscript/taptree builders are reused verbatim), but a
 * DIFFERENT asset, different address namespace and a federation instead of
 * PoW.
 *
 * §6.1 hard rule (design, carried over): testnet4 and liquid-testnet
 * balances are separate assets and network namespaces; adapters must reject
 * cross-network addresses, invoices and transaction IDs.
 *
 * Chain facts (provenance):
 *  - HRP `tex` (unblinded) / `tlq` (blinded) - Elements master
 *    src/kernel/chainparams.cpp, CLiquidTestNetParams (bech32_hrp = "tex",
 *    blech32_hrp = "tlq"). ~60s blocks, default port 18891.
 *  - Genesis hash pinned from the LIVE Esplora API
 *    (blockstream.info/liquidtestnet/api/block-height/0, 2026-09-13). The
 *    Elements source computes it at runtime (SetGenesisBlock), so the live
 *    pin IS the authoritative evidence for the probe layer.
 *  - Native LBTC asset id read from the live chain (fee/issuance outputs of
 *    fresh blocks carry it): 144c6543…19a49.
 *
 * Fail-closed decisions:
 *  - ONLY unblinded `tex` addresses are accepted. Confidential (blinded)
 *    forms are REJECTED with a dedicated code - blinding support is a
 *    later, explicitly-designed feature, never a silent reinterpretation.
 *  - Liquid mainnet prefixes (`ex`/`lq`) are cross_network_rejected -
 *    same asset family, WRONG chain.
 *  - Bitcoin prefixes (`tb`/`bc`/`bcrt`) are wrong_network - the exact
 *    namespace the first rail owns.
 *
 * Pure module: no network I/O, no clock. Typed errors only, machine-readable
 * codes, decode via @scure/base (audited) - no reimplementation.
 */
import { bech32, bech32m } from '@scure/base';

/** Chain-evidence anchor for the probe layer. Fetched live 2026-09-13 (see header). */
export const LIQUID_TESTNET_GENESIS_HASH =
  'a771da8e52ee6ad581ed1e9a99825e5b3b7992225534eaa2ae23244fe26ab1c1' as const;

/** Native LBTC asset id on liquid testnet (live chain evidence, 2026-09-13). */
export const LIQUID_TESTNET_NATIVE_ASSET_ID =
  '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49' as const;

/** Default public Esplora/probe base. Override-able via config when a sovereign node lands. */
const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Probe base. Override with `VITE_LIQUID_TESTNET_ESPLORA_URL` to point at a
 *  self-hosted Elements/electrs; the genesis pin is enforced either way. */
export const LIQUID_TESTNET_ESPLORA_BASE: string =
  VITE_ENV.VITE_LIQUID_TESTNET_ESPLORA_URL ?? 'https://blockstream.info/liquidtestnet/api';

/** The rail identifier registered beside `btc-testnet4` in the rail tables. */
export const LIQUID_TESTNET_RAIL = 'liquid-testnet' as const;

/** The only accepted HRP: unblinded liquid-testnet addresses. */
export const LIQUID_TESTNET_HRP = 'tex' as const;

export type LiquidTestnetRailErrorCode =
  | 'malformed_address'
  | 'wrong_network'
  | 'cross_network_rejected'
  | 'confidential_rejected'
  | 'malformed_txid';

export class LiquidTestnetRailError extends Error {
  readonly code: LiquidTestnetRailErrorCode;
  readonly detail: string;

  constructor(code: LiquidTestnetRailErrorCode, detail: string) {
    super(`liquid-testnet rail: ${code}: ${detail}`);
    this.name = 'LiquidTestnetRailError';
    this.code = code;
    this.detail = detail;
  }
}

/** Liquid mainnet (ex/lq) - same family, different chain. */
const LIQUID_MAINNET_PREFIXES = new Set(['ex', 'lq']);
/** Blinded liquid-TESTNET form - right chain, unsupported (fail closed). */
const BLINDED_TESTNET_PREFIX = 'tlq';
/** Bitcoin namespaces - owned by the btc-testnet4/bc rails. */
const BITCOIN_PREFIXES = new Set(['tb', 'bc', 'bcrt']);

interface WitnessProgram {
  version: number;
  program: Uint8Array;
}

function decodeWitnessProgram(address: string): WitnessProgram {
  if (typeof address !== 'string' || address.length === 0 || address.length > 90) {
    throw new LiquidTestnetRailError('malformed_address', 'address missing or longer than 90 chars');
  }
  const hasUpper = /[A-Z]/.test(address);
  const hasLower = /[a-z]/.test(address);
  if (hasUpper && hasLower) {
    throw new LiquidTestnetRailError('malformed_address', 'mixed-case address');
  }
  const normalized = address.toLowerCase();

  const sep = normalized.lastIndexOf('1');
  if (sep < 1) throw new LiquidTestnetRailError('malformed_address', 'missing HRP separator');
  const prefix = normalized.slice(0, sep);

  if (prefix === BLINDED_TESTNET_PREFIX) {
    throw new LiquidTestnetRailError(
      'confidential_rejected',
      `blinded (confidential) address '${prefix}1…' - unblinded tex addresses only; blinding is a separate feature`,
    );
  }
  if (LIQUID_MAINNET_PREFIXES.has(prefix)) {
    throw new LiquidTestnetRailError(
      'cross_network_rejected',
      `liquid MAINNET prefix '${prefix}' - separate chain from liquid-testnet, never interchangeable`,
    );
  }
  if (BITCOIN_PREFIXES.has(prefix)) {
    throw new LiquidTestnetRailError(
      'wrong_network',
      `bitcoin address ('${prefix}' prefix) on a liquid-testnet rail - separate asset chain`,
    );
  }
  if (prefix !== LIQUID_TESTNET_HRP) {
    throw new LiquidTestnetRailError('malformed_address', `unknown prefix '${prefix}'`);
  }

  const dataPart = normalized.slice(sep + 1);
  if (dataPart.length < 7) {
    throw new LiquidTestnetRailError('malformed_address', 'data section too short for checksum+witness');
  }

  let words: number[];
  try {
    try {
      words = Array.from(bech32.decode(normalized).words);
    } catch (err) {
      if (err instanceof LiquidTestnetRailError) throw err;
      words = Array.from(bech32m.decode(normalized).words);
    }
  } catch (err) {
    if (err instanceof LiquidTestnetRailError) throw err;
    throw new LiquidTestnetRailError(
      'malformed_address',
      `checksum or structure invalid (${err instanceof Error ? err.message : 'unknown'})`,
    );
  }
  return checkProgram(words);

  function checkProgram(words: number[]): WitnessProgram {
    const spec = words[0];
    if (spec === undefined || spec < 0 || spec > 16) {
      throw new LiquidTestnetRailError('malformed_address', `witness version ${spec} out of range`);
    }
    const program5 = words.slice(1);
    let program: Uint8Array;
    try {
      program = bech32m.fromWords(program5);
    } catch (err) {
      throw new LiquidTestnetRailError(
        'malformed_address',
        `witness program padding invalid (${err instanceof Error ? err.message : 'unknown'})`,
      );
    }
    if (program.length < 2 || program.length > 40) {
      throw new LiquidTestnetRailError('malformed_address', `witness program length ${program.length} outside 2–40`);
    }
    if (spec === 0 && program.length !== 20 && program.length !== 32) {
      throw new LiquidTestnetRailError('malformed_address', `v0 program length ${program.length} (must be 20 or 32)`);
    }
    return { version: spec, program };
  }
}

/**
 * Validate a liquid-testnet deposit/withdrawal address (unblinded only).
 * Returns the parsed witness program so callers can build script
 * descriptors with the SHARED taproot builders without re-decoding.
 */
export function validateLiquidTestnetAddress(address: string): { version: number; programBytes: Uint8Array } {
  const { version, program } = decodeWitnessProgram(address);
  return { version, programBytes: program };
}

/**
 * Validate a transaction id for the liquid-testnet probe. Same 64-hex
 * lowercase shape as bitcoin; chain identity is proven at the probe layer
 * against LIQUID_TESTNET_ESPLORA_BASE with the genesis pin, never by the
 * string alone.
 */
export function validateLiquidTestnetTxid(txid: string): string {
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
    throw new LiquidTestnetRailError(
      'malformed_txid',
      'txid must be exactly 64 lowercase hex characters',
    );
  }
  return txid;
}

/** Rail gate used by the settlement allowlist: is this the liquid-testnet rail? */
export function isLiquidTestnetRail(rail: string): boolean {
  return rail === LIQUID_TESTNET_RAIL;
}

// ── Frontend surface (mirrors testnet4Rail step-5 exports) ──────────────────

/** Explorer SITE base (not the API base) - pledge-modal links. Override with
 *  `VITE_LIQUID_TESTNET_EXPLORER_URL` to send users to your own explorer. */
export const LIQUID_TESTNET_EXPLORER_BASE: string =
  VITE_ENV.VITE_LIQUID_TESTNET_EXPLORER_URL ?? 'https://blockstream.info/liquidtestnet';

/** Explorer link for a payment transaction. Validates the txid first. */
export function liquidTestnetExplorerTxUrl(txid: string): string {
  return `${LIQUID_TESTNET_EXPLORER_BASE}/tx/${validateLiquidTestnetTxid(txid)}`;
}

/** Explorer link for an escrow address. Validates the address first. */
export function liquidTestnetExplorerAddressUrl(address: string): string {
  validateLiquidTestnetAddress(address);
  return `${LIQUID_TESTNET_EXPLORER_BASE}/address/${address}`;
}

/** The rail badge text - visible on every liquid-testnet surface, never styled like mainnet. */
export const LIQUID_TESTNET_NO_VALUE_BADGE = 'LIQUID TESTNET · NO VALUE' as const;

/**
 * Frontend mirror of the settlement gate's future `BAO_LQ_ENABLED` flag:
 * the pledge option only APPEARS when the deployment enables the rail.
 * Fail closed until the gate wiring step lands - this flag does not exist
 * yet, so this returns false in every deployment today.
 */
export function isLiquidTestnetRailEnabled(): boolean {
  return (import.meta.env.VITE_BAO_LQ_ENABLED as string | undefined) === '1';
}
