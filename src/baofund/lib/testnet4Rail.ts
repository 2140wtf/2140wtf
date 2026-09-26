/**
 * btc-testnet4 rail - step 1 of docs/TESTNET4-RAIL-DESIGN.md (§6.1): rail
 * identity, address validation and the typed cross-network rejection rules.
 *
 * §6.1 hard rule: "Bitcoin Testnet4 and Liquid Testnet balances are separate
 * assets and network namespaces; adapters must reject cross-network
 * addresses, invoices and transaction IDs."
 *
 * Design decisions (TESTNET4-RAIL-DESIGN.md §2):
 *  - HRP `tb` + witness program (v0/v1) is the address-level gate; mainnet
 *    `bc`, regtest `bcrt` and Liquid HRPs fail typed.
 *  - Honest limit: the `tb` prefix is SHARED by several test networks - the address
 *    alone cannot distinguish them. Chain identity is pinned at the probe
 *    layer (step 3) via the testnet4 genesis hash below; never at address
 *    parse time.
 *  - Segwit encoding rules enforced per BIP-173/350: v0 requires the bech32
 *    constant and a 20- or 32-byte program; v1+ requires the bech32m
 *    constant and a 2–40 byte program.
 *  - Decode uses @scure/base (audited, already in the dependency tree) -
 *    NOT a reimplementation. The Liquid-side bech32 in vendored code is
 *    Elements-scoped and stays there.
 *
 * Pure module: no network I/O, no clock. Errors are typed, never thrown
 * strings, and every rejection names a machine-readable code so the UI and
 * the gateway audit can classify without string-matching.
 */
import { bech32, bech32m } from '@scure/base';

/** Chain-evidence anchor (TESTNET4-RAIL-DESIGN.md §2). Fetched from the live Esplora API 2026-09-12. */
export const BTC_TESTNET4_GENESIS_HASH =
  '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043' as const;

const VITE_ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Probe base. Defaults to the public explorer (owner call 4, §7); point
 *  `VITE_TESTNET4_ESPLORA_URL` at your own electrs/Esplora to drop the
 *  third-party dependency. The genesis-hash pin is enforced either way. */
export const TESTNET4_ESPLORA_BASE: string =
  VITE_ENV.VITE_TESTNET4_ESPLORA_URL ?? 'https://mempool.space/testnet4/api';

/** The rail identifier registered in `BAO_RAILS` (frontend) and the settlement gate allowlist. */
export const BTC_TESTNET4_RAIL = 'btc-testnet4' as const;

export type Testnet4RailErrorCode =
  | 'malformed_address'
  | 'wrong_network'
  | 'cross_network_rejected'
  | 'malformed_txid';

export class Testnet4RailError extends Error {
  readonly code: Testnet4RailErrorCode;
  readonly detail: string;

  constructor(code: Testnet4RailErrorCode, detail: string) {
    super(`testnet4 rail: ${code}: ${detail}`);
    this.name = 'Testnet4RailError';
    this.code = code;
    this.detail = detail;
  }
}

const LEGACY_TESTNET_PREFIX = 'tb'; // shared across test networks - see honest limit above
const MAINNET_PREFIX = 'bc';
const REGTEST_PREFIX = 'bcrt';
/** Liquid/Elements address prefixes - a DIFFERENT asset chain, not "wrong bitcoin net". */
const LIQUID_PREFIXES = new Set(['ex', 'lq', 'tex', 'tq']);

interface WitnessProgram {
  version: number;
  program: Uint8Array;
}

/**
 * Decode a bech32/bech32m segwit address to its witness program, enforcing
 * BIP-173/350 version/constant/length rules. Throws Testnet4RailError with
 * code `wrong_network` for other networks' prefixes and `cross_network_
 * rejected` for Liquid; checksum/length/charset problems are
 * `malformed_address`.
 */
