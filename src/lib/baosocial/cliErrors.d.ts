/**
 * Exit-contract v2 (P6a) — machine-classifiable CLI failures.
 *
 * 0 ok · 1 error · 2 timeout/no-result · 3 LINK_* (never retry; echo to
 * issuer) · 4 ADMISSION/DELIVERY retryable once. The final stderr line of a
 * failed run is always `error_code=<TOKEN>` so non-human loops can branch
 * without parsing prose.
 */
export interface ClassifiedError {
    code: 1 | 3 | 4;
    token: 'ERROR' | 'LINK_INVALID' | 'LINK_EXHAUSTED' | 'ADMISSION_UNREACHABLE' | 'DUPLICATE_POST';
}
/** Order matters: retryable-admission beats link-shape when both could match. */
export declare function classifyCliError(message: string): ClassifiedError;
