import { CheckCircle2, Clock3, ScrollText, XCircle } from "lucide-react";
import { useMemo } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useControlEvents2, useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { bytesToHex } from "@/concord-v2/lib/derive";
import { openControlEditions, type FoldedControl } from "@/concord-v2/lib/control";
import type { ParsedEdition } from "@/concord-v2/lib/edition";
import {
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_GRANT,
  VSK_INVITE_REGISTRY,
  VSK_METADATA,
  VSK_ROLE,
} from "@/concord-v2/lib/kinds";
import {
  PERMISSION_LABELS,
  grantFromJSON,
  roleFromJSON,
  type CommunityRoles,
} from "@/concord-v2/lib/roles";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { shortTimeAgo } from "@/lib/formatTime";

/**
 * Control-plane audit log for a Concord V2 community — CORD-04.
 *
 * The Control Plane is an append-only stream of real-npub-signed, version-
 * chained editions. This view renders those raw editions directly (no new
 * tracking): every metadata change, role/grant, channel edit, ban, and invite-
 * registry update — WHO signed it, WHAT it did (in detail), and whether the
 * fold actually HONORED it in context (authorized + current), superseded it
 * with a later edition, or dropped it (unauthorized / forged / lost a fork).
 *
 * It shows exactly what any member could reconstruct from raw event access —
 * authorship is the seal's Schnorr signature, and the validity verdict is the
 * same fold every client runs — so nothing here is privileged or synthesised.
 *
 * Rendered inline in the main content column (replacing the chat timeline when
 * the "Audit log" view is selected), not as a modal.
 */
export function AuditLogView({ community }: { community: CommunityV2 }) {
  const control = useControlEvents2(community);
  const { data: folded } = useControlFold2(community);

  const rows = useMemo<AuditRow[]>(() => {
    if (!control.data) return [];
    const editions = openControlEditions(control.data);

    // Classify each edition against the fold's decision. The fold accepts one
    // HEAD edition per entity (the current, authority-verified state). An
    // edition is only "superseded" if it is a genuine ANCESTOR of that head on
    // the verified hash chain (prevHash → selfHash) — i.e. it really was the
    // honored state before a later, chained edition replaced it. Anything else
    // at the entity (a forgery at any version, an unauthorized edition, a
    // same-version fork loser, an unchained plant) was NEVER honored: it is
    // "not applied", regardless of the version number it claims.
    const acceptedHead = folded?.headEditions;
    const currentRumorId = new Set<string>();
    const supersededRumorId = new Set<string>();
    if (acceptedHead) {
      // Index every edition by (eid, selfHash) so we can walk a head's chain.
      const byEidHash = new Map<string, ParsedEdition>();
      for (const e of editions) {
        byEidHash.set(`${bytesToHex(e.entityId)}:${bytesToHex(e.selfHash)}`, e);
      }
      for (const [eid, head] of acceptedHead) {
        // The head edition may live in headEditions but we key off its rumor id.
        currentRumorId.add(bytesToHex(head.rumorId));
        // Walk backwards from the head through prevHash links. Each hop must
        // resolve to an edition we actually hold at this entity; stop at the
        // chain root (no prevHash) or a dangling link (a compaction bootstrap).
        let cursor: ParsedEdition | undefined = editions.find(
          (e) => bytesToHex(e.entityId) === eid && bytesToHex(e.rumorId) === bytesToHex(head.rumorId),
        );
        const guard = new Set<string>(); // cycle guard on selfHash
        while (cursor?.prevHash) {
          const prevKey = `${eid}:${bytesToHex(cursor.prevHash)}`;
          if (guard.has(prevKey)) break;
          guard.add(prevKey);
          const prev: ParsedEdition | undefined = byEidHash.get(prevKey);
          if (!prev) break; // dangling (compacted-away) — nothing more to mark
          supersededRumorId.add(bytesToHex(prev.rumorId));
          cursor = prev;
        }
      }
    }

    return editions
      .map((e) => {
        const rumorHex = bytesToHex(e.rumorId);
        let validity: Validity;
        if (!folded) {
          validity = "unknown";
        } else if (currentRumorId.has(rumorHex)) {
          validity = "current";
        } else if (supersededRumorId.has(rumorHex)) {
          validity = "superseded";
        } else {
          // Not the head and not on the head's verified chain — never honored.
          validity = "dropped";
        }
        return toRow(e, folded?.roster, folded, validity, rumorHex);
      })
      .sort((a, b) =>
        b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.key < b.key ? 1 : -1,
      );
  }, [control.data, folded]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4">
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Audit log</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Every action recorded in this community's control plane, signed by the member who took
        it. Each row shows whether the fold honored the action in context, and anyone can
        verify this from raw event access.
      </p>
      {control.isLoading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading the control plane…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No control-plane actions yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row) => (
            <AuditRowItem key={row.key} row={row} community={community} />
          ))}
        </ol>
      )}
    </div>
  );
}

