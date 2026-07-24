import { Loader2, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommunityActions2, type InvitePreview2 } from "@/concord-v2/hooks/useCommunityActions2";
import { useCommunity2 } from "@/concord-v2/hooks/useCommunityList2";
import { useDecryptedImage2 } from "@/concord-v2/hooks/useDecryptedImage2";
import { parseInviteLink, type ParsedInviteLink } from "@/concord-v2/lib/invite";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

interface InviteEmbedProps {
  /** The full invite URL as it appeared in the message. */
  url: string;
  className?: string;
}

/**
 * Discord-style "join" card for a Concord invite link posted in chat. Resolves
 * the sealed bundle preview (community name, icon, channel count) from the
 * link's bootstrap relays and offers a one-tap Join / Open button — so an
 * invite reads as an invitation rather than an opaque URL.
 */
export function InviteEmbed({ url, className }: InviteEmbedProps) {
  const invite = parseInviteLink(url);
  if (!invite) {
    // A recognizable invite link that lost its `#fragment` (e.g. a client that
    // dropped the URL hash) can't be joined — the secret lives in the fragment.
    // Say so plainly rather than showing a broken event card or a bare link.
    return (
      <InviteTombstone
        message="This invite link is missing its secret (the part after #). Ask for a fresh link."
        className={className}
      />
    );
  }
  return <InviteCard invite={invite} className={className} />;
}

function InviteCard({ invite, className }: { invite: ParsedInviteLink; className?: string }) {
  const { preview } = useCommunityActions2();
  const [data, setData] = useState<InvitePreview2 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    preview({ invite })
      .then((p) => {
        if (!cancelled) setData(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load this invite.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite.naddr]);

  if (error) {
    return <InviteTombstone message={error} className={className} />;
  }
  if (!data) {
    return <InviteSkeleton className={className} />;
  }
  return <InviteResolvedCard invite={invite} preview={data} className={className} />;
}

function InviteResolvedCard({
  invite,
  preview,
  className,
}: {
  invite: ParsedInviteLink;
  preview: InvitePreview2;
  className?: string;
}) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { join, isJoining } = useCommunityActions2();
  const iconUrl = useDecryptedImage2(preview.bundle.icon);

  // idHex on the community list is the hex community_id; the bundle carries the
  // same hex, so a direct lookup tells us if we're already a member.
  const alreadyJoined = !!useCommunity2(preview.communityId);
  const [joining, setJoining] = useState(false);

  const expired =
    typeof preview.bundle.expires_at === "number" && Date.now() > preview.bundle.expires_at;

  const open = () => navigate(`/bao/c/${encodeURIComponent(preview.communityId)}`);

  const doJoin = async () => {
    if (!user) {
      toast({ title: "Sign in to join", description: "Create an account or sign in to accept this invite." });
      return;
    }
    setJoining(true);
    try {
      const { communityId, name } = await join({ invite });
      toast({ title: "Encrypted community joined", description: name });
      navigate(`/bao/c/${encodeURIComponent(communityId)}`);
    } catch (e) {
      toast({
        title: "Couldn't join",
        description: e instanceof Error ? e.message : "The invite didn't work.",
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  };

  const busy = joining || isJoining;

  return (
    <div
      className={cn(
        "block max-w-sm w-full rounded-2xl border border-border bg-secondary/30 overflow-hidden my-1.5",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3.5 py-3 space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          You've been invited to join a community
        </p>

        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-11 clip-corner-lg shrink-0">
            {iconUrl && <AvatarImage src={iconUrl} alt={preview.name} className="object-cover" />}
            <AvatarFallback className="clip-corner-lg bg-primary/20 text-primary font-semibold">
              {preview.name.slice(0, 2).toUpperCase() || "??"}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate leading-tight">{preview.name}</p>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-success shrink-0" />
                Encrypted
              </span>
              {preview.channelCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5 shrink-0" />
                  {preview.channelCount} {preview.channelCount === 1 ? "channel" : "channels"}
                </span>
              )}
            </div>
          </div>
        </div>

        {alreadyJoined ? (
          <Button variant="secondary" className="w-full clip-corner-lg" onClick={open}>
            Open
          </Button>
        ) : expired ? (
          <Button variant="secondary" className="w-full clip-corner-lg" disabled>
            Invite expired
          </Button>
        ) : (
          <Button className="w-full clip-corner-lg" onClick={doJoin} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Joining…
              </>
            ) : (
              "Join"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function InviteSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "max-w-sm w-full rounded-2xl border border-border bg-secondary/30 overflow-hidden my-1.5",
        className,
      )}
    >
      <div className="px-3.5 py-3 space-y-2.5">
        <Skeleton className="h-2.5 w-48" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 clip-corner-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-9 w-full clip-corner-lg" />
      </div>
    </div>
  );
}

function InviteTombstone({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 max-w-sm rounded-2xl border border-dashed border-border px-3.5 py-4 my-1.5 text-muted-foreground",
        className,
      )}
    >
      <ShieldCheck className="size-4 shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}
