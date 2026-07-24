import { AtSign, Ban, Bot, ChevronDown, Copy, Crown, IdCard, MessageSquareText, MoreVertical, Music, PawPrint, Shield, ShieldOff, Smile, UserMinus, X } from "lucide-react";

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BotPill } from "@/components/BotPill";
import { ProfilePreviewCard } from "@/components/chat/ProfilePreviewCard";
import { StatusDialog } from "@/components/dialogs/StatusDialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmojifiedText } from "@/components/chat/CustomEmoji";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentBodyPets } from "@/hooks/useAgentBodyPets";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedIdentity } from "@/hooks/useScopedDisplayName";
import { isStatusExpired, useUserStatus } from "@/hooks/useUserStatus2";
import { requestMention } from "@/hooks/useMentionBus";
import { toast } from "@/hooks/useToast";
import { getAvatarShape } from "@/lib/avatarShape";
import { tryNpubEncode } from "@/lib/safeNip19";
import { cn } from "@/lib/utils";
import { writeClipboardText } from "@/lib/clipboard";
import {
  DEFAULT_WOT_AGENT_MAX_DISTANCE,
  partitionMembersByWot,
  wotBadge,
  wotBadgeLabel,
  type WotBadge,
} from "@/lib/wotFilter";

import type { WotScore } from "@/lib/wot";
import type { Nip29Admin } from "@/lib/nip29";
import type { ComponentType, ReactNode } from "react";

const ROLE_OWNER = "owner";
const ROLE_ADMIN = "admin";
const ROLE_MODERATOR = "moderator";
/** Buzz roles carried on the 39002 members event. */
const ROLE_BOT = "bot";
const ROLE_GUEST = "guest";

/**
 * The menu primitives shared by the ⋮ dropdown and the right-click context
 * menu — Radix's DropdownMenu and ContextMenu items have compatible props, so
 * the member actions are defined once and rendered through either family.
 */
interface MenuParts {
  Item: ComponentType<{ className?: string; onSelect?: (e: Event) => void; children?: ReactNode }>;
  Separator: ComponentType<{ className?: string }>;
  Label: ComponentType<{ className?: string; children?: ReactNode }>;
}

/**
 * Quiet web-of-trust indicator: a fixed-size dot (no layout shift) whose color
 * encodes the member's follow-graph distance from the viewer, with the detail
 * in a native tooltip. Renders nothing for the viewer themselves.
 */
