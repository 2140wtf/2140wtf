import { CheckCircle2, HeartPulse, Loader2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChannels2, useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useCommunityRumors } from "@/concord-v2/hooks/useCommunityRumors";
import { useMembers2 } from "@/concord-v2/hooks/useGuestbook2";
import { useInviteActions2 } from "@/concord-v2/hooks/useInvites2";
import { KIND_COMMENT, KIND_MESSAGE } from "@/concord-v2/lib/kinds";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useAuthor } from "@/hooks/useAuthor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { toast } from "@/hooks/useToast";

/**
 * Member-epoch debug / heal view for a Concord V2 community — CORD-05/06.
 *
 * After a Refounding (key rotation) advances the community's root epoch, a
 * member who never adopted the rotation stays on an OLD epoch: their client
 * keeps tagging and wrapping messages under the stale epoch, and because every
 * client retains prior-epoch keys for history, those stale messages still
 * decrypt and appear as normal traffic. Nothing on the read path flags them,
 * so a stranded member is otherwise invisible.
 *
 * This view surfaces them: for each member, the newest epoch we've observed
 * them post under, compared against the community's current root epoch. A
 * member posting below current is flagged "behind". The heal action re-hands
 * them the CURRENT keys via a Direct Invite (CORD-05 §6) — a gift-wrapped
 * bundle at today's epoch — which their client merges to catch up. (Re-following
 * a live link achieves the same; this is the admin-initiated push.)
 *
 * Detection uses only observed message epochs (the `["epoch", n]` tag any
 * member could read from raw events); it invents no new tracking.
 */
export function DebugHealView({
  community,
  canHeal,
}: {
  community: CommunityV2;
  canHeal: boolean;
}) {
  const { user } = useCurrentUser();
  const channels = useChannels2(community);
  const channelIds = useMemo(() => channels.map((c) => c.idHex), [channels]);
  const { byChannel } = useCommunityRumors(channelIds);
  const { data: folded } = useControlFold2(community);

  // Newest epoch + newest activity ms observed per author across all channels.
  const observed = useMemo(() => {
    const epochOf = new Map<string, bigint>();
    const seenMs = new Map<string, number>();
    for (const list of byChannel.values()) {
      for (const m of list) {
        if (m.kind !== KIND_MESSAGE && m.kind !== KIND_COMMENT) continue;
        const prevE = epochOf.get(m.author);
        if (prevE === undefined || m.epoch > prevE) epochOf.set(m.author, m.epoch);
        const prevMs = seenMs.get(m.author) ?? 0;
        if (m.ms > prevMs) seenMs.set(m.author, m.ms);
      }
    }
    return { epochOf, seenMs };
  }, [byChannel]);

  const { members } = useMembers2(community, observed.seenMs);

  const rows = useMemo<MemberRow[]>(() => {
    const current = community.rootEpoch;
    const all = new Set<string>([...members, ...observed.epochOf.keys()]);
    const out: MemberRow[] = [];
    for (const pubkey of all) {
      if (folded?.banned.has(pubkey)) continue;
      const epoch = observed.epochOf.get(pubkey);
      const seenMs = observed.seenMs.get(pubkey) ?? 0;
      // "behind" only if we've actually seen them post under an older epoch.
      // Members we've never seen post have no epoch signal (unknown, not behind).
      const behind = epoch !== undefined && epoch < current;
      out.push({ pubkey, epoch, seenMs, behind });
    }
    // Behind first, then by most-recent activity.
    out.sort((a, b) =>
      a.behind !== b.behind ? (a.behind ? -1 : 1) : b.seenMs - a.seenMs,
    );
    return out;
  }, [members, observed, community.rootEpoch, folded]);

  const strandedCount = rows.filter((r) => r.behind).length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-4">
      <div className="flex items-center gap-2">
        <HeartPulse className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Member health</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        This community is on epoch <span className="font-medium text-foreground">{community.rootEpoch.toString()}</span>.
        A member last seen posting under an older epoch never adopted a key
        rotation, so their new messages are encrypted to keys others may not
        keep. {canHeal ? "Send them the current keys to catch them up." : ""}
      </p>

      {strandedCount > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {strandedCount} member{strandedCount === 1 ? " was" : "s were"} last seen on an older epoch.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          Every member seen posting is on the current epoch.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members observed yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <MemberHealthRow
              key={row.pubkey}
              row={row}
              community={community}
              currentEpoch={community.rootEpoch}
              canHeal={canHeal && Boolean(user) && row.pubkey !== user?.pubkey}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface MemberRow {
  pubkey: string;
  /** Newest epoch observed for their posts, or undefined if never seen posting. */
  epoch?: bigint;
  /** Newest activity ms (0 if never seen). */
  seenMs: number;
  behind: boolean;
}

function MemberHealthRow({
  row,
  community,
  currentEpoch,
  canHeal,
}: {
  row: MemberRow;
  community: CommunityV2;
  currentEpoch: bigint;
  canHeal: boolean;
}) {
  const author = useAuthor(row.pubkey);
  const name = useScopedDisplayName(row.pubkey, author.data?.metadata);
  const isOwner = row.pubkey === community.owner;
  const { sendDirectInvite } = useInviteActions2(community);
  const [healing, setHealing] = useState(false);
  const [healed, setHealed] = useState(false);

  const handleHeal = async () => {
    setHealing(true);
    try {
      await sendDirectInvite({ recipientPubkey: row.pubkey });
      setHealed(true);
      toast({
        title: "Sent current keys",
        description: `${name} will catch up to epoch ${currentEpoch.toString()} when their client picks it up.`,
      });
    } catch (e) {
      toast({
        title: "Couldn't send keys",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setHealing(false);
    }
  };

  return (
    <li className="flex items-center gap-2.5 rounded-md bg-foreground/5 px-3 py-2 text-sm">
      <Avatar className="size-6 shrink-0">
        <AvatarImage src={author.data?.metadata?.picture} alt={name} />
        <AvatarFallback className="bg-primary/20 text-[10px] text-primary">
          {name[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {isOwner && (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          Owner
        </Badge>
      )}
      <EpochBadge epoch={row.epoch} behind={row.behind} currentEpoch={currentEpoch} />
      {row.behind && canHeal && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={healing || healed}
          onClick={handleHeal}
        >
          {healing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : healed ? (
            "Sent"
          ) : (
            "Send keys"
          )}
        </Button>
      )}
    </li>
  );
}

function EpochBadge({
  epoch,
  behind,
  currentEpoch,
}: {
  epoch?: bigint;
  behind: boolean;
  currentEpoch: bigint;
}) {
  if (epoch === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0 text-xs text-muted-foreground">not seen</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-52 text-xs">
          Haven't observed this member post, so their epoch is unknown.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (behind) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3" />
            last seen epoch {epoch.toString()}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-52 text-xs">
          Last seen posting under epoch {epoch.toString()}, but the community is on {currentEpoch.toString()}.
          They never adopted a key rotation.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      epoch {epoch.toString()}
    </span>
  );
}
