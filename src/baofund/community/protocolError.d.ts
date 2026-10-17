/**
 * ProtocolError — typed protocol/derivation failures for the browser-safe
 * voice core and the CORD derivation authority. Mirrors the fund repo's
 * `ProtocolError(code, message)` shape.
 */
export declare class ProtocolError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