function decodeWitnessProgram(address: string): WitnessProgram {
  if (typeof address !== 'string' || address.length === 0 || address.length > 90) {
    throw new Testnet4RailError('malformed_address', 'address missing or longer than 90 chars');
  }
  // BIP-173: mixed case is invalid; all-lowercase and ALL-UPPERCASE are both
  // valid forms. Reject only the mixed form, then normalize.
  const hasUpper = /[A-Z]/.test(address);
  const hasLower = /[a-z]/.test(address);
  if (hasUpper && hasLower) {
    throw new Testnet4RailError('malformed_address', 'mixed-case address');
  }
  const normalized = address.toLowerCase();

  // Split on the LAST separator so address data cannot contain '1'.
  const sep = normalized.lastIndexOf('1');
  if (sep < 1) throw new Testnet4RailError('malformed_address', 'missing HRP separator');
  const prefix = normalized.slice(0, sep);

  if (LIQUID_PREFIXES.has(prefix)) {
    throw new Testnet4RailError(
      'cross_network_rejected',
      `liquid/elements address prefix '${prefix}' - separate asset chain, never interchangeable`,
    );
  }
  if (prefix === MAINNET_PREFIX) {
    throw new Testnet4RailError('wrong_network', 'mainnet (bc1…) address on a testnet4 rail');
  }
  if (prefix === REGTEST_PREFIX) {
    throw new Testnet4RailError('wrong_network', 'regtest (bcrt1…) address on a testnet4 rail');
  }
  if (prefix !== LEGACY_TESTNET_PREFIX) {
    throw new Testnet4RailError('malformed_address', `unknown prefix '${prefix}'`);
  }

  const dataPart = normalized.slice(sep + 1);
  if (dataPart.length < 7) {
    throw new Testnet4RailError('malformed_address', 'data section too short for checksum+witness');
  }

  let words: number[];
  try {
    // Both codecs verify checksum, charset and the 90-char limit themselves;
    // try bech32 then bech32m because the witness VERSION decides the
    // constant, and we must not trust the address to have used the right one.
    try {
      words = Array.from(bech32.decode(normalized).words);
    } catch (err) {
      if (err instanceof Testnet4RailError) throw err;
      words = Array.from(bech32m.decode(normalized).words);
    }
  } catch (err) {
    if (err instanceof Testnet4RailError) throw err;
    throw new Testnet4RailError(
      'malformed_address',
      `checksum or structure invalid (${err instanceof Error ? err.message : 'unknown'})`,
    );
  }
  return checkProgram(words);

  function checkProgram(words: number[]): WitnessProgram {
    const spec = words[0];
    if (spec === undefined || spec < 0 || spec > 16) {
      throw new Testnet4RailError('malformed_address', `witness version ${spec} out of range`);
    }
    const program5 = words.slice(1);
    let program: Uint8Array;
    try {
      // @scure/base v2: fromWords takes a plain number[] IN, returns Uint8Array.
      program = bech32m.fromWords(program5);
    } catch (err) {
      throw new Testnet4RailError(
        'malformed_address',
        `witness program padding invalid (${err instanceof Error ? err.message : 'unknown'})`,
      );
    }
    if (program.length < 2 || program.length > 40) {
      throw new Testnet4RailError('malformed_address', `witness program length ${program.length} outside 2–40`);
    }
    if (spec === 0 && program.length !== 20 && program.length !== 32) {
      throw new Testnet4RailError('malformed_address', `v0 program length ${program.length} (must be 20 or 32)`);
    }
    return { version: spec, program };
  }
}

/**
 * Validate a testnet4 deposit/withdrawal address. Returns the parsed
 * witness program on success so callers can build script descriptors
 * (design §3) without re-decoding.
 */
export function validateTestnet4Address(address: string): { version: number; programBytes: Uint8Array } {
  const { version, program } = decodeWitnessProgram(address);
  return { version, programBytes: program };
}

/**
 * Validate a transaction id for use with the testnet4 probe. Txids are a
 * per-chain namespace (§6.1): we only check shape here - chain identity is
 * proven by the probe against TESTNET4_ESPLORA_BASE with the genesis pin,
 * never by the string.
 */
export function validateTestnet4Txid(txid: string): string {
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
    // Uppercase is common from some wallets; reject rather than silently
    // canonicalize - callers normalize explicitly (§6.1 fail-closed taste).
    throw new Testnet4RailError(
      'malformed_txid',
      'txid must be exactly 64 lowercase hex characters',
    );
  }
  return txid;
}

/** Rail gate used by the settlement allowlist: is this rail the testnet4 rail? */
export function isTestnet4Rail(rail: string): boolean {
  return rail === BTC_TESTNET4_RAIL;
}

// ── Frontend surface (design §6 step 5) ─────────────────────────────────────

/** Explorer SITE base (not the API base) - pledge-modal links. Override with
 *  `VITE_TESTNET4_EXPLORER_URL` to send users to your own explorer. */
export const TESTNET4_EXPLORER_BASE: string =
  VITE_ENV.VITE_TESTNET4_EXPLORER_URL ?? 'https://mempool.space/testnet4';

/** Public testnet4 faucet. mempool.space's faucet is captcha-gated; this is
 *  the captcha-free public one users are pointed at. */
export const TESTNET4_FAUCET_URL = 'https://coinfaucet.eu/en/btc-testnet4/';

/** Explorer link for a deposit/payment transaction. Validates the txid first. */
export function testnet4ExplorerTxUrl(txid: string): string {
  return `${TESTNET4_EXPLORER_BASE}/tx/${validateTestnet4Txid(txid)}`;
}

/** Explorer link for an escrow address. Validates the address first. */
export function testnet4ExplorerAddressUrl(address: string): string {
  validateTestnet4Address(address);
  return `${TESTNET4_EXPLORER_BASE}/address/${address}`;
}

/** The rail badge text - visible on every testnet4 surface, never styled like mainnet. */
export const TESTNET4_NO_VALUE_BADGE = 'TESTNET4 · NO VALUE' as const;

/**
 * Frontend mirror of the settlement gate's `BAO_T4_ENABLED` (design §4): the
 * pledge option only APPEARS when the deployment enables the rail. Read per
 * call, never cached at import - tests stub the env per test.
 */
export function isTestnet4RailEnabled(): boolean {
  return (import.meta.env.VITE_BAO_T4_ENABLED as string | undefined) === '1';
}
