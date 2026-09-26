export declare const LOGHASH_DOMAIN = "bao/loghash/v1";
/** Deterministic keyed pseudonym for one value inside one store. */
export declare function pseudonymize(pepper: Uint8Array, storeId: string, value: string): string;
/**
 * Neutralize obvious secret material in free text destined for logs.
 * Keyword-adjacent 64-hex literals (secretKey="…") are scrubbed; bare hex
 * in ordinary prose is left alone — redaction here must not destroy logs'
 * usefulness, only their ability to leak credentials.
 */
export declare function redactSecrets(text: string): string;
/** Convenience: redact then hash — the shape daemons use per log line. */
export declare function hashAndRedact(pepper: Uint8Array, storeId: string, value: string): string;
