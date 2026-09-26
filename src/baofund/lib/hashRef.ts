/**
 * B4 hash-reference validation (docs/ROW-B-CONTRACT-DECISIONS.md B4,
 * owner-resolved 2026-09-11; OPENBOT plan §11.1 blocker 2).
 *
 * RESOLVED CONTRACT: `bl3hex:` is the single spelling for BLAKE3 hash
 * references in 49305 ledger content and manifests. Unprefixed hex and
 * `0x`-prefixed forms are PARSE ERRORS on the validation paths - not
 * alternate spellings. Transition (per the B4 fallback): readers accept
 * legacy bare-hex values written before the writer cutover, for ONE relay
 * generation; the accept window is a versioned constant here, never
 * inferred from data.
 *
 * VERSIONED FIELD TABLE (the B4 correction applied): the prefix applies to
 * BLAKE3 DIGEST fields ONLY. Nostr IDs (event ids), pubkeys, and
 * a-coordinates are raw hex per NIP-01 and MUST NOT carry the prefix -
 * a `bl3hex:`-prefixed event id or pubkey is a parse error, never
 * silently reinterpreted. Each schema version states which fields are
 * hash-refs; unknown versions fail closed.
 */

export const HASHREF_PREFIX = 'bl3hex:' as const;

/** Legacy bare-hex acceptance window (B4 transition): readers accept
 *  pre-cutover bare hex while LEDGER_WRITER_PREFIX_MIN_SEQ is not yet
 *  reached. The writer side (buildLedgerEntry) emits `bl3hex:` from
 *  cutover seq onward; after the window the reader rejects bare hex. */
export const HASHREF_ACCEPT_LEGACY = true as const;

/** The digest a hash-ref field carries: BLAKE3, 32 bytes, 64 hex chars. */
const HEX_64 = /^[0-9a-f]{64}$/;

export class HashRefError extends Error {
  constructor(
    message: string,
    public readonly code: 'hashref_not_string' | 'hashref_missing_prefix' | 'hashref_bad_hex' | 'hashref_forbidden_prefix' | 'hashref_unknown_version',
  ) {
    super(message);
    this.name = 'HashRefError';
  }
}

/** Parse a BLAKE3 hash reference. Strict `bl3hex:` when `legacy` is false;
 *  with `legacy` true (transition window only) a bare 64-hex value is
 *  accepted and flagged via `legacyAccepted` - never 0x-prefixed. */
export function parseHashRef(
  value: unknown,
  field: string,
  opts: { legacy?: boolean } = {},
): { hex: string; legacyAccepted: boolean } {
  if (typeof value !== 'string') {
    throw new HashRefError(`${field} must be a bl3hex: string`, 'hashref_not_string');
  }
  if (value.startsWith(HASHREF_PREFIX)) {
    const hex = value.slice(HASHREF_PREFIX.length);
    if (!HEX_64.test(hex)) {
      throw new HashRefError(`${field} has bl3hex: prefix but is not 64 lowercase hex`, 'hashref_bad_hex');
    }
    return { hex, legacyAccepted: false };
  }
  if (value.startsWith('0x')) {
    throw new HashRefError(`${field} must use the bl3hex: prefix (0x is a parse error, not an alternate spelling)`, 'hashref_missing_prefix');
  }
  if (HEX_64.test(value)) {
    if (opts.legacy && HASHREF_ACCEPT_LEGACY) {
      return { hex: value, legacyAccepted: true };
    }
    throw new HashRefError(`${field} must use the bl3hex: prefix (bare hex is a parse error)`, 'hashref_missing_prefix');
  }
  throw new HashRefError(`${field} is neither bl3hex:<64hex> nor (transition window) bare 64-hex`, 'hashref_bad_hex');
}

/** Nostr ID/pubkey guard: these are RAW 64-hex per NIP-01 - the bl3hex:
 *  prefix is FORBIDDEN here (the B4 correction: never apply it to Nostr
 *  IDs or pubkeys, never reinterpret old proofs). */
export function parseNostrHex(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HashRefError(`${field} must be a raw 64-hex Nostr id/pubkey`, 'hashref_not_string');
  }
  if (value.startsWith(HASHREF_PREFIX)) {
    throw new HashRefError(`${field} is a Nostr id/pubkey - the bl3hex: prefix is forbidden on it`, 'hashref_forbidden_prefix');
  }
  if (!HEX_64.test(value)) {
    throw new HashRefError(`${field} must be raw 64-hex (no prefix)`, 'hashref_bad_hex');
  }
  return value;
}

/**
 * The B4 field/version table: schema version → field → kind.
 *   'hashref'      - BLAKE3 digest, `bl3hex:` (legacy hex in the window)
 *   'nostr-hex'    - raw event id / pubkey, prefix FORBIDDEN
 *   'a-coordinate' - kind:pubkey:slug reference, prefix FORBIDDEN
 * Unknown schema version → fail closed (hashref_unknown_version).
 */
export type HashRefFieldKind = 'hashref' | 'nostr-hex' | 'a-coordinate';
export const HASHREF_FIELD_TABLE: Readonly<Record<number, Readonly<Record<string, HashRefFieldKind>>>> = {
  // Ledger content v1 (current writer emitted bare hex pre-cutover):
  1: Object.freeze({
    proofSetHash: 'hashref',
    nullifierRoot: 'hashref',
    prevHash: 'hashref',
    'verdict.hash': 'hashref',
    // Never prefixed (B4 correction):
    'verdict.id': 'nostr-hex',
    campaign: 'a-coordinate',
  }),
} as const;

/** Validate one field of a schema-versioned document against the table. */
export function validateHashRefField(
  schemaVersion: number,
  field: string,
  value: unknown,
  opts: { legacy?: boolean } = {},
): { hex: string; legacyAccepted: boolean } {
  const table = HASHREF_FIELD_TABLE[schemaVersion];
  if (!table) {
    throw new HashRefError(`no hash-ref field table for schema v${schemaVersion} - fail closed`, 'hashref_unknown_version');
  }
  const kind = table[field];
  if (!kind) return { hex: typeof value === 'string' ? value : '', legacyAccepted: false }; // not a hash-ref field
  if (kind === 'hashref') return parseHashRef(value, field, opts);
  if (kind === 'nostr-hex') return { hex: parseNostrHex(value, field), legacyAccepted: false };
  // a-coordinate: kind:pubkey:slug - prefix forbidden, shape checked by callers.
  if (typeof value !== 'string' || value.startsWith(HASHREF_PREFIX)) {
    throw new HashRefError(`${field} is an a-coordinate - the bl3hex: prefix is forbidden`, 'hashref_forbidden_prefix');
  }
  return { hex: value, legacyAccepted: false };
}

/** Writer side: emit the canonical spelling. */
export function hashRef(blake3Hex: string): string {
  if (!HEX_64.test(blake3Hex)) throw new HashRefError('hashRef() needs 64 lowercase hex', 'hashref_bad_hex');
  return `${HASHREF_PREFIX}${blake3Hex}`;
}
