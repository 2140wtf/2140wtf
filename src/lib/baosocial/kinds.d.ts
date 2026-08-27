/**
 * Wire kinds — BAO Chat Protocol v1, spec §11. These are pinned: changing a
 * kind number is a wire-format break and requires a new protocol version.
 */
/** Tier 1 ephemeral message transport (§3.1). Never stored by relays. */
export declare const EPHEMERAL_MESSAGE = 21045;
/** Ephemeral join request (§6). Authored by one-time burner keys. */
export declare const JOIN_REQUEST = 21046;
/** Scroll segment (§3.2). Parameterized-replaceable, d = bao-scroll:<scope>:<seg> — the scope is HMAC-derived, NEVER the raw roomId. */
export declare const SCROLL_SEGMENT = 31145;
/** Redaction list + governance state carrier (§3, §11). d = bao-redact:<room>. */
export declare const REDACTION_LIST = 31146;
/** Key wrap (§6). d = HMAC(welcomer_epoch_key, recipient). NIP-40 expiration. */
export declare const KEY_WRAP = 30078;
/** Room metadata (§7, §11). Governance-key-signed. */
export declare const ROOM_META = 39000;
/**
 * NIP-59 gift wrap (standard kind 1059) — shield transport (§7, P5).
 * Not a BAO-specific kind: the outer wrap envelope is standard NIP-59 so
 * any relay handles it; the shielded inner event is a normal kind-21045.
 */
export declare const GIFT_WRAP_KIND = 1059;
export type GiftWrapKind = typeof GIFT_WRAP_KIND;
/** Founder/agent attestation (existing infra, agent admission lane). */
export declare const AGENT_ATTESTATION = 39998;
export declare function isEphemeralKind(kind: number): boolean;
export declare function isAddressableKind(kind: number): boolean;
/** d-tag prefixes. */
export declare const SCROLL_D_PREFIX = "bao-scroll";
export declare const REDACT_D_PREFIX = "bao-redact";
/** Room ids become d-tag path segments — colons would break parsing (L5). */
export declare function validateRoomId(roomId: string): void;
/**
 * d-tags use an opaque scope: HMAC(scroll-wrapper key, roomId). The roomId
 * NEVER appears on the wire (post-audit leak fix); scribes compute the scope
 * from their provisioned wrapper key, members derive it from the content key.
 */
export declare function scrollDTag(scope: string, seg: number): string;
export declare function redactDTag(scope: string): string;
export declare function parseScrollDTag(d: string): {
    scope: string;
    seg: number;
} | null;
