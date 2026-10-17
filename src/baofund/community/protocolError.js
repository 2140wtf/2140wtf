/**
 * ProtocolError — typed protocol/derivation failures for the browser-safe
 * voice core and the CORD derivation authority. Mirrors the fund repo's
 * `ProtocolError(code, message)` shape.
 */
export class ProtocolError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ProtocolError';
    }
}