function WotTrustDot({ badge }: { badge: WotBadge }) {
  if (badge.kind === "self") return null;
  return (
    <span
      title={wotBadgeLabel(badge)}
      aria-label={wotBadgeLabel(badge)}
      className="shrink-0 inline-flex items-center justify-center size-2"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          badge.kind === "within" && badge.distance <= 1 && "bg-success",
          badge.kind === "within" && badge.distance > 1 && "bg-primary/70",
          badge.kind === "vouched" && "bg-amber-500/70",
          badge.kind === "outside" && "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}

interface MemberRowProps {
  pubkey: string;
  roles?: string[];
  /** Live presence dot (Buzz relays). Undefined = unknown (no dot). */
  presence?: "online" | "away";
  /** Web-of-trust score for the trust dot. Undefined = still loading (no dot). */
  wotScore?: WotScore;
  canModerate: boolean;
  /** Whether the viewer is an admin (required to grant the admin role). */
  viewerIsAdmin: boolean;
  /** The viewer's own pubkey, to suppress self-moderation. */
  currentUserPubkey?: string;
  onRemove?: (pubkey: string) => void;
  onSetRole?: (pubkey: string, roles: string[]) => void;
  /** Concord: cooperatively kick (honest clients drop them; they can rejoin). */
  onKick?: (pubkey: string) => void;
  /** Concord: ban + read-cut (rotate keys to lock them out). */
  onBan?: (pubkey: string) => void;
  /** Menu label for the ban action (a ban without a read-cut is just "Ban"). */
  banLabel?: (pubkey: string) => string;
  /** Concord: unban a currently-banned member. */
  onUnban?: (pubkey: string) => void;
  /** Concord: whether this member is currently banned. */
  isBanned?: boolean;
  /** Open the per-server nickname/label editor (shown only on the viewer's own row). */
  onEditProfile?: () => void;
  /** Start a direct message with this member (Buzz relays: kind 41010). */
  onMessage?: (pubkey: string) => void;
}

function MemberRow({
  pubkey,
  roles,
  presence,
  wotScore,
  canModerate,
  viewerIsAdmin,
  currentUserPubkey,
  onRemove,
  onSetRole,
  onKick,
  onBan,
  banLabel,
  onUnban,
  isBanned,
  onEditProfile,
  onMessage,
}: MemberRowProps) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const { displayName, color } = useScopedIdentity(pubkey, metadata);
  // Pet body (a Nostr Pet declared as this agent's body) — one shared relay
  // scan backs every member row (see useAgentBodyPets).
  const petBody = useAgentBodyPets([pubkey]).bodies.get(pubkey);
  const status = useUserStatus(pubkey).data?.status;
  const rawMusicStatus = useUserStatus(pubkey, "music").data?.status;
  // Hide a music status whose NIP-40 expiration has passed (track ended).
  const musicStatus = isStatusExpired(rawMusicStatus) ? undefined : rawMusicStatus;
  const [statusOpen, setStatusOpen] = useState(false);

  const roleSet = new Set((roles ?? []).map((r) => r.toLowerCase()));
  const isOwner = roleSet.has(ROLE_OWNER);
  // The owner holds every permission implicitly, so treat them as an admin for
  // moderation gating (e.g. don't offer "Make admin" on the owner) even if the
  // explicit "admin" role string isn't present.
  const isAdmin = isOwner || roleSet.has(ROLE_ADMIN);
  const isModerator = roleSet.has(ROLE_MODERATOR);
  const isSelf = currentUserPubkey === pubkey;
  // Moderation acts on others only; the owner is never a valid target (they're
  // supreme and unremovable — mirrors canActOnMember in the roster engine).
  const canActOnUser = canModerate && !isSelf && !isOwner;

  const copyNpub = () => {
    const npub = tryNpubEncode(pubkey);
    if (!npub) return;
    writeClipboardText(npub).then(
      () => toast({ title: "Copied npub" }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  };

  // Trust dot: nothing while scores are still resolving (fail open — a
  // not-yet-loaded graph would otherwise paint everyone "outside").
  const badge = wotBadge(wotScore);

  // Shared between the ⋮ dropdown and the right-click context menu.
  const renderMenuItems = ({ Item, Separator, Label }: MenuParts) => (
    <>
      <Item className="gap-3 px-3 py-2.5" onSelect={() => requestMention(pubkey)}>
        <AtSign className="size-4" />
        Mention
      </Item>
      {onMessage && !isSelf && (
        <Item className="gap-3 px-3 py-2.5" onSelect={() => onMessage(pubkey)}>
          <MessageSquareText className="size-4" />
          Message
        </Item>
      )}
      <Item className="gap-3 px-3 py-2.5" onSelect={copyNpub}>
        <Copy className="size-4" />
        Copy npub
      </Item>

      {isSelf && (
        <Item className="gap-3 px-3 py-2.5" onSelect={() => setStatusOpen(true)}>
          <Smile className="size-4" />
          Set status
        </Item>
      )}

      {isSelf && onEditProfile && (
        <Item className="gap-3 px-3 py-2.5" onSelect={onEditProfile}>
          <IdCard className="size-4" />
          Server identity
        </Item>
      )}

      {canActOnUser && (onSetRole || onRemove || onKick || onBan || onUnban) && (
        <>
          <Separator />
          <Label className="px-2 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/80">
            Moderation
          </Label>

          {onSetRole && viewerIsAdmin && !isAdmin && (
            <Item
              className="gap-3 px-3 py-2.5"
              onSelect={() => onSetRole(pubkey, [ROLE_ADMIN])}
            >
              <Crown className="size-4" />
              Make admin
            </Item>
          )}
          {onSetRole && !isModerator && !isAdmin && (
            <Item
              className="gap-3 px-3 py-2.5"
              onSelect={() => onSetRole(pubkey, [ROLE_MODERATOR])}
            >
              <Shield className="size-4" />
              Make moderator
            </Item>
          )}
          {onSetRole && isAdmin && (
            <Item
              className="gap-3 px-3 py-2.5"
              onSelect={() => onSetRole(pubkey, [ROLE_MODERATOR])}
            >
              <Shield className="size-4" />
              Demote to moderator
            </Item>
          )}
          {onSetRole && (isAdmin || isModerator) && (
            <Item
              className="gap-3 px-3 py-2.5"
              onSelect={() => onSetRole(pubkey, [])}
            >
              <ShieldOff className="size-4" />
              Remove role
            </Item>
          )}

          {onRemove && (
            <Item
              className="gap-3 px-3 py-2.5 text-destructive focus:text-destructive"
              onSelect={() => onRemove(pubkey)}
            >
              <UserMinus className="size-4" />
              Remove from channel
            </Item>
          )}

          {onKick && (
            <Item className="gap-3 px-3 py-2.5" onSelect={() => onKick(pubkey)}>
              <UserMinus className="size-4" />
              Kick (can rejoin)
            </Item>
          )}
          {onBan && !isBanned && (
            <Item
              className="gap-3 px-3 py-2.5 text-destructive focus:text-destructive"
              onSelect={() => onBan(pubkey)}
            >
              <Ban className="size-4" />
              {banLabel?.(pubkey) ?? "Ban & lock out"}
            </Item>
          )}
          {onUnban && isBanned && (
            <Item className="gap-3 px-3 py-2.5" onSelect={() => onUnban(pubkey)}>
              <ShieldOff className="size-4" />
              Unban
            </Item>
          )}
        </>
      )}
    </>
  );

  return (
    <>
    <ContextMenu>
    <ContextMenuTrigger className="block">
    <div className="gutter-tick group flex items-center gap-2.5 pl-3 pr-2 py-2 clip-corner-lg transition-colors hover:bg-accent/50 hover:text-foreground">
      <ProfilePreviewCard pubkey={pubkey}>
        <button type="button" className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar shape={getAvatarShape(metadata)} className="size-8 cursor-pointer transition-opacity hover:opacity-90">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
              {displayName[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {presence && (
            <span
              aria-label={presence === "online" ? "Online" : "Away"}
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[hsl(var(--chrome))]",
                presence === "online" ? "bg-success" : "bg-amber-500",
              )}
            />
          )}
        </button>
      </ProfilePreviewCard>
      <ProfilePreviewCard pubkey={pubkey}>
        <button
          type="button"
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <span className="block text-sm truncate" style={color ? { color } : undefined}>
            {displayName}
          </span>
          {status?.content && (
            <span
              className="block text-xs text-muted-foreground truncate"
              title={status.content}
            >
              <EmojifiedText tags={status.event.tags}>{status.content}</EmojifiedText>
            </span>
          )}
          {musicStatus?.content && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground truncate"
              title={musicStatus.content}
            >
              <Music className="size-3 shrink-0" />
              <span className="truncate">
                <EmojifiedText tags={musicStatus.event.tags}>{musicStatus.content}</EmojifiedText>
              </span>
            </span>
          )}
        </button>
      </ProfilePreviewCard>
      {isOwner ? (
        <span
          title="Owner"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
        >
          <Crown className="size-3" aria-hidden />
          Owner
        </span>
      ) : isAdmin ? (
        <span
          title="Admin"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          <Shield className="size-3" aria-hidden />
          Admin
        </span>
      ) : isModerator ? (
        <span
          title="Moderator"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <Shield className="size-3" aria-hidden />
          Mod
        </span>
      ) : roleSet.has(ROLE_BOT) ? (
        <span
          title="Agent"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          <Bot className="size-3" aria-hidden />
          Agent
        </span>
      ) : roleSet.has(ROLE_GUEST) ? (
        <span
          title="Guest"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          Guest
        </span>
      ) : null}
      <BotPill metadata={metadata} />
      {badge && <WotTrustDot badge={badge} />}
      {petBody && (
        // Quiet pet-body marker: paw icon only, pet name in the tooltip,
        // linking to the Pets page where the pet's upkeep fundraiser lives.
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/pets"
              aria-label={`${petBody.name} — pet body`}
              className="shrink-0 inline-flex items-center rounded-full bg-primary/15 p-1 text-primary transition-colors hover:bg-primary/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PawPrint className="size-3" aria-hidden />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{petBody.name} — this agent's pet body</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Manage ${displayName}`}
            className="size-6 touch:size-10 opacity-0 group-hover:opacity-100 touch:opacity-100 data-[state=open]:opacity-100 text-muted-foreground hover:text-foreground"
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-2">
          {renderMenuItems({
            Item: DropdownMenuItem,
            Separator: DropdownMenuSeparator,
            Label: DropdownMenuLabel,
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-64 p-2">
      {renderMenuItems({
        Item: ContextMenuItem,
        Separator: ContextMenuSeparator,
        Label: ContextMenuLabel,
      })}
    </ContextMenuContent>
    </ContextMenu>
    {isSelf && <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />}
    </>
  );
}

interface MemberListProps {
  admins: Nip29Admin[];
  members: string[];
  canModerate: boolean;
  /** Whether the viewer is an admin (required to grant the admin role). */
  viewerIsAdmin?: boolean;
  /** The viewer's own pubkey, to suppress self-moderation. */
  currentUserPubkey?: string;
  /**
   * Web-of-trust agent filter + trust badges (₿AO chat). When omitted, no
   * WoT UI renders at all (NIP-29 groups, etc. keep the legacy roster).
   */
  wot?: {
    /** Per-member scores from `useWot` (zero-valued while loading). */
    scores: Map<string, WotScore>;
    /** True only once the follow graph has loaded — badges and the filter fail open until then. */
    resolved: boolean;
    /** Whether the per-community "filter agents by web of trust" toggle is on. */
    filterEnabled: boolean;
    /** Persist the toggle (per community, owned by the caller). */
    onFilterEnabledChange: (enabled: boolean) => void;
    /** Trust radius in follow hops. Default {@link DEFAULT_WOT_AGENT_MAX_DISTANCE}. */
    maxDistance?: number;
  };
  onRemove?: (pubkey: string) => void;
  onSetRole?: (pubkey: string, roles: string[]) => void;
  /** Concord moderation (additive; NIP-29 leaves these unset). */
  onKick?: (pubkey: string) => void;
  onBan?: (pubkey: string) => void;
  banLabel?: (pubkey: string) => string;
  onUnban?: (pubkey: string) => void;
  /** Concord: the set of currently-banned pubkeys (hex). */
  bannedPubkeys?: Set<string>;
  /** Per-member role labels (Buzz: member/guest/bot) for badge rendering. */
  memberRoles?: Record<string, string>;
  /** Live presence (Buzz: ephemeral kind-20001 heartbeats). */
  presence?: Record<string, "online" | "away">;
  /** Close the panel (mobile overlay close button). */
  onClose?: () => void;
  /** Open the per-server nickname/label editor for the current user. */
  onEditProfile?: () => void;
  /** Start a direct message with a member (Buzz relays: kind 41010). */
  onMessage?: (pubkey: string) => void;
  /** Override the default desktop panel chrome (e.g. for the mobile drawer). */
  className?: string;
}

/** Right-hand member panel: admins (with roles) first, then regular members. */
export function MemberList({
  admins,
  members,
  canModerate,
  viewerIsAdmin = false,
  currentUserPubkey,
  wot,
  onRemove,
  onSetRole,
  onKick,
  onBan,
  banLabel,
  onUnban,
  bannedPubkeys,
  memberRoles,
  presence,
  onClose,
  onEditProfile,
  onMessage,
  className,
}: MemberListProps) {
  const adminMap = new Map(admins.map((a) => [a.pubkey, a.roles] as const));
  // NIP-29 relays don't guarantee a stable order for the `p` tags in the
  // members/admins events, so each 30s refetch could otherwise reshuffle the
  // roster. Sort the owner first, then by pubkey for a stable order.
  const isOwnerRole = (a: Nip29Admin) => a.roles.some((r) => r.toLowerCase() === "owner");
  const sortedAdmins = [...admins].sort((a, b) => {
    const ao = isOwnerRole(a) ? 0 : 1;
    const bo = isOwnerRole(b) ? 0 : 1;
    return ao - bo || a.pubkey.localeCompare(b.pubkey);
  });
  const regulars = members
    .filter((pubkey) => !adminMap.has(pubkey))
    .sort((a, b) => a.localeCompare(b));

  // Agent filter (₿AO chat): members outside the viewer's trust radius are
  // collapsed behind an expandable row. Community-role holders (owner, admins,
  // moderators — the `admins` list) are community-vouched and never collapse;
  // nor does the viewer. Fails open while scores resolve.
  const exempt = useMemo(() => {
    const set = new Set(admins.map((a) => a.pubkey));
    if (currentUserPubkey) set.add(currentUserPubkey);
    return set;
  }, [admins, currentUserPubkey]);
  const { visible: visibleRegulars, filtered: filteredRegulars } = useMemo(
    () =>
      partitionMembersByWot(regulars, wot?.scores ?? new Map(), {
        enabled: wot?.filterEnabled ?? false,
        resolved: wot?.resolved ?? false,
        maxDistance: wot?.maxDistance ?? DEFAULT_WOT_AGENT_MAX_DISTANCE,
        exempt,
      }),
    // `regulars` is a fresh array each render; key the memo on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regulars.join(","), wot, exempt],
  );
  const [filteredOpen, setFilteredOpen] = useState(false);

  /** Score for a row, or undefined while the graph loads (renders no dot). */
  const scoreFor = (pubkey: string) => (wot?.resolved ? wot.scores.get(pubkey) : undefined);

  return (
    <aside
      className={cn(
        // Floating roster: detached by a margin, cut-corner card, same recessed
        // chrome shade as the rail/console/header. No border. Matches the thread
        // panel: full-screen card overlay on mobile, in-flow card on desktop.
        "flex flex-col flex-1 min-w-0 overflow-y-auto",
        "m-2 sidebar:my-3 sidebar:mr-2 sidebar:ml-0 p-1.5 clip-corner-lg bg-chrome",
        className,
      )}
    >
      {/* Mobile close affordance (desktop hides via the header toggle). */}
      {onClose && (
        <div className="flex items-center justify-between px-2 py-1 shrink-0 sidebar:hidden">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Members</h3>
          <Button variant="ghost" size="icon" aria-label="Close members" className="size-6 touch:size-10" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      )}
      {/* Web-of-trust agent filter (₿AO chat), persisted per community by the caller. */}
      {wot && (
        <div className="flex items-center gap-2 px-2 py-1.5 shrink-0">
          <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span
            className="flex-1 min-w-0 text-xs text-muted-foreground truncate"
            title="Collapse members beyond your web of trust (2 follow hops) behind an expandable row, and hide their messages"
          >
            Filter agents by web of trust
          </span>
          <Switch
            checked={wot.filterEnabled}
            onCheckedChange={wot.onFilterEnabledChange}
            aria-label="Filter agents by web of trust"
            className="scale-75 origin-right"
          />
        </div>
      )}
      {admins.length > 0 && (
        <>
          <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admins · {admins.length}
          </h3>
          {sortedAdmins.map((admin) => (
            <MemberRow
              key={admin.pubkey}
              pubkey={admin.pubkey}
              roles={admin.roles}
              presence={presence?.[admin.pubkey]}
              wotScore={scoreFor(admin.pubkey)}
              canModerate={canModerate}
              viewerIsAdmin={viewerIsAdmin}
              currentUserPubkey={currentUserPubkey}
              onRemove={onRemove}
              onSetRole={onSetRole}
              onKick={onKick}
              onBan={onBan}
              banLabel={banLabel}
              onUnban={onUnban}
              isBanned={bannedPubkeys?.has(admin.pubkey)}
              onEditProfile={onEditProfile}
              onMessage={onMessage}
            />
          ))}
        </>
      )}

      <h3 className="px-2 py-1 mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Members · {visibleRegulars.length}
      </h3>
      {regulars.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No visible members. The relay may hide the member list.
        </p>
      ) : (
        visibleRegulars.map((pubkey) => (
          <MemberRow
            key={pubkey}
            pubkey={pubkey}
            roles={memberRoles?.[pubkey] ? [memberRoles[pubkey]] : undefined}
            presence={presence?.[pubkey]}
            wotScore={scoreFor(pubkey)}
            canModerate={canModerate}
            viewerIsAdmin={viewerIsAdmin}
            currentUserPubkey={currentUserPubkey}
            onRemove={onRemove}
            onSetRole={onSetRole}
            onKick={onKick}
            onBan={onBan}
            banLabel={banLabel}
            onUnban={onUnban}
            isBanned={bannedPubkeys?.has(pubkey)}
            onEditProfile={onEditProfile}
            onMessage={onMessage}
          />
        ))
      )}
      {/* Collapsed out-of-trust members (agent filter ON). Expands in place. */}
      {filteredRegulars.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={filteredOpen}
            onClick={() => setFilteredOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Bot className="size-3.5 shrink-0" aria-hidden />
            {filteredRegulars.length} filtered agent{filteredRegulars.length === 1 ? "" : "s"}
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", filteredOpen && "rotate-180")} aria-hidden />
          </button>
          {filteredOpen &&
            filteredRegulars.map((pubkey) => (
              <MemberRow
                key={pubkey}
                pubkey={pubkey}
                roles={memberRoles?.[pubkey] ? [memberRoles[pubkey]] : undefined}
                presence={presence?.[pubkey]}
                wotScore={scoreFor(pubkey)}
                canModerate={canModerate}
                viewerIsAdmin={viewerIsAdmin}
                currentUserPubkey={currentUserPubkey}
                onRemove={onRemove}
                onSetRole={onSetRole}
                onKick={onKick}
                onBan={onBan}
                banLabel={banLabel}
                onUnban={onUnban}
                isBanned={bannedPubkeys?.has(pubkey)}
                onEditProfile={onEditProfile}
                onMessage={onMessage}
              />
            ))}
        </>
      )}
    </aside>
  );
}
