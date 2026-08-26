/**
 * Wire kinds — BAO Chat Protocol v1, spec §11. These are pinned: changing a
 * kind number is a wire-format break and requires a new protocol version.
 */
/** Tier 1 ephemeral message transport (§3.1). Never stored by relays. */
export const EPHEMERAL_MESSAGE = 21045;
/** Ephemeral join request (§6). Authored by one-time burner keys. */
export const JOIN_REQUEST = 21046;
/** Scroll segment (§3.2). Parameterized-replaceable, d = bao-scroll:<scope>:<seg> — the scope is HMAC-derived, NEVER the raw roomId. */
export const SCROLL_SEGMENT = 31145;
/** Redaction list + governance state carrier (§3, §11). d = bao-redact:<room>. */
export const REDACTION_LIST = 31146;
/** Key wrap (§6). d = HMAC(welcomer_epoch_key, recipient). NIP-40 expiration. */
export const KEY_WRAP = 30078;
/** Room metadata (§7, §11). Governance-key-signed. */
export const ROOM_META = 39000;
/**
 * NIP-59 gift wrap (standard kind 1059) — shield transport (§7, P5).
 * Not a BAO-specific kind: the outer wrap envelope is standard NIP-59 so
 * any relay handles it; the shielded inner event is a normal kind-21045.
 */
export const GIFT_WRAP_KIND = 1059;
/** Founder/agent attestation (existing infra, agent admission lane). */
export const AGENT_ATTESTATION = 39998;
export function isEphemeralKind(kind) {
    return kind >= 20000 && kind <= 29999;
}
export function isAddressableKind(kind) {
    return kind >= 30000 && kind <= 39999;
}
/** d-tag prefixes. */
export const SCROLL_D_PREFIX = 'bao-scroll';
export const REDACT_D_PREFIX = 'bao-redact';
/** Room ids become d-tag path segments — colons would break parsing (L5). */
export function validateRoomId(roomId) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(roomId)) {
        throw new Error(`invalid roomId '${roomId}' — must be [a-z0-9-], no colons`);
    }
}
/**
 * d-tags use an opaque scope: HMAC(scroll-wrapper key, roomId). The roomId
 * NEVER appears on the wire (post-audit leak fix); scribes compute the scope
 * from their provisioned wrapper key, members derive it from the content key.
 */
export function scrollDTag(scope, seg) {
    return `${SCROLL_D_PREFIX}:${scope}:${seg}`;
}
export function redactDTag(scope) {
    return `${REDACT_D_PREFIX}:${scope}`;
}
export function parseScrollDTag(d) {
    const parts = d.split(':');
    if (parts.length !== 3 || parts[0] !== SCROLL_D_PREFIX)
        return null;
    const seg = Number(parts[2]);
    if (!Number.isSafeInteger(seg) || seg < 0 || String(seg) !== parts[2])
        return null;
    return { scope: parts[1], seg };
}
