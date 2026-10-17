export declare const CONCORD_HKDF_LEN = 32;
export declare const CONCORD_ZERO_ID: Uint8Array<ArrayBuffer>;
/** A.6 labels used by the adapter surfaces (extend only with the spec's table). */
export declare const CONCORD_LABEL: {
    readonly channel: "concord/channel";
    readonly controlRead: "concord/control";
    readonly controlSigner: "concord/control-signer";
    readonly guestbook: "concord/guestbook";
    readonly voiceSigner: "concord/voice-signer";
    readonly voiceMedia: "concord/voice-media";
    readonly voiceSender: "concord/voice-sender";
    readonly inviteKey: "concord/invite-key";
    readonly grant: "concord/grant";
    readonly banlist: "concord/banlist";
    readonly pins: "concord/pins";
    readonly inviteLinks: "concord/invite-links";
    readonly dissolved: "concord/dissolved";
};
export type ConcordLabel = (typeof CONCORD_LABEL)[keyof typeof CONCORD_LABEL];
/** Raw A.1 HKDF output (no normalization) - e.g. `concord/invite-key`. */
export declare function concordRawKey(label: string, secret: Uint8Array, id: Uint8Array, epoch?: number): Uint8Array;
/**
 * A.2/A.3 group key: seed → valid scalar (counter retry) → x-only pk +
 * NIP-44 self-ECDH conversation key.
 */
export declare function concordGroupKey(input: {
    label: ConcordLabel;
    secret: Uint8Array;
    id: Uint8Array;
    epoch?: number;
}): {
    sk: Uint8Array;
    pk: string;
    convKey: Uint8Array;
};
/** Coordinate labels yield the pk only (the on-wire address). */
export declare function concordCoordinate(label: ConcordLabel, secret: Uint8Array, id: Uint8Array, epoch?: number): string;
/** CORD-05 §2: `bundle_key = hkdf(token, "concord/invite-key")` (raw 32 bytes). */
export declare function concordInviteKey(token: Uint8Array): Uint8Array;
export declare function hexToConcordId(hex: string): Uint8Array;
export declare function sha256HexUtf8(value: string): string;