type Validity = "current" | "superseded" | "dropped" | "unknown";

/** A normalised audit row derived from one raw control edition. */
interface AuditRow {
  key: string;
  author: string;
  createdAt: number;
  /** Short verb phrase, e.g. "assigned roles to". */
  action: string;
  /** The target member pubkey (grants/bans), rendered with a name. */
  targetMembers?: string[];
  /** Free-text detail lines (role names, permissions, channel name, etc.). */
  details: string[];
  version: bigint;
  validity: Validity;
  /** Whether the actor cited a specific grant as their authority (non-owner actions). */
  citedAuthority: boolean;
}

function AuditRowItem({ row, community }: { row: AuditRow; community: CommunityV2 }) {
  const author = useAuthor(row.author);
  const actorName = useScopedDisplayName(row.author, author.data?.metadata);
  const isOwner = row.author === community.owner;

  return (
    <li className="flex items-start gap-2.5 rounded-md bg-foreground/5 px-3 py-2 text-sm">
      <Avatar className="mt-0.5 size-6 shrink-0">
        <AvatarImage src={author.data?.metadata?.picture} alt={actorName} />
        <AvatarFallback className="bg-primary/20 text-[10px] text-primary">
          {actorName[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate font-medium">{actorName}</span>
          {isOwner && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              Owner
            </Badge>
          )}
          <span className="text-muted-foreground">{row.action}</span>
          {row.targetMembers?.map((pk) => <MemberName key={pk} pubkey={pk} community={community} />)}
          <ValidityBadge validity={row.validity} />
        </div>
        {row.details.map((d, i) => (
          <p key={i} className="mt-0.5 break-words text-muted-foreground">
            {d}
          </p>
        ))}
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
          v{row.version.toString()}
          {!isOwner && ` · ${row.citedAuthority ? "cited authority" : "no authority cited"}`}
        </p>
      </div>
      <time
        className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground"
        dateTime={new Date(row.createdAt * 1000).toISOString()}
        title={new Date(row.createdAt * 1000).toLocaleString()}
      >
        {shortTimeAgo(row.createdAt)}
      </time>
    </li>
  );
}

/** A pubkey rendered as its scoped display name, inline. */
function MemberName({ pubkey, community }: { pubkey: string; community: CommunityV2 }) {
  const author = useAuthor(pubkey);
  const name = useScopedDisplayName(pubkey, author.data?.metadata);
  const isOwner = pubkey === community.owner;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-medium">
      {name}
      {isOwner && <span className="text-[9px] uppercase text-muted-foreground">owner</span>}
    </span>
  );
}

