import { parseJoinLink } from '@/baofund/community/client.js';

/** Validate an actionable, self-contained invite before opening a connection.
 * Operator type and advisory instructions are not authorization. The original
 * string must be passed intact to admission; never execute its `do` field. */
export function validateRoomInvite(link: unknown, nowSeconds = Date.now() / 1000): ReturnType<typeof parseJoinLink> {
  try {
    if (typeof link !== 'string' || link.length > 16_384 || !Number.isFinite(nowSeconds) || nowSeconds < 0) throw new Error();
    const parts = parseJoinLink(link);
    if (!parts.relay || !parts.welcomerPub || !parts.routingId) throw new Error();
    const relay = new URL(parts.relay);
    if (!['ws:', 'wss:'].includes(relay.protocol) || relay.username || relay.password || relay.hash) throw new Error();
    if (parts.expiresAt !== undefined && (!Number.isSafeInteger(parts.expiresAt) || parts.expiresAt <= nowSeconds)) throw new Error();
    return parts;
  } catch {
    // Parser failures may contain the bearer secret. Return a fixed message.
    throw new Error('Invalid, incomplete or expired room invite');
  }
}
