import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

/**
 * NIP-29 (Relay-based Groups) constants and event parsing.
 * https://github.com/nostr-protocol/nips/blob/master/29.md
 */

/**
 * Turn a publish error into a human-readable, user-facing reason. Nostrify's
 * NRelay1 throws the relay's `OK: false` machine reason as the Error message
 * (e.g. "blocked: ...", "restricted: ..."), so we strip the leading
 * machine-readable prefix and fall back to a generic message when there's
 * nothing useful (timeouts, network errors).
 */
export function relayRejectionMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const trimmed = raw.trim();
  if (!trimmed) return "The relay rejected the message.";
  // NIP-01 OK reasons are "<machine-prefix>: <human message>". Show the human
  // part when present; otherwise show the whole thing.
  const m = trimmed.match(/^(blocked|restricted|invalid|error|rate-limited|duplicate|pow):\s*(.+)$/i);
  const message = m ? m[2] : trimmed;
  // Keep it short for a toast.
  return message.length > 200 ? message.slice(0, 197) + "…" : message;
}

// ── Kinds ────────────────────────────────────────────────────────────────────

/** NIP-09 event deletion request. */
export const KIND_DELETE = 5;
/** NIP-25 reaction to an event (requires `h` tag inside a group). */
export const KIND_REACTION = 7;
/** Chat message inside a group (requires `h` tag). */
export const KIND_GROUP_CHAT = 9;
/** Thread/forum post inside a group. */
export const KIND_GROUP_THREAD = 11;
/** NIP-22 comment — used here as a threaded reply to a chat message. */
export const KIND_COMMENT = 1111;

/** Moderation: add user / set roles. */
export const KIND_PUT_USER = 9000;
/** Moderation: remove user. */
export const KIND_REMOVE_USER = 9001;
/** Moderation: edit group metadata. */
export const KIND_EDIT_METADATA = 9002;
/** Moderation: delete an event. */
export const KIND_DELETE_EVENT = 9005;
/** Moderation: create group. */
export const KIND_CREATE_GROUP = 9007;
/** Moderation: delete group. */
export const KIND_DELETE_GROUP = 9008;
/** Moderation: create invite code. */
export const KIND_CREATE_INVITE = 9009;

/**
 * Armada extension: a group's set of pinned messages. Addressable
 * (`d` = group id) so the newest event per group is the authoritative list.
 * Each pinned message is an `e` tag; the relay restricts writes to admins.
 * Not part of NIP-29 proper.
 */
export const KIND_GROUP_PINS = 39041;

/**
 * NIP-52 date-based calendar event (all-day). `start`/`end` are `YYYY-MM-DD`
 * strings (`end` exclusive). Addressable on a random `d`. Scoped to a group by
 * an `h` tag so the relay routes/authorizes it. One event per occurrence.
 * https://github.com/nostr-protocol/nips/blob/master/52.md
 */
export const KIND_CALENDAR_DATE = 31922;
/**
 * NIP-52 time-based calendar event. `start`/`end` are Unix-timestamp strings,
 * optionally with `start_tzid`/`end_tzid`. Addressable; group-scoped via `h`.
 */
export const KIND_CALENDAR_TIME = 31923;
/**
 * NIP-52 calendar event RSVP. Addressable; references the event via an `a`
 * coordinate (and `e` id when known) and carries a `status` tag
 * (accepted/declined/tentative). Group-scoped via `h`.
 */
export const KIND_CALENDAR_RSVP = 31925;

/**
 * In-chat app (webxdc) state update — Armada's NIP-29 mapping of the
 * webxdc `sendUpdate()` API (see NIP-DC / ditto's NOSTR_WEBXDC.md). A regular
 * event scoped to the group by an `h` tag, carrying a `i` tag = the app
 * session UUID, and a JSON-serialised payload in `content`. Updates are ordered
 * by `created_at` and assigned serial numbers by the client.
 */
export const KIND_GROUP_WEBXDC_UPDATE = 9450;
/**
 * In-chat app (webxdc) realtime data — Armada's NIP-29 mapping of the webxdc
 * `joinRealtimeChannel()` API. An ephemeral, group-scoped (`h` tag) event with
 * an `i` tag = the app session UUID and a base64-encoded `Uint8Array` payload
 * in `content`. The relay forwards these to active subscribers but never stores
 * them.
 */
