/**
 * Durable read-cut intent — the failure half of a rotating ban.
 *
 * A ban composes Banlist → grant strip → Refounding. The first two are cheap
 * and land; the rotation is heavy and can die on a relay outage, leaving a
 * "banned but still readable" member. Mark the intent BEFORE the attempt and
 * clear it only on success, so the next visit to the community retries the
 * cut — no member survives a transient failure, and no admin has to remember.
 *
 * The KEEP list is captured here too, at ban time, when the member list was
 * warm and the action user-initiated. A retry must never rebuild it from
 * whatever roster the retrying surface happens to hold — a cold page or a
 * roster-less view would rotate the community out from under its own members.
 *
 * Keyed per (account, community) in localStorage: this is the moderator's own
 * bookkeeping, not shared state.
 */

export interface ReadCutIntent {
  /** Pubkeys (hex) still owed a read-cut. */
  targets: string[];
  /** The keep-list captured when the ban was issued. */
  keep: string[];
}

const key = (me: string, communityIdHex: string) => `concord2:read-cut-pending:${me}:${communityIdHex}`;

/** The pending intent, or undefined. */
export function readCutPending(me: string, communityIdHex: string): ReadCutIntent | undefined {
  try {
    const raw = localStorage.getItem(key(me, communityIdHex));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const targets = (parsed as ReadCutIntent).targets;
    const keep = (parsed as ReadCutIntent).keep;
    if (!Array.isArray(targets) || !Array.isArray(keep)) return undefined;
    const strings = (a: unknown[]) => a.filter((p): p is string => typeof p === "string");
    const cleaned = { targets: strings(targets), keep: strings(keep) };
    return cleaned.targets.length > 0 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

/** Add a target (idempotent); the freshest keep-list wins, minus all targets. */
export function addReadCutPending(me: string, communityIdHex: string, target: string, keep: string[]): void {
  try {
    const prior = readCutPending(me, communityIdHex);
    const targets = new Set(prior?.targets ?? []);
    targets.add(target);
    const nextKeep = keep.filter((pk) => !targets.has(pk));
    localStorage.setItem(key(me, communityIdHex), JSON.stringify({ targets: [...targets], keep: nextKeep }));
  } catch {
    // Storage unavailable — the ban's own failure surface already informed the admin.
  }
}

/** Clear the pending intent (cut landed, or went moot). */
export function clearReadCutPending(me: string, communityIdHex: string): void {
  try {
    localStorage.removeItem(key(me, communityIdHex));
  } catch {
    // ignore
  }
}
