/**
 * Concord V2 roles & permissions — CORD-04.
 *
 * Two kinds of permission, enforced two ways: READ access is key possession
 * (never a permission bit); WRITE authority is a member's rank in the
 * owner-rooted Roster. Bit positions are FROZEN wire format. `permissions`
 * rides the wire as a DECIMAL STRING (a JSON number is a float in JS and
 * silently corrupts past 2^53); a reader accepts either form, always writes
 * the string.
 */

export const Permissions = {
  MANAGE_ROLES: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_METADATA: 1n << 2n,
  KICK: 1n << 3n,
  BAN: 1n << 4n,
  MANAGE_MESSAGES: 1n << 5n,
  CREATE_INVITE: 1n << 6n,
  // 1<<7 RETIRED (was MANAGE_INVITES).
  VIEW_AUDIT_LOG: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n,
  // Reserved: MANAGE_EMOJI=1<<10, PIN_MESSAGES=1<<11, MANAGE_EVENTS=1<<12.
} as const;

/**
 * Every currently-defined management bit — what an "Admin" role holds. There
 * is deliberately no all-powerful bit: a Role granted everything today does
 * NOT inherit a permission added tomorrow (CORD-04 §3).
 */
export const ADMIN_ALL =
  Permissions.MANAGE_ROLES |
  Permissions.MANAGE_CHANNELS |
  Permissions.MANAGE_METADATA |
  Permissions.KICK |
  Permissions.BAN |
  Permissions.MANAGE_MESSAGES |
  Permissions.CREATE_INVITE |
  Permissions.VIEW_AUDIT_LOG |
  Permissions.MENTION_EVERYONE;

/** Management bits (everything but the purely-social MENTION_EVERYONE). */
export const MANAGEMENT_MASK = ADMIN_ALL & ~Permissions.MENTION_EVERYONE;

/** Protocol-wide name cap: 64 bytes of UTF-8 (roles, channels, community name). */
export const NAME_MAX_BYTES = 64;
/** A member holds at most 64 Roles; a Community carries at most 100 (CORD-04 §2). */
export const MAX_ROLES_PER_MEMBER = 64;
export const MAX_ROLES_PER_COMMUNITY = 100;

export function permsContain(perms: bigint, bits: bigint): boolean {
  return (perms & bits) === bits;
}

export function isManagement(perms: bigint): boolean {
  return (perms & MANAGEMENT_MASK) !== 0n;
}

/** Human-facing labels for the assignable permission bits, in display order. */
export const PERMISSION_LABELS: Array<{ bit: bigint; label: string; hint: string }> = [
  { bit: Permissions.MANAGE_ROLES, label: "Manage roles", hint: "Create roles and assign them to members." },
  { bit: Permissions.MANAGE_CHANNELS, label: "Manage channels", hint: "Create, rename, and delete channels." },
  { bit: Permissions.MANAGE_METADATA, label: "Manage community", hint: "Edit name, description, logo, banner." },
  { bit: Permissions.KICK, label: "Kick members", hint: "Remove members (they can rejoin via invite)." },
  { bit: Permissions.BAN, label: "Ban members", hint: "Ban members and rotate keys to lock them out." },
  { bit: Permissions.MANAGE_MESSAGES, label: "Manage messages", hint: "Hide other members' messages." },
  { bit: Permissions.CREATE_INVITE, label: "Create invites", hint: "Mint public invite links." },
  { bit: Permissions.MENTION_EVERYONE, label: "Mention everyone", hint: "Use @everyone." },
];

export type RoleScope = { kind: "server" } | { kind: "channel"; channelId: string };

export interface Role {
  roleId: string;
  name: string;
  /** Lower = higher authority. The owner is the implicit position 0, never a Role. */
  position: number;
  permissions: bigint;
  scope: RoleScope;
  /** Cosmetic badge tint; 0 = theme default. */
  color: number;
}

/** A stock server-scope Admin role: all current management bits, position 1. */
export function adminRole(roleId: string): Role {
  return { roleId, name: "Admin", position: 1, permissions: ADMIN_ALL, scope: { kind: "server" }, color: 0 };
}

/** The moderation bits a stock Moderator holds (people + message management). */
export const MODERATOR_ALL =
  Permissions.KICK | Permissions.BAN | Permissions.MANAGE_MESSAGES | Permissions.MENTION_EVERYONE;

/**
 * A stock server-scope Moderator role at position 2 — below Admin (1), so a
 * position-1 Admin strictly outranks it and may grant it (CORD-04 §3; the
 * Admin position itself is grantable only by the owner).
 */
export function moderatorRole(roleId: string): Role {
  return { roleId, name: "Moderator", position: 2, permissions: MODERATOR_ALL, scope: { kind: "server" }, color: 0 };
}

// ── Wire JSON (CORD-04 §2) ───────────────────────────────────────────────────

interface RoleWire {
  role_id: string;
  name: string;
  position: number;
  /** Decimal string on write; a bare number from an older edition is accepted. */
  permissions: string | number;
  scope: { kind: "server" } | { kind: "channel"; channel_id: string };
  color: number;
}

export function roleToJSON(role: Role): string {
  const scope: RoleWire["scope"] =
    role.scope.kind === "channel" ? { kind: "channel", channel_id: role.scope.channelId } : { kind: "server" };
  const wire: RoleWire = {
    role_id: role.roleId,
    name: role.name,
    position: role.position,
    permissions: role.permissions.toString(), // always the string form
    scope,
    color: role.color,
  };
  return JSON.stringify(wire);
}

