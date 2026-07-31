import { Check, Copy, Info, Link as LinkIcon, Loader2, UserPlus } from "lucide-react";
import { useState } from "react";

import { BaoMark as ArmadaCrest, BaoMarkKeyframes as ArmadaCrestKeyframes } from "@/components/brand/BaoMark";
import { ProfileSearchSelect } from "@/components/chat/ProfileSearchSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, ChromeDialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useInviteActions2 } from "@/concord-v2/hooks/useInvites2";
import { toast } from "@/hooks/useToast";
import type { SearchProfile } from "@/hooks/useSearchProfiles";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { CommunityV2 } from "@/concord-v2/lib/types";

/**
 * Invite people to a Concord V2 community two ways (CORD-05): a direct
 * gift-wrapped key handoff to someone found by name (NIP-50 search, follows
 * first), or a shareable public link — the path carries the bundle's naddr
 * locator, the `#fragment` carries the unlock token, never sent to any server.
 * Links revoke without re-keying; a direct invite is unrevocable and keeps the
 * community Private.
 */
export function InviteDialog2({
  community,
  open,
  onOpenChange,
}: {
  community: CommunityV2 | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChromeDialogContent title="Invite people">
        <InviteBody community={community} />
        <ArmadaCrestKeyframes />
      </ChromeDialogContent>
    </Dialog>
  );
}