export const KIND_GROUP_WEBXDC_REALTIME = 24450;

/** User: request to join a group. */
export const KIND_JOIN_REQUEST = 9021;
/** User: request to leave a group. */
export const KIND_LEAVE_REQUEST = 9022;

// ── Relay membership (zooid / Coracle "relay access", NIP-43-ish) ────────────
//
// Some community relays (e.g. zooid, which backs Flotilla/Soapbox) gate ALL
// reads and writes behind *relay-level* membership, separate from per-group
// NIP-29 membership. A non-member is rejected with "restricted: you are not a
// member of this relay" before any group join is even considered. To become a
// relay member you publish an ephemeral RELAY_JOIN carrying a `claim` tag whose
// value was minted by the relay as a RELAY_INVITE event. These kinds are not
// part of NIP-29 proper; they are the de-facto Coracle/zooid relay-access
// protocol that we implement for cross-relay interop.

/** User: ephemeral request to join the *relay* (carries a `claim` tag). */
export const KIND_RELAY_JOIN = 28934;
/** Relay-signed: an invite "claim" usable with KIND_RELAY_JOIN. */
export const KIND_RELAY_INVITE = 28935;
/** User: ephemeral request to leave the *relay*. */
export const KIND_RELAY_LEAVE = 28936;

/**
 * NIP-43 relay-level membership snapshot (Buzz "community" roster). Relay-signed
 * and replaceable, ONE per relay — it carries no `d` scope, so a community's
 * whole roster of owner/admin/member lives in a single event keyed only by the
 * relay's own key. This is DISTINCT from per-channel NIP-29 membership
 * (39001/39002): a community owner/admin holds authority in *every* channel of
 * the community, whereas 39001/39002 are per-group. Each member is either a
 * `["member", pubkey, role]` tag or the NIP-29-style `["p", pubkey, relay_url,
 * role]`. https://github.com/nostr-protocol/nips (NIP-43, Buzz extension).
 */
export const KIND_RELAY_MEMBERS = 13534;

/** Relay-signed: group metadata (addressable, `d` = group id). */
export const KIND_GROUP_METADATA = 39000;
/** Relay-signed: group admins. */
export const KIND_GROUP_ADMINS = 39001;
/** Relay-signed: group members. */
export const KIND_GROUP_MEMBERS = 39002;
/** Relay-signed: roles supported by the group. */
export const KIND_GROUP_ROLES = 39003;
/** Relay-signed: live AV room participants. */
export const KIND_GROUP_PARTICIPANTS = 39004;

/** NIP-51: user's list of groups. */
export const KIND_USER_GROUPS = 10009;

/** NIP-32 label event. Used here for per-server self-labels (nickname/label). */
export const KIND_LABEL = 1985;

// ── Per-server self-labels (NIP-32) ──────────────────────────────────────────
//
// Armada lets a user set a per-server nickname and a per-server label that
// apply ONLY within a given relay (server). These are NIP-32 kind-1985 label
// events the user authors about *their own* pubkey, namespaced under `armada`
// and scoped to a single relay via an `r` tag.
//
// Enforcement is a *client convention*, not a cryptographic guarantee: a
// signed kind-1985 event is public, so we can't stop another client (or the
// relay) from re-serving it. What this client guarantees is:
//   1. the event is published ONLY to its target relay (never fanned out),
//   2. it is queried ONLY from that relay, and
//   3. the nickname/label is rendered ONLY where the event's `r` tag matches
//      the relay currently being viewed.
// So within *our* client the value never manifests outside its server.

/** NIP-32 label namespace for Armada self-labels. */
export const SERVER_PROFILE_NAMESPACE = "armada";
/** Label mark identifying a per-server nickname value. */
export const SERVER_NICKNAME_MARK = "armada/nickname";
/** Label mark identifying a per-server label value. */
export const SERVER_LABEL_MARK = "armada/label";
/** Label mark identifying a per-server username color (CSS hex like `#ff8800`). */
export const SERVER_COLOR_MARK = "armada/color";

