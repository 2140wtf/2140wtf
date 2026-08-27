/**
 * Tier-2 helpers — spec §11 (rotating g labels) + §6 (P2 wrap d-tag
 * migration for shipped legacy wraps).
 *
 * Tier 2 rooms (kinds 11/12, NIP-44 v2 to the room key) tag messages with
 * a rotating `g` label: HMAC(label_k, roomId), rotated per epoch — the
 * relay cannot link a room's Tier-2 traffic across epochs (spec §11).
 * The label key comes from the epoch chain (crypto.ts rotatingLabel).
 *
 * Legacy migration (spec §6): shipped P1 Tier-2 wraps use d-tags of the
 * form `bao-group-key:<roomId>:<recipient>` — they leak the room id AND
 * the member pubkey on the relay. P2 migrates them to the opaque
 * deterministic scheme (wrapDTag in welcomer.ts): same recipient gets the
 * new address; the old address is abandoned (and its NIP-40 expiration
 * lapses).
 */
import { utf8ToBytes, hexToBytes } from './crypto.js';
import { rotatingLabel } from './crypto.js';
import { wrapDTag } from './welcomer-core.js';
// ─── Rotating g labels (kinds 11/12) ───────────────────────────────────────
/**
 * The `g` tag value for a Tier-2 message at a given epoch:
 * HMAC(label_k(epoch), roomId). Pure — the caller derives label_k from the
 * epoch chain (deriveEpochKeys(chainKey, epoch).labelKey).
 */
export function tier2GTag(labelKey, roomId) {
    return rotatingLabel(labelKey, roomId);
}
/**
 * Build the full tag list for a Tier-2 room message (kind 11/12):
 * rotating g label + NIP-70 advisory. Explicitly NON-interop with NIP-29
 * (which mandates `h`) — app-only readership, by design (spec §11).
 */
export function tier2MessageTags(labelKey, roomId, extraTags = []) {
    return [['g', tier2GTag(labelKey, roomId)], ['-'], ...extraTags];
}
/**
 * Subscription filter helper: the `#g` filter value a member uses to read
 * a Tier-2 room at a given epoch. Clients retain the previous epoch's
 * label during roll-over grace (same window as Tier 1, envelope.ts).
 */
export function tier2ReadFilter(labelKey, roomId) {
    return { '#g': [tier2GTag(labelKey, roomId)] };
}
// ─── Legacy wrap d-tag migration (spec §6 P2) ─────────────────────────────
/** Legacy (P1, shipped) Tier-2 wrap d-tag form. Leaks roomId + recipient. */
export const LEGACY_WRAP_D_PREFIX = 'bao-group-key';
/**
 * Detect a legacy wrap d-tag: `bao-group-key:<roomId>:<recipientPub>`.
 * Returns the leaked parts, or null for non-legacy tags.
 */
export function parseLegacyWrapDTag(d) {
    const parts = d.split(':');
    if (parts.length !== 3 || parts[0] !== LEGACY_WRAP_D_PREFIX)
        return null;
    const [, roomId, recipient] = parts;
    if (!roomId || !/^[0-9a-f]{64}$/.test(recipient))
        return null;
    return { roomId, recipient };
}
/**
 * Compute the P2 opaque replacement for a legacy wrap address. Pure
 * mapping: legacy `bao-group-key:<roomId>:<recipient>` →
 * HMAC(welcomer_epoch_key, roomId ‖ recipient) (wrapDTag, welcomer.ts).
 *
 * The roomId stays INSIDE the HMAC — the new tag is opaque on the wire and
 * cross-room collisions are impossible (spec §5.2).
 */
export function migrateLegacyWrapDTag(welcomerEpochKey, legacyDTag) {
    const parsed = parseLegacyWrapDTag(legacyDTag);
    if (!parsed)
        return null;
    return wrapDTag(welcomerEpochKey, parsed.roomId, parsed.recipient);
}
/**
 * Scan helper: given a set of wrap d-tags (e.g. from a relay query on the
 * room's wrap kind), partition them into legacy (migratable) and
 * current/unknown. Pure — callers decide what to re-publish.
 */
export function partitionWrapDTags(dtags) {
    const legacy = [];
    const other = [];
    for (const d of dtags) {
        const parsed = parseLegacyWrapDTag(d);
        if (parsed)
            legacy.push({ d, ...parsed });
        else
            other.push(d);
    }
    return { legacy, other };
}
// Re-exports used by the doc references above (keep the import surface
// single-module for consumers).
export { utf8ToBytes, hexToBytes };