function InviteBody({ community }: { community: CommunityV2 | undefined }) {
  const { createLink, isCreatingLink, revokeLink, myLinks, sendDirectInvite, isSendingInvite, isPublic, revokeWouldPrivatize } =
    useInviteActions2(community);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string>("single"); // "single" | "never" | days
  const [audience, setAudience] = useState<string>("human"); // "human" | "agent"
  const [label, setLabel] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [sentPubkey, setSentPubkey] = useState<string | null>(null);
  const [pendingPubkey, setPendingPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (profile: SearchProfile) => {
    setError(null);
    setPendingPubkey(profile.pubkey);
    try {
      await sendDirectInvite({ recipientPubkey: profile.pubkey });
      setSentPubkey(profile.pubkey);
      toast({
        title: "Invite sent",
        description: `${profile.metadata.name || profile.metadata.display_name || "They"} will be asked to accept.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the invite.");
    } finally {
      setPendingPubkey(null);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    // The first live link flips the derived mode Public (CORD-05 §5). Whether
    // bans still rotate is per-banner (foreign links gate rotations, own links
    // don't) — the ban dialog's step list tells that truth case by case.
    if (
      !isPublic &&
      !confirm(
        "Creating an invite link makes this community public: anyone with the link can join. Revoking every link makes it private again.",
      )
    ) {
      return;
    }
    try {
      const labelOpt = label.trim() || undefined;
      const audienceOpt = audience === "agent" ? ("agent" as const) : undefined;
      setLink(
        expiry === "single"
          ? await createLink({ maxUses: 1, label: labelOpt, audience: audienceOpt })
          : await createLink({ expiresAtMs: expiry !== "never" ? Date.now() + Number(expiry) * 86400_000 : undefined, label: labelOpt, audience: audienceOpt }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the link.");
    }
  };

  const handleRevoke = async (url: string) => {
    setError(null);
    const privatizes = revokeWouldPrivatize(url);
    if (
      privatizes &&
      !confirm(
        "This is the last live invite link. Revoking it makes the community private: new members can then only be added by direct invite, and banning a member will rotate the community keys.",
      )
    ) {
      return;
    }
    setRevoking(url);
    try {
      await revokeLink({ url });
      if (link === url) setLink(null);
      toast({
        title: "Invite link revoked",
        description: privatizes
          ? "It can no longer be used to join. This community is now private."
          : "It can no longer be used to join.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't revoke the link.");
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await writeClipboardText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // Live links numbered by creation order: #1 is the OLDEST live link and
  // sits on top; newer links append at the bottom. When one is revoked the
  // rest shift up so the sequence stays a clean 1..N — the oldest always
  // keeps #1 and the newest (e.g. the one just generated) is always the
  // highest number at the bottom.
  const existing = [...myLinks].sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ArmadaCrest size={72} />
        <div className="space-y-1">
          <h2 className="chrome-dialog-title font-mono font-bold lowercase tracking-tight text-foreground">
            invite people
          </h2>
          <p className="text-sm text-muted-foreground">
            {community?.name ? (
              <>
                Bring people into <span className="text-foreground">{community.name}</span>.
              </>
            ) : (
              <>Bring people into your community.</>
            )}
          </p>
        </div>
      </div>

      {/* Direct invite — search by name, follows first. A key handoff: the
          bundle giftwraps straight to them, and the community stays Private. */}
      <div className="w-full space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <UserPlus className="size-3.5" />
          Invite someone directly
        </div>
        <ProfileSearchSelect onSelect={handleSelect} busyPubkey={pendingPubkey} autoFocus />
        {sentPubkey && !isSendingInvite && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="size-3.5" /> Invite sent. Search again to invite more.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          Direct invites p-tag the invitee's pubkey on the relays once. When member
          anonymity matters, share an invite link instead — link joins are anonymous.
        </p>
      </div>

      {/* Public link — the escape hatch / share-anywhere path. */}
      <div className="w-full space-y-2 border-t border-chrome pt-5">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <LinkIcon className="size-3.5" />
          Or share a link
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ml-auto text-muted-foreground/70 hover:text-foreground" aria-label="About invite links">
                <Info className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-64 p-3 text-xs normal-case tracking-normal font-normal text-muted-foreground">
              Anyone with the link can join. The secret lives in the # fragment, never sent to a server. A
              single-use link dies after the first join — your app auto-revokes it. Revoking stops new joins, but
              someone who already opened the link keeps what it held; for a hard cutoff, rotate keys (ban the
              leech) instead.
            </PopoverContent>
          </Popover>
        </div>
        {link ? (
          <>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" size="icon" variant="outline" className="shrink-0" onClick={() => handleCopy(link)} aria-label="Copy link">
                {copied === link ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleRevoke(link)}
              disabled={revoking === link}
              className="text-destructive hover:text-destructive"
            >
              {revoking === link ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" /> Revoking...</> : "Revoke this link"}
            </Button>
          </>
        ) : (
          <>
            {/* Who the link is for: agent links land on a machine-first fast
                path (one-click key creation, no human sign-up detour). */}
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger className="w-full" aria-label="Who is this link for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="human">For a human</SelectItem>
                <SelectItem value="agent">For an AI agent — fast machine join</SelectItem>
              </SelectContent>
            </Select>
            {/* Link options are always visible (no expander): the safe choice
                is the default — a single-use link dies after the first join —
                and the alternatives should be seen, not hidden. */}
            <div className="flex gap-2">
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="w-40 shrink-0" aria-label="Link expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single use</SelectItem>
                  <SelectItem value="never">Never expires</SelectItem>
                  <SelectItem value="1">Expires in 1 day</SelectItem>
                  <SelectItem value="7">Expires in 7 days</SelectItem>
                  <SelectItem value="30">Expires in 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="min-w-0 text-sm"
                aria-label="Invite label"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleGenerate}
              disabled={isCreatingLink || !community}
              className="w-full clip-corner-lg"
            >
              {isCreatingLink ? <><Loader2 className="size-4 mr-2 animate-spin" /> Generating...</> : "Generate invite link"}
            </Button>
          </>
        )}
      </div>

      {existing.length > 0 && (
        <div className="w-full space-y-1.5 border-t border-chrome pt-4">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your live links — oldest first</div>
          {existing.map((e, i) => (
            <div key={e.token} className="flex items-center gap-2">
              <span
                className="w-7 shrink-0 text-right font-mono text-xs text-muted-foreground"
                title="Creation order — #1 is the oldest live link, the highest number the newest"
              >
                #{i + 1}
              </span>
              <div className="relative min-w-0 flex-1">
                <Input readOnly value={e.url} className="min-w-0 font-mono text-[0.65rem]" onFocus={(ev) => ev.currentTarget.select()} />
                {e.audience === "agent" && (
                  <span className="absolute -top-2 left-2 rounded-sm bg-secondary px-1 text-[0.6rem] font-semibold uppercase tracking-wide text-secondary-foreground">
                    agent
                  </span>
                )}
                {e.max_uses === 1 && (
                  <span className={cn(
                    "absolute -top-2 rounded-sm bg-primary px-1 text-[0.6rem] font-semibold uppercase tracking-wide text-primary-foreground",
                    e.audience === "agent" ? "left-14" : "left-2",
                  )}>
                    single use
                  </span>
                )}
              </div>
              <Button type="button" size="icon" variant="outline" className="shrink-0" aria-label="Copy link" onClick={() => handleCopy(e.url)}>
                {copied === e.url ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0 text-destructive hover:text-destructive"
                disabled={revoking === e.url}
                onClick={() => handleRevoke(e.url)}
              >
                {revoking === e.url ? <Loader2 className="size-3.5 animate-spin" /> : "Revoke"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