/** A user's per-server self-profile (nickname + label + color) for one relay. */
export interface ServerProfile {
  /** The relay (server) this profile applies to. */
  relay: string;
  /** The user's chosen nickname on this server, if any. */
  nickname?: string;
  /** The user's chosen label on this server, if any. */
  label?: string;
  /** The user's chosen username color on this server (CSS hex), if any. */
  color?: string;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Nip29Group {
  /** Group id (the `d` tag of the kind 39000 event). */
  id: string;
  /** Relay websocket URL hosting this instance of the group. */
  relay: string;
  name: string;
  picture?: string;
  about?: string;
  /** Only members can read. */
  isPrivate: boolean;
  /** Only members can write. */
  isRestricted: boolean;
  /** Metadata hidden from non-members. */
  isHidden: boolean;
  /** Join requests are ignored (invite-only). */
  isClosed: boolean;
  /** Group supports LiveKit-powered live audio/video. */
  hasLivekit: boolean;
  /** Supported kinds, when restricted. `undefined` = all kinds. */
  supportedKinds?: number[];
  /** The raw kind 39000 event. */
  event: NostrEvent;
}

export interface Nip29Admin {
  pubkey: string;
  roles: string[];
}

export interface Nip29Role {
  name: string;
  description?: string;
}

/** A group reference stored in the user's kind 10009 list. */
export interface GroupRef {
  id: string;
  relay: string;
}

/**
 * The fully-parsed kind 10009 list (NIP-51 "Simple groups"): the user's joined
 * groups (`group` tags) and the servers/relays they use (`r` tags). Both can
 * appear in the public tags or the NIP-44-encrypted private tags.
 */
export interface UserGroupList {
  /** Joined groups: `["group", id, relay, name?]`. */
  groups: GroupRef[];
  /** Servers in use: `["r", relayUrl]`. Normalized, de-duplicated. */
  servers: string[];
}

// ── Calendar events (NIP-52) ─────────────────────────────────────────────────

/** RSVP status (NIP-52). */
export type RsvpStatus = "accepted" | "declined" | "tentative";

/** A participant referenced by a calendar event's `p` tag. */
export interface CalendarParticipant {
  pubkey: string;
  /** Optional relay hint (tag slot 2). */
  relay?: string;
  /** Optional role, e.g. "host" / "speaker" (tag slot 3). */
  role?: string;
}

/**
 * A parsed NIP-52 calendar event (kind 31922 date-based or 31923 time-based),
 * scoped to a NIP-29 group via its `h` tag.
 */
export interface CalendarEvent {
  /** Addressable `d` identifier (unique per event within the author+kind). */
  identifier: string;
  /** 31922 (all-day, date strings) or 31923 (timestamped). */
  kind: typeof KIND_CALENDAR_DATE | typeof KIND_CALENDAR_TIME;
  title: string;
  /** Markdown/freeform description (event content). */
  description: string;
  summary?: string;
  image?: string;
  /** Human-readable location string. */
  location?: string;
  /**
   * Start. For 31922: `YYYY-MM-DD`. For 31923: a Unix timestamp (seconds, as a
   * number). Always present on a valid event.
   */
  start: string;
  /** End (exclusive). Optional. Same format as `start`. */
  end?: string;
  /** IANA timezone for a time-based event's start (e.g. "America/New_York"). */
  startTzid?: string;
  /** Hashtags (`t` tags). */
  hashtags: string[];
  /** External links (`r` tags). */
  references: string[];
  participants: CalendarParticipant[];
  /** Group id this event belongs to (`h` tag). */
  groupId?: string;
  /** The raw signed event. */
  event: NostrEvent;
}

/** Input for building a calendar-event template (kind 31922/31923). */
export interface CalendarEventInput {
  identifier: string;
  kind: typeof KIND_CALENDAR_DATE | typeof KIND_CALENDAR_TIME;
  title: string;
  description?: string;
  summary?: string;
  image?: string;
  location?: string;
  /** 31922: `YYYY-MM-DD`. 31923: Unix-timestamp string. */
  start: string;
  end?: string;
  startTzid?: string;
  hashtags?: string[];
  references?: string[];
  participants?: CalendarParticipant[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d+$/;

/** A short random identifier suitable for a NIP-52 `d` tag. */
export function randomCalendarId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build the addressable coordinate (`kind:pubkey:d`) for a calendar event. */
export function calendarEventCoord(kind: number, pubkey: string, identifier: string): string {
  return `${kind}:${pubkey}:${identifier}`;
}

/**
 * Parse a kind 31922/31923 event into a {@link CalendarEvent}. Returns
 * `undefined` when it isn't a calendar kind or is missing required fields
 * (`d`, `title`, a valid `start`).
 */
export function parseCalendarEvent(event: NostrEvent): CalendarEvent | undefined {
  if (event.kind !== KIND_CALENDAR_DATE && event.kind !== KIND_CALENDAR_TIME) return undefined;
  const identifier = tag(event, "d")?.[1];
  const title = tag(event, "title")?.[1];
  const start = tag(event, "start")?.[1];
  if (!identifier || !title || !start) return undefined;

  // Validate the start format for the kind so a malformed event can't render
  // garbage dates.
  if (event.kind === KIND_CALENDAR_DATE && !DATE_RE.test(start)) return undefined;
  if (event.kind === KIND_CALENDAR_TIME && !TS_RE.test(start)) return undefined;

  const end = tag(event, "end")?.[1];
  const hashtags: string[] = [];
  const references: string[] = [];
  const participants: CalendarParticipant[] = [];
  for (const [n, v, slot2, slot3] of event.tags) {
    if (n === "t" && v) hashtags.push(v);
    else if (n === "r" && v) references.push(v);
    else if (n === "p" && HEX64.test(v ?? "")) {
      participants.push({ pubkey: v, relay: slot2 || undefined, role: slot3 || undefined });
    }
  }

  return {
    identifier,
    kind: event.kind,
    title,
    description: event.content ?? "",
    summary: tag(event, "summary")?.[1],
    image: tag(event, "image")?.[1],
    location: tag(event, "location")?.[1],
    start,
    end: end || undefined,
    startTzid: tag(event, "start_tzid")?.[1],
    hashtags,
    references,
    participants,
    groupId: tag(event, "h")?.[1],
    event,
  };
}

/**
 * Build the tags for a NIP-52 calendar event (kind 31922/31923) scoped to a
 * NIP-29 group. Always emits `d`, `h`, `title`, and `start`; everything else is
 * conditional. The group `h` tag is what lets relay29 route/authorize the write
 * and serve it back on a group-scoped query.
 */
export function buildCalendarEventTags(groupId: string, input: CalendarEventInput): string[][] {
  const tags: string[][] = [
    ["d", input.identifier],
    ["h", groupId],
    ["title", input.title],
    ["start", input.start],
  ];
  if (input.end) tags.push(["end", input.end]);
  if (input.kind === KIND_CALENDAR_TIME && input.startTzid) {
    tags.push(["start_tzid", input.startTzid]);
  }
  if (input.summary) tags.push(["summary", input.summary]);
  if (input.image) tags.push(["image", input.image]);
  if (input.location) tags.push(["location", input.location]);
  for (const t of input.hashtags ?? []) {
    if (t.trim()) tags.push(["t", t.trim()]);
  }
  for (const r of input.references ?? []) {
    if (r.trim()) tags.push(["r", r.trim()]);
  }
  for (const p of input.participants ?? []) {
    if (!HEX64.test(p.pubkey)) continue;
    const t = ["p", p.pubkey, p.relay ?? ""];
    if (p.role) t.push(p.role);
    tags.push(t);
  }
  return tags;
}

/** Format a calendar event's date/time range for display. */
export function formatCalendarEventWhen(event: CalendarEvent): string {
  if (event.kind === KIND_CALENDAR_TIME) {
    const start = new Date(Number(event.start) * 1000);
    const end = event.end ? new Date(Number(event.end) * 1000) : undefined;
    const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
    const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    const startStr = `${start.toLocaleDateString(undefined, dateFmt)}, ${start.toLocaleTimeString(undefined, timeFmt)}`;
    if (!end) return startStr;
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) return `${startStr} – ${end.toLocaleTimeString(undefined, timeFmt)}`;
    return `${startStr} – ${end.toLocaleDateString(undefined, dateFmt)}, ${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  // Date-based (all-day). Parse as UTC to avoid TZ drift.
  const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  const start = new Date(`${event.start}T00:00:00Z`);
  const startStr = start.toLocaleDateString(undefined, dateFmt);
  if (!event.end || event.end === event.start) return `${startStr} · All day`;
  // `end` is exclusive — show the last included day.
  const endExclusive = new Date(`${event.end}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
  if (endExclusive.toDateString() === start.toDateString()) return `${startStr} · All day`;
  return `${startStr} – ${endExclusive.toLocaleDateString(undefined, dateFmt)}`;
}

/** Parse the `status` tag of a kind 31925 RSVP into a {@link RsvpStatus}. */
export function parseRsvpStatus(event: NostrEvent): RsvpStatus | undefined {
  if (event.kind !== KIND_CALENDAR_RSVP) return undefined;
  const status = tag(event, "status")?.[1];
  if (status === "accepted" || status === "declined" || status === "tentative") return status;
  return undefined;
}

/** The event coordinate (`a` tag) a kind 31925 RSVP points at. */
export function parseRsvpCoord(event: NostrEvent): string | undefined {
  return tag(event, "a")?.[1];
}

/**
 * Build the tags for a kind 31925 RSVP to a calendar event. The `a` tag is the
 * event coordinate; a stable `d` tag (derived from the coordinate) makes the
 * RSVP addressable so re-RSVPing replaces the prior one. The `h` tag scopes it
 * to the group; `e`/`p` reference the event and its author when known.
 */
export function buildRsvpTags(params: {
  groupId: string;
  eventCoord: string;
  eventId?: string;
  eventAuthor?: string;
  status: RsvpStatus;
}): string[][] {
  const tags: string[][] = [
    ["a", params.eventCoord],
    ["d", `rsvp:${params.eventCoord}`],
    ["h", params.groupId],
    ["status", params.status],
  ];
  if (params.eventId && HEX64.test(params.eventId)) tags.push(["e", params.eventId]);
  if (params.eventAuthor && HEX64.test(params.eventAuthor)) tags.push(["p", params.eventAuthor]);
  return tags;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;

function tag(event: NostrEvent, name: string): string[] | undefined {
  return event.tags.find(([n]) => n === name);
}

function hasTag(event: NostrEvent, name: string): boolean {
  return event.tags.some(([n]) => n === name);
}

/** Parse a kind 39000 group-metadata event. Returns undefined when malformed. */
export function parseGroupMetadata(event: NostrEvent, relay: string): Nip29Group | undefined {
  if (event.kind !== KIND_GROUP_METADATA) return undefined;
  const id = tag(event, "d")?.[1];
  if (!id) return undefined;

  const supported = tag(event, "supported_kinds");

  return {
    id,
    relay,
    name: tag(event, "name")?.[1] || id,
    picture: tag(event, "picture")?.[1],
    about: tag(event, "about")?.[1],
    isPrivate: hasTag(event, "private"),
    isRestricted: hasTag(event, "restricted"),
    isHidden: hasTag(event, "hidden"),
    isClosed: hasTag(event, "closed"),
    hasLivekit: hasTag(event, "livekit"),
    supportedKinds: supported
      ? supported.slice(1).map(Number).filter((n) => Number.isInteger(n))
      : undefined,
    event,
  };
}

/**
 * Build the IndexedDB filters that read a single relay's channel metadata
 * (kind 39000) from the shared local event cache.
 *
 * Scoping is the whole point. Every server's kind-39000 events live together
 * in one cache, so an unscoped `{ kinds: [39000] }` read returns *every*
 * server's channels and bleeds them into this server's list — the
 * duplicate/cross-server channels bug. Kind 39000 is signed by the relay's own
 * key, so when that key (`relaySelf`) is known we scope by `authors`. Before
 * NIP-11 resolves we don't know it, so we fall back to scoping by the ids the
 * user remembers for THIS relay (their `d` tag) — never an open read. With
 * neither, there is nothing relay-scoped to read, so we return no filters
 * rather than risk surfacing another server's channels.
 */
export function relayGroupCacheFilters(
  relaySelf: string | undefined,
  rememberedIds: string[],
): NostrFilter[] {
  if (relaySelf) return [{ kinds: [KIND_GROUP_METADATA], authors: [relaySelf] }];
  if (rememberedIds.length > 0) return [{ kinds: [KIND_GROUP_METADATA], "#d": rememberedIds }];
  return [];
}

/**
 * Collapse kind-39000 metadata events into a de-duplicated, name-sorted channel
 * list for `relay`. Events are de-duplicated by group id (`d` tag), keeping the
 * newest `created_at` so a relay edit/delete supersedes an older copy. Malformed
 * events are skipped.
 *
 * Callers pass cached events FIRST and live relay events SECOND so the cache
 * acts as a floor: a sparse or empty relay read can only add to or supersede
 * the cached list, never clear it. Relays legitimately return nothing on a
 * flaky connection, before AUTH completes, or because they hide closed/private
 * groups — none of which mean the channels are gone. This mirrors how
 * ditto/flotilla treat replaceable lists.
 */
export function buildRelayGroups(events: NostrEvent[], relay: string): Nip29Group[] {
  const groups = new Map<string, Nip29Group>();
  for (const event of events) {
    const group = parseGroupMetadata(event, relay);
    if (!group) continue;
    const existing = groups.get(group.id);
    if (!existing || existing.event.created_at < event.created_at) {
      groups.set(group.id, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse a kind 39001 group-admins event into a list of admins with roles. */
export function parseGroupAdmins(event: NostrEvent): Nip29Admin[] {
  if (event.kind !== KIND_GROUP_ADMINS) return [];
  return event.tags
    .filter(([n, v]) => n === "p" && HEX64.test(v ?? ""))
    .map(([, pubkey, ...roles]) => ({ pubkey, roles: roles.filter(Boolean) }));
}

/** Parse a kind 39002 group-members event into a list of pubkeys. */
export function parseGroupMembers(event: NostrEvent): string[] {
  if (event.kind !== KIND_GROUP_MEMBERS) return [];
  return event.tags
    .filter(([n, v]) => n === "p" && HEX64.test(v ?? ""))
    .map(([, pubkey]) => pubkey);
}

/**
 * Parse per-member roles from a kind 39002 members event. Buzz relays carry
 * the member's role in the tag's last slot (`["p", pk, "", "bot"]`); plain
 * NIP-29 members events carry none, yielding an empty map.
 */
export function parseGroupMemberRoles(event: NostrEvent): Record<string, string> {
  if (event.kind !== KIND_GROUP_MEMBERS) return {};
  const out: Record<string, string> = {};
  for (const [n, pubkey, ...rest] of event.tags) {
    if (n !== "p" || !HEX64.test(pubkey ?? "")) continue;
    const role = rest.filter(Boolean).pop();
    if (role) out[pubkey] = role;
  }
  return out;
}

/**
 * Parse a kind 13534 NIP-43 membership snapshot into a `pubkey → role` map of
 * community-level roles (`owner`/`admin`/`member`). Each member is either a
 * `["member", pk, role]` tag or the NIP-29-style `["p", pk, relay_url, role]`,
 * so the role sits in a different slot per tag. A missing/unknown role defaults
 * to `member` (Buzz convention). Case-insensitive; first tag per pubkey wins.
 */
export function parseRelayMemberRoles(event: NostrEvent): Record<string, string> {
  if (event.kind !== KIND_RELAY_MEMBERS) return {};
  const out: Record<string, string> = {};
  for (const tag of event.tags) {
    const [name] = tag;
    if (name !== "member" && name !== "p") continue;
    const pubkey = (tag[1] ?? "").toLowerCase();
    if (!HEX64.test(pubkey) || out[pubkey]) continue;
    // NIP-43 `member` tags carry the role at index 2; NIP-29-shaped `p` tags
    // put an (often empty) relay_url at index 2 and the role at index 3.
    const raw = (name === "member" ? tag[2] : tag[3])?.toLowerCase();
    out[pubkey] = raw === "owner" || raw === "admin" ? raw : "member";
  }
  return out;
}

/** Parse a kind 39003 group-roles event. */
export function parseGroupRoles(event: NostrEvent): Nip29Role[] {
  if (event.kind !== KIND_GROUP_ROLES) return [];
  return event.tags
    .filter(([n, v]) => n === "role" && Boolean(v))
    .map(([, name, description]) => ({ name, description }));
}

/** Parse a kind 39004 livekit-participants event into a list of pubkeys. */
export function parseGroupParticipants(event: NostrEvent): string[] {
  if (event.kind !== KIND_GROUP_PARTICIPANTS) return [];
  return event.tags
    .filter(([n, v]) => n === "participant" && HEX64.test(v ?? ""))
    .map(([, pubkey]) => pubkey);
}

/**
 * Parse a kind 39041 group-pins event into the list of pinned message ids,
 * newest-pinned first (the order the admin pinned them — preserved as authored).
 */
export function parseGroupPins(event: NostrEvent): string[] {
  if (event.kind !== KIND_GROUP_PINS) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [n, v] of event.tags) {
    if (n === "e" && HEX64.test(v ?? "") && !seen.has(v)) {
      seen.add(v);
      ids.push(v);
    }
  }
  return ids;
}

/** Build the tags for a kind 39041 group-pins event from a list of message ids. */
export function buildGroupPinsTags(groupId: string, pinnedIds: string[]): string[][] {
  const tags: string[][] = [["d", groupId], ["h", groupId]];
  const seen = new Set<string>();
  for (const id of pinnedIds) {
    if (HEX64.test(id) && !seen.has(id)) {
      seen.add(id);
      tags.push(["e", id]);
    }
  }
  return tags;
}

/** Parse a kind 10009 user-groups list into group references (public tags only). */
export function parseUserGroupList(event: NostrEvent): GroupRef[] {
  if (event.kind !== KIND_USER_GROUPS) return [];
  return parseGroupListTags(event.tags).groups;
}

/**
 * Parse a set of kind 10009 tags (public or decrypted-private) into the full
 * list of joined groups and servers. Per NIP-51, the "Simple groups" list
 * carries `["group", id, relay, name?]` and `["r", relayUrl]` items.
 */
export function parseGroupListTags(tags: string[][]): UserGroupList {
  const groups: GroupRef[] = [];
  const servers: string[] = [];
  const seenGroups = new Set<string>();
  const seenServers = new Set<string>();

  for (const [name, a, b] of tags) {
    if (name === "group" && a && b) {
      const key = `${a}\u0000${b}`;
      if (!seenGroups.has(key)) {
        seenGroups.add(key);
        groups.push({ id: a, relay: b });
      }
    } else if (name === "r" && a) {
      if (!seenServers.has(a)) {
        seenServers.add(a);
        servers.push(a);
      }
    }
  }

  return { groups, servers };
}

/**
 * Build the kind 10009 tag list from groups + servers. Group tags carry the
 * host relay so the group can be located; server tags (`r`) list each relay in
 * use (NIP-51). Items are emitted in chronological order (servers first, then
 * groups) — callers preserve ordering by passing the existing arrays through.
 */
export function buildGroupListTags(list: UserGroupList): string[][] {
  return [
    ...list.servers.map((url) => ["r", url]),
    ...list.groups.map((g) => ["group", g.id, g.relay]),
  ];
}

/**
 * Parse a kind-1985 self-label event into a {@link ServerProfile}, scoped to a
 * relay. Returns `undefined` when the event isn't an Armada per-server
 * self-label authored by `pubkey` for `relay`.
 *
 * Expected shape:
 *   ["L", "armada"]
 *   ["l", "<nickname>", "armada/nickname"]   (optional)
 *   ["l", "<label>",    "armada/label"]      (optional)
 *   ["l", "<#rrggbb>",  "armada/color"]      (optional)
 *   ["p", "<pubkey>"]                        (self-label target)
 *   ["r", "<relay>"]                         (server scope)
 */
export function parseServerProfile(
  event: NostrEvent,
  pubkey: string,
  relay: string,
): ServerProfile | undefined {
  if (event.kind !== KIND_LABEL) return undefined;
  if (event.pubkey !== pubkey) return undefined;

  // Must be namespaced as an Armada label, self-targeted, and scoped to relay.
  const namespaces = event.tags.filter(([n]) => n === "L").map(([, v]) => v);
  if (!namespaces.includes(SERVER_PROFILE_NAMESPACE)) return undefined;

  const targetsSelf = event.tags.some(([n, v]) => n === "p" && v === pubkey);
  if (!targetsSelf) return undefined;

  const scopedToRelay = event.tags.some(([n, v]) => n === "r" && v === relay);
  if (!scopedToRelay) return undefined;

  let nickname: string | undefined;
  let label: string | undefined;
  let color: string | undefined;
  for (const [n, value, mark] of event.tags) {
    if (n !== "l") continue;
    if (mark === SERVER_NICKNAME_MARK && value) nickname = value;
    else if (mark === SERVER_LABEL_MARK && value) label = value;
    else if (mark === SERVER_COLOR_MARK && isHexColor(value)) color = value;
  }

  if (nickname === undefined && label === undefined && color === undefined) return undefined;
  return { relay, nickname, label, color };
}

/** True when `value` is a 3- or 6-digit CSS hex color (e.g. `#f80`, `#ff8800`). */
export function isHexColor(value: string | undefined): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/**
 * Build the tags for a per-server self-label (kind 1985). Empty/blank values
 * are omitted so clearing a field removes it from the published event.
 */
export function buildServerProfileTags(
  pubkey: string,
  relay: string,
  profile: { nickname?: string; label?: string; color?: string },
): string[][] {
  const tags: string[][] = [
    ["L", SERVER_PROFILE_NAMESPACE],
    ["p", pubkey],
    ["r", relay],
  ];
  const nickname = profile.nickname?.trim();
  const label = profile.label?.trim();
  const color = profile.color?.trim();
  if (nickname) tags.push(["l", nickname, SERVER_NICKNAME_MARK]);
  if (label) tags.push(["l", label, SERVER_LABEL_MARK]);
  if (isHexColor(color)) tags.push(["l", color, SERVER_COLOR_MARK]);
  return tags;
}

/** Get the group id (`h` tag) of a group-scoped event. */
export function getGroupId(event: NostrEvent): string | undefined {
  return tag(event, "h")?.[1];
}

/**
 * Build the NIP-22 tags for a kind-1111 comment replying to `parent` inside a
 * NIP-29 group. The uppercase `K`/`E`/`P` tags pin the immutable *thread root*;
 * the lowercase `k`/`e`/`p` tags point at the *immediate parent*. When the
 * parent is itself a comment, its uppercase root tags are inherited so the root
 * is stable at any nesting depth (matching Flotilla / @welshman). The group `h`
 * tag is kept so the NIP-29 relay scopes and authorizes the reply.
 *
 * https://github.com/nostr-protocol/nips/blob/master/22.md
 */
export function buildCommentTags(parent: NostrEvent, groupId: string): string[][] {
  const tags: string[][] = [["h", groupId]];

  const rootTags = parent.tags.filter(([n]) => n === "K" || n === "E" || n === "P");
  if (rootTags.length > 0) {
    // Parent is itself a comment: inherit its root pointer verbatim.
    for (const t of rootTags) tags.push([...t]);
  } else {
    // Parent is the root of this thread.
    tags.push(["K", String(parent.kind)]);
    tags.push(["E", parent.id, "", parent.pubkey]);
    tags.push(["P", parent.pubkey]);
  }

  // Immediate-parent pointer (always the event being replied to).
  tags.push(["k", String(parent.kind)]);
  tags.push(["e", parent.id, "", parent.pubkey]);
  tags.push(["p", parent.pubkey]);

  return tags;
}

/** The thread-root event id a comment belongs to (its uppercase `E` tag). */
export function getCommentRootId(event: NostrEvent): string | undefined {
  return tag(event, "E")?.[1];
}

/** The immediate parent event id a comment replies to (its lowercase `e` tag). */
export function getCommentParentId(event: NostrEvent): string | undefined {
  return tag(event, "e")?.[1];
}
