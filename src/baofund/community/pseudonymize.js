/**
 * pseudonymize — keyed hashing + secret redaction for LOGS and local
 * bookkeeping (plan-unified-hardening-adoption P2).
 *
 * DELIBERATELY NOT in redaction.ts: that module owns wire fold/dedup
 * semantics whose merge keys must stay deterministic across clients; salted
 * digests must never be one import away from those code paths.
 *
 * Construction (expert-review v3):
 *   pseudonym = HMAC-SHA256(pepper, len‖domain‖ len‖store_id‖ len‖value)
 * with u32 big-endian length prefixes on every field — concatenation
 * ambiguity ("a"+"bc" vs "ab"+"c") is structurally impossible.
 *
 * Threat model: log files and bookkeeping jsonl are assumed exfiltratable.
 *   - pepper  : deployment-wide SECRET (0600 beside the masters). Without
 *               it, digests cannot be brute-forced or linked anywhere else.
 *   - store_id: NON-secret random 16 bytes PERSISTED with the store. It
 *               makes same-value entries in different stores unlinkable.
 *               Regenerating it per boot breaks crash-recovery correlation
 *               — persist once, rotate only with the store itself.
 *   - Rotation: a new pepper starts a new pseudonym space; old lines stay
 *     under the old pepper. Cross-rotation joins require archiving the old
 *     pepper offline — documented operational cost, chosen deliberately.
 */
import { hmacSha256, bytesToHex, utf8ToBytes } from './crypto.js';
export const LOGHASH_DOMAIN = 'bao/loghash/v1';
function lenPrefixed(field) {
    const bytes = typeof field === 'string' ? utf8ToBytes(field) : field;
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bytes.length, false);
    out.set(bytes, 4);
    return out;
}
/** Deterministic keyed pseudonym for one value inside one store. */
export function pseudonymize(pepper, storeId, value) {
    return bytesToHex(hmacSha256(pepper, lenPrefixed(LOGHASH_DOMAIN), lenPrefixed(storeId), lenPrefixed(value)));
}
const SECRET_PATTERNS = [
    [/\bnsec1[0-9a-z]{20,}/g, 'nsec'],
    [/\bbearer\s+[A-Za-z0-9._~+/-]{16,}/gi, 'bearer'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'keyblock'],
];
/**
 * Neutralize obvious secret material in free text destined for logs.
 * Keyword-adjacent 64-hex literals (secretKey="…") are scrubbed; bare hex
 * in ordinary prose is left alone — redaction here must not destroy logs'
 * usefulness, only their ability to leak credentials.
 */
export function redactSecrets(text) {
    let out = text;
    for (const [re, tag] of SECRET_PATTERNS)
        out = out.replace(re, `[REDACTED:${tag}]`);
    out = out.replace(/((?:secret|private|master|seed)[A-Za-z]*\s*[:=]\s*['"])([0-9a-fx]{64})(['"])/gi, (_m, pre, _hex, post) => `${pre}[REDACTED:hex64]${post}`);
    return out;
}
/** Convenience: redact then hash — the shape daemons use per log line. */
export function hashAndRedact(pepper, storeId, value) {
    return pseudonymize(pepper, storeId, redactSecrets(value));
}