function ValidityBadge({ validity }: { validity: Validity }) {
  if (validity === "unknown") return null;
  const map = {
    current: {
      icon: <CheckCircle2 className="size-3" />,
      label: "Applied",
      cls: "bg-success/15 text-success",
      hint: "The fold honored this action and it is the entity's current state.",
    },
    superseded: {
      icon: <Clock3 className="size-3" />,
      label: "Superseded",
      cls: "bg-muted text-muted-foreground",
      hint: "Was honored on the verified chain, then a later chained edition replaced it.",
    },
    dropped: {
      icon: <XCircle className="size-3" />,
      label: "Not applied",
      cls: "bg-destructive/15 text-destructive",
      hint: "The fold did not honor this action — unauthorized, forged, or it lost a same-version fork.",
    },
  }[validity];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${map.cls}`}
        >
          {map.icon}
          {map.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-52 text-xs">{map.hint}</TooltipContent>
    </Tooltip>
  );
}

/** Resolve a channel id (hex) to its current name, if the fold knows it. */
function channelName(folded: FoldedControl | undefined, idHex: string): string {
  return folded?.channels.get(idHex)?.name ?? `channel ${idHex.slice(0, 8)}…`;
}

/** Human labels for a permission bitmask. */
function permissionLabels(perms: bigint): string[] {
  const out = PERMISSION_LABELS.filter((p) => (perms & p.bit) === p.bit).map((p) => p.label);
  return out.length ? out : ["no permissions"];
}

/** Resolve role ids to their current names (falling back to a short id). */
function roleNames(roster: CommunityRoles | undefined, roleIds: string[]): string {
  return roleIds
    .map((rid) => roster?.roles.find((r) => r.roleId === rid)?.name ?? `${rid.slice(0, 8)}…`)
    .join(", ");
}

/** Turn a raw signed edition into a detailed "who did what, and was it honored" row. */
function toRow(
  e: ParsedEdition,
  roster: CommunityRoles | undefined,
  folded: FoldedControl | undefined,
  validity: Validity,
  rumorHex: string,
): AuditRow {
  const base = {
    key: rumorHex,
    author: e.author,
    createdAt: e.createdAt,
    version: e.version,
    validity,
    citedAuthority: Boolean(e.authority),
    details: [] as string[],
  };
  const eidHex = bytesToHex(e.entityId);

  switch (e.vsk) {
    case VSK_METADATA: {
      let meta: { name?: string; description?: string } = {};
      try {
        meta = JSON.parse(e.content) as typeof meta;
      } catch {
        /* keep empty */
      }
      const details: string[] = [];
      if (meta.name) details.push(`Name: ${meta.name}`);
      if (meta.description) details.push(`Description: ${truncate(meta.description, 120)}`);
      return {
        ...base,
        action: e.version === 1n ? "created the community" : "updated community settings",
        details,
      };
    }
    case VSK_ROLE: {
      const role = roleFromJSON(e.content);
      const details: string[] = [];
      if (role) {
        details.push(`Role "${role.name}" at position ${role.position}`);
        details.push(`Permissions: ${permissionLabels(role.permissions).join(", ")}`);
      }
      return {
        ...base,
        action: e.version === 1n ? "created a role" : "updated a role",
        details,
      };
    }
    case VSK_CHANNEL: {
      let meta: { name?: string; deleted?: boolean; private?: boolean } = {};
      try {
        meta = JSON.parse(e.content) as typeof meta;
      } catch {
        /* keep empty */
      }
      const label = meta.name ?? channelName(folded, eidHex);
      if (meta.deleted) return { ...base, action: "deleted a channel", details: [`#${label}`] };
      const details = [`#${label}${meta.private ? " · private" : " · public"}`];
      return {
        ...base,
        action: e.version === 1n ? "created a channel" : "updated a channel",
        details,
      };
    }
    case VSK_GRANT: {
      const grant = grantFromJSON(e.content);
      if (grant && grant.roleIds.length === 0) {
        return {
          ...base,
          action: "revoked all roles from",
          targetMembers: [grant.member],
          details: [],
        };
      }
      return {
        ...base,
        action: "assigned roles to",
        targetMembers: grant ? [grant.member] : undefined,
        details: grant ? [`Roles: ${roleNames(roster, grant.roleIds)}`] : [],
      };
    }
    case VSK_BANLIST: {
      let list: string[] = [];
      try {
        const parsed = JSON.parse(e.content) as unknown[];
        if (Array.isArray(parsed)) {
          list = parsed.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{64}$/i.test(x));
        }
      } catch {
        /* keep empty */
      }
      return {
        ...base,
        action: list.length ? "set the ban list to" : "cleared the ban list",
        targetMembers: list.slice(0, 10),
        details: list.length > 10 ? [`…and ${list.length - 10} more`] : [],
      };
    }
    case VSK_INVITE_REGISTRY: {
      let count: number | undefined;
      try {
        const list = JSON.parse(e.content) as unknown[];
        if (Array.isArray(list)) count = list.length;
      } catch {
        /* keep undefined */
      }
      return {
        ...base,
        action: "updated their invite links",
        details: count !== undefined ? [`${count} live link${count === 1 ? "" : "s"}`] : [],
      };
    }
    default:
      return { ...base, action: `published a control edition (type ${e.vsk})`, details: [] };
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
