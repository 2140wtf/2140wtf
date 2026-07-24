import { Braces, Check, Copy, Globe, Link as LinkIcon, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useInviteActions2, useMyLinkEpochs2 } from "@/concord-v2/hooks/useInvites2";
import { parseInviteLink, type InviteListEntry } from "@/concord-v2/lib/invite";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";
import { toast } from "@/hooks/useToast";
import { writeClipboardText } from "@/lib/clipboard";

/**
 * Invite-link admin panel for a Concord V2 community — CORD-05.
 *
 * Three sections, matching the two invite-link visibilities:
 *
 *   1. Public/Private status — whether ANY live public link exists (the
 *      community's Public flag) and which members minted the links that make
 *      it public. Derived from the aggregate control-plane registry (vsk 8).
 *   2. My links — the CURRENT user's own links for this community, with full
 *      detail (URL, label, expiry) + copy/revoke. Only the creator holds a
 *      link's token + signer secret, so only their own links show a URL.
 *   3. Community registry — every creator who has live links and how many,
 *      identified by link-signer pubkey. Any member/admin can see WHO invited
 *      and HOW MANY, but never another creator's secret URL (by design).
 *
 * Rendered inline in the main content column, not as a modal.
 */
export function InvitesView({ community }: { community: CommunityV2 }) {
  const { data: folded } = useControlFold2(community);
  const { myLinks, revokeLink, isRevoking, isPublic, revokeWouldPrivatize } = useInviteActions2(community);
  const { data: linkEpochs } = useMyLinkEpochs2(community);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // The link whose raw details we're inspecting (null = dialog closed). Live
  // links always carry the CURRENT keys (re-posted on rekey, CORD-05 §2), so
  // the epoch a link serves is the community's current `rootEpoch`.
  const [inspecting, setInspecting] = useState<InviteListEntry | null>(null);
  const epoch = Number(community.rootEpoch);

  // The link-signer pubkeys of MY live links, so I can mark them in the
  // registry ("this one's mine") and avoid implying I can't see my own URL.
  const myLinkSigners = useMemo(() => {
    const set = new Set<string>();
    for (const e of myLinks) {
      const parsed = parseInviteLink(e.url);
      if (parsed) set.add(parsed.linkSigner);
    }
    return set;
  }, [myLinks]);

  // creatorHex → count of that creator's live link signers (control-plane
  // registry). This is the community-wide, admin-visible source of truth.
  const registry = useMemo(() => {
    const out: Array<{ creator: string; count: number; signers: string[] }> = [];
    if (folded) {
      for (const [creator, signers] of folded.registriesByCreator) {
        if (signers.length > 0) out.push({ creator, count: signers.length, signers });
      }
      out.sort((a, b) => b.count - a.count);
    }
    return out;
  }, [folded]);

  const handleCopy = async (url: string) => {
    try {
      await writeClipboardText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleRevoke = async (url: string) => {
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
      toast({
        title: "Invite link revoked",
        description: privatizes
          ? "It can no longer be used to join. This community is now private."
          : "It can no longer be used to join.",
      });
    } catch (e) {
      toast({
        title: "Couldn't revoke the link",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-3 py-4">
      <div className="flex items-center gap-2">
        <LinkIcon className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Invite links</h2>
      </div>

      {/* 1. Public/Private status. */}
      <section
        className={`flex items-start gap-3 rounded-md px-3 py-3 text-sm ${
          isPublic ? "bg-primary/10" : "bg-foreground/5"
        }`}
      >
        {isPublic ? (
          <Globe className="mt-0.5 size-5 shrink-0 text-primary" />
        ) : (
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="font-medium">{isPublic ? "This community is public" : "This community is private"}</p>
          <p className="text-muted-foreground">
            {isPublic
              ? "One or more live invite links let anyone with the link join. Revoke every live link to make it private again."
              : "There are no live public invite links. People join only by direct invite."}
          </p>
        </div>
      </section>

      {/* 2. My own links (full detail + revoke). */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Your live links
        </h3>
        {myLinks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven't created any invite links for this community.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {myLinks.map((e) => {
              // The epoch this link currently vends, once resolved. Undefined
              // while loading or if it couldn't be fetched — treat as up to date.
              const servedEpoch = linkEpochs?.[e.token];
              const behind = servedEpoch !== undefined && servedEpoch < epoch;
              return (
              <li key={e.token} className="space-y-1 rounded-md bg-foreground/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={e.url}
                    className="min-w-0 font-mono text-[0.65rem]"
                    onFocus={(ev) => ev.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    aria-label="View link details"
                    onClick={() => setInspecting(e)}
                  >
                    <Braces className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    aria-label="Copy link"
                    onClick={() => handleCopy(e.url)}
                  >
                    {copied === e.url ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-destructive hover:text-destructive"
                    disabled={isRevoking && revoking === e.url}
                    onClick={() => handleRevoke(e.url)}
                  >
                    {revoking === e.url ? <Loader2 className="size-3.5 animate-spin" /> : "Revoke"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span
                    className="tabular-nums"
                    title="The community epoch this link's keys belong to. It advances each time the community rekeys."
                  >
                    Epoch {servedEpoch ?? epoch}
                  </span>
                  {e.label && <span>Label: {e.label}</span>}
                  <span>Created {new Date(e.created_at * 1000).toLocaleDateString()}</span>
                  {e.expires_at ? (
                    <span className={e.expires_at * 1000 < Date.now() ? "text-destructive" : undefined}>
                      {e.expires_at * 1000 < Date.now() ? "Expired " : "Expires "}
                      {new Date(e.expires_at * 1000).toLocaleDateString()}
                    </span>
                  ) : (
                    <span>Never expires</span>
                  )}
                </div>
                {behind && (
                  <div className="flex items-start gap-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      This link is on epoch {servedEpoch} — the community has since moved to epoch{" "}
                      {epoch}. Someone joining now could land on the old keys. It refreshes
                      automatically when you reopen this community from a device that holds it;
                      if it lingers, revoke and mint a fresh link.
                    </span>
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. Community registry overview (who minted how many). */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          All invite links in this community
        </h3>
        <p className="text-xs text-muted-foreground">
          Every member who has live invite links, and how many. Only a link's creator can see
          its actual URL — this shows who invited and how many links they hold.
        </p>
        {registry.length === 0 ? (
          <p className="text-sm text-muted-foreground">No live invite links.</p>
        ) : (
          <ul className="space-y-1.5">
            {registry.map((r) => (
              <RegistryRow
                key={r.creator}
                creator={r.creator}
                count={r.count}
                community={community}
                mine={r.signers.some((s) => myLinkSigners.has(s))}
              />
            ))}
          </ul>
        )}
      </section>

      <LinkDetailsDialog
        entry={inspecting}
        servedEpoch={inspecting ? linkEpochs?.[inspecting.token] : undefined}
        currentEpoch={epoch}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}

/**
 * A read-only JSON view of a link's stored details. The Invite List entry holds
 * the link's `token` (unlock secret + merge key) and `signer_sk` (the signing
 * secret) — anyone who reads them can mint/refresh/impersonate the link, so
 * they are REDACTED here: the whole point of the community registry is that a
 * link's secrets never leave its creator, and a "view details" affordance must
 * not casually leak them onto a screen-share or screenshot.
 */
function LinkDetailsDialog({
  entry,
  servedEpoch,
  currentEpoch,
  onClose,
}: {
  entry: InviteListEntry | null;
  servedEpoch: number | undefined;
  currentEpoch: number;
  onClose: () => void;
}) {
  const json = useMemo(() => {
    if (!entry) return "";
    const { token: _token, signer_sk: _sk, ...safe } = entry;
    return JSON.stringify(
      {
        ...safe,
        token: "<redacted>",
        signer_sk: "<redacted>",
        served_epoch: servedEpoch ?? currentEpoch,
        current_epoch: currentEpoch,
      },
      null,
      2,
    );
  }, [entry, servedEpoch, currentEpoch]);

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invite link details</DialogTitle>
          <DialogDescription>
            The stored record for this link. Secrets are redacted.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
          {json}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => writeClipboardText(json).catch(() => undefined)}
          >
            <Copy className="mr-2 size-4" /> Copy JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RegistryRow({
  creator,
  count,
  community,
  mine,
}: {
  creator: string;
  count: number;
  community: CommunityV2;
  mine: boolean;
}) {
  const author = useAuthor(creator);
  const name = useScopedDisplayName(creator, author.data?.metadata);
  const isOwner = creator === community.owner;
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
      {mine && (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          You
        </Badge>
      )}
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {count} live link{count === 1 ? "" : "s"}
      </span>
    </li>
  );
}
