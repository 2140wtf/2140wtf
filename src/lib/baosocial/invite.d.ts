/**
 * invite-v2 — welcomer-enforced per-invite admission (protocol §7, P5).
 *
 * Config-B super-private rooms distribute PERSONAL invite links: each link
 * carries a link id (`lid`), and the operator provisions per-link limits —
 * `maxUses` (how many joins the link admits; 1 = single-use) and `expiry`
 * (unix seconds; 0 = never). The welcomer ENFORCES these bounds, not the
 * client: a joiner can never extend its own invite.
 *
 * The link itself carries `lid` (+ optional `maxUses`/`expiresAt` fields for
 * human/agent display); the join request echoes `lid` inside the
 * NIP-44-encrypted payload; the welcomer looks the lid up in its PROVISIONED
 * invite config (rooms file), checks expiry + remaining uses, and burns a use
 * only on a successful admission. Pure + neutral — no env, no relay I/O;
 * use-state is passed in so daemons decide persistence (in-memory today).
 */
export interface InviteSpec {
    /** Link id — must match the fragment's `lid`. */
    lid: string;
    /** Maximum admitted joins for this link. 1 = single-use. */
    maxUses: number;
    /** Unix seconds. 0 = never expires. */
    expiry: number;
}
export type InviteConfig = Record<string, InviteSpec>;
export type InviteVerdict = 'admit' | 'reject';
export type InviteReason = 'no-invite-v2' | 'ok' | 'missing-lid' | 'unknown-lid' | 'expired' | 'exhausted';
export interface InviteAdmissionResult {
    verdict: InviteVerdict;
    reason: InviteReason;
}
/**
 * Evaluate one join against the room's invite-v2 config.
 *
 * @param config   the room's provisioned invites (empty → invite-v2 not in play)
 * @param ctx      roomId (reserved for future per-room namespacing; must match
 *                 the lid's room), the lid claimed by the joiner, and the
 *                 CURRENT number of uses the lid has consumed
 */
export declare function evaluateInvite(config: InviteConfig, ctx: {
    lid?: string;
    uses: number;
    nowSec: number;
}): InviteAdmissionResult;
/**
 * Parse the rooms-file invite config form:
 * `[{ "lid": "abc", "maxUses": 1, "expiry": 0 }]` — or an object map
 * `{ "abc": { "maxUses": 1, "expiry": 0 } }`. Tolerant like
 * parseRetention: unknown entries are skipped, never fatal.
 */
export declare function parseInviteConfig(raw: unknown): InviteConfig;