export function roleFromJSON(json: string): Role | undefined {
  try {
    const w = JSON.parse(json) as RoleWire;
    if (typeof w.role_id !== "string" || !/^[0-9a-f]{64}$/i.test(w.role_id)) return undefined;
    let permissions: bigint;
    if (typeof w.permissions === "string" && /^\d+$/.test(w.permissions)) permissions = BigInt(w.permissions);
    else if (typeof w.permissions === "number" && Number.isFinite(w.permissions)) permissions = BigInt(Math.trunc(w.permissions));
    else return undefined;
    if (typeof w.position !== "number" || !Number.isInteger(w.position) || w.position < 1) {
      // Position 0 is the owner's alone — the top is not mintable (CORD-04 §3);
      // a non-integer/negative position is malformed.
      return undefined;
    }
    const name = typeof w.name === "string" ? w.name : "";
    if (new TextEncoder().encode(name).length > NAME_MAX_BYTES) return undefined;
    const scope: RoleScope =
      w.scope?.kind === "channel" && typeof w.scope.channel_id === "string"
        ? { kind: "channel", channelId: w.scope.channel_id }
        : { kind: "server" };
    return {
      roleId: w.role_id.toLowerCase(),
      name,
      position: w.position,
      permissions,
      scope,
      color: typeof w.color === "number" ? w.color : 0,
    };
  } catch {
    return undefined;
  }
}

export interface MemberGrant {
  /** Grantee pubkey, lowercase hex. */
  member: string;
  roleIds: string[];
}

interface MemberGrantWire {
  member: string;
  role_ids: string[];
}

export function grantToJSON(grant: MemberGrant): string {
  const wire: MemberGrantWire = { member: grant.member, role_ids: grant.roleIds };
  return JSON.stringify(wire);
}

export function grantFromJSON(json: string): MemberGrant | undefined {
  try {
    const w = JSON.parse(json) as MemberGrantWire;
    if (typeof w.member !== "string" || !/^[0-9a-f]{64}$/i.test(w.member)) return undefined;
    const roleIds = Array.isArray(w.role_ids)
      ? w.role_ids.filter((r): r is string => typeof r === "string").slice(0, MAX_ROLES_PER_MEMBER)
      : [];
    return { member: w.member.toLowerCase(), roleIds };
  } catch {
    return undefined;
  }
}

// ── The aggregated role graph ────────────────────────────────────────────────

export interface CommunityRoles {
  roles: Role[];
  grants: MemberGrant[];
}

export function emptyRoles(): CommunityRoles {
  return { roles: [], grants: [] };
}

export function roleById(roles: CommunityRoles, roleId: string): Role | undefined {
  return roles.roles.find((r) => r.roleId === roleId);
}

export function rolesOf(roles: CommunityRoles, memberHex: string): Role[] {
  const out: Role[] = [];
  for (const g of roles.grants) {
    if (g.member !== memberHex) continue;
    for (const rid of g.roleIds) {
      const r = roleById(roles, rid);
      if (r) out.push(r);
    }
  }
  return out;
}

export function effectivePermissions(roles: CommunityRoles, memberHex: string): bigint {
  return rolesOf(roles, memberHex).reduce((acc, r) => acc | r.permissions, 0n);
}

export function hasPermission(roles: CommunityRoles, memberHex: string, bits: bigint): boolean {
  return permsContain(effectivePermissions(roles, memberHex), bits);
}

/** A member's rank: the lowest position among their Roles; undefined if roleless. */
export function highestPosition(roles: CommunityRoles, memberHex: string): number | undefined {
  const positions = rolesOf(roles, memberHex).map((r) => r.position);
  return positions.length ? Math.min(...positions) : undefined;
}

export function isAdmin(roles: CommunityRoles, memberHex: string): boolean {
  return rolesOf(roles, memberHex).some((r) => isManagement(r.permissions));
}

/**
 * The member's display tier for the shared member list: "admin" if they can
 * shape the roster itself (MANAGE_ROLES), "moderator" for any other management
 * bits (kick/ban/messages/channels/…), undefined for a roleless member.
 */
export function badgeOf(roles: CommunityRoles, memberHex: string): "admin" | "moderator" | undefined {
  const perms = effectivePermissions(roles, memberHex);
  if (permsContain(perms, Permissions.MANAGE_ROLES)) return "admin";
  if (isManagement(perms)) return "moderator";
  return undefined;
}

/** Owner is supreme; otherwise the actor must hold `permission`. */
export function isAuthorized(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  permission: bigint,
): boolean {
  if (ownerHex === actorHex) return true;
  return hasPermission(roles, actorHex, permission);
}

/** Does the actor STRICTLY outrank `targetPosition`? Owner outranks everything. */
export function outranks(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetPosition: number,
): boolean {
  if (ownerHex === actorHex) return true;
  const p = highestPosition(roles, actorHex);
  return p !== undefined && p < targetPosition;
}

/** May `actorHex` perform an action requiring `permission` against a target at `targetPosition`? */
export function canActOnPosition(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetPosition: number,
  permission: bigint,
): boolean {
  if (ownerHex === actorHex) return true;
  return hasPermission(roles, actorHex, permission) && outranks(roles, actorHex, ownerHex, targetPosition);
}

/**
 * Generalized member-targeting authority (ban/kick/hide/grant): the actor must
 * hold the bit AND strictly outrank the target (equal cannot act on equal).
 * The owner is never a valid target.
 */
export function canActOnMember(
  roles: CommunityRoles,
  actorHex: string,
  ownerHex: string | undefined,
  targetHex: string,
  permission: bigint,
): boolean {
  if (ownerHex === targetHex) return false;
  const targetPosition = highestPosition(roles, targetHex) ?? Number.MAX_SAFE_INTEGER;
  return canActOnPosition(roles, actorHex, ownerHex, targetPosition, permission);
}
