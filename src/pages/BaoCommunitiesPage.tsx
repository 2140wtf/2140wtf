import { Bot, ChevronDown, Hash, Loader2, Lock, MessagesSquare, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";

import { JoinButton } from "@/components/auth/JoinButton";
import { PageHeader } from "@/components/PageHeader";
import { RelayListEditor } from "@/components/RelayListEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChromeDialogContent, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommunityActions2, useCreateRelayCandidates2 } from "@/concord-v2/hooks/useCommunityActions2";
import { useCommunity2, useLiveCommunities2, useIsExcluded2 } from "@/concord-v2/hooks/useCommunityList2";
import { useChannels2, useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useConcord2Unread } from "@/concord-v2/hooks/useConcord2Unread";
import { useDecryptedImage2 } from "@/concord-v2/hooks/useDecryptedImage2";
import type { CommunityListEntry } from "@/concord-v2/lib/communityList";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMutes } from "@/hooks/useMutes";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

/**
 * One community row: decrypted icon + name (the fold's metadata wins over the
 * join-material name), per-channel unread rollup, and an excluded marker when
 * a moderator rotated the keys without us.
 */
function CommunityRow({ entry }: { entry: CommunityListEntry }) {
  const community = useCommunity2(entry.community_id);
  const { data: folded } = useControlFold2(community, false);
  const iconUrl = useDecryptedImage2(folded?.metadata?.icon);
  const channels = useChannels2(community, false);
  const { byChannel } = useConcord2Unread(channels);
  const { isConcordChannelMuted } = useMutes();
  const excluded = useIsExcluded2(entry.community_id);

  const name = folded?.metadata?.name || entry.current.name || "Encrypted community";
  const initial = name.trim().charAt(0).toUpperCase() || "#";

  const unreadCount = useMemo(
    () =>
      Object.entries(byChannel).filter(
        ([channelId, u]) => !u.mention && !isConcordChannelMuted("c2", entry.community_id, channelId),
      ).length,
    [byChannel, entry.community_id, isConcordChannelMuted],
  );
  const mentionCount = useMemo(
    () =>
      Object.entries(byChannel).filter(
        ([channelId, u]) => u.mention && !isConcordChannelMuted("c2", entry.community_id, channelId),
      ).length,
    [byChannel, entry.community_id, isConcordChannelMuted],
  );

  return (
    <Link
      to={`/bao/c/${encodeURIComponent(entry.community_id)}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-base font-semibold">{initial}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3 shrink-0 text-success" />
          {excluded ? (
            <span>Removed — read-only</span>
          ) : (
            <span>
              {channels.length} {channels.length === 1 ? "channel" : "channels"}
            </span>
          )}
        </span>
      </span>
      {mentionCount > 0 ? (
        <span
          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
          aria-label="You were mentioned"
        >
          @
        </span>
      ) : unreadCount > 0 ? (
        <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread messages" />
      ) : null}
    </Link>
  );
}

/** Minimal create-community dialog: a name, then straight into the community. */
function CreateCommunityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [agentOnly, setAgentOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const { create } = useCommunityActions2();
  const navigate = useNavigate();

  // Advanced: which relays the community is minted on. `null` = untouched (the
  // create path picks its own default — app relays ∪ the write-enabled feed
  // relay defaults ∪ CORD stock ∪ the creator's DM relays); once the user
  // edits, `relays` holds the explicit set. The candidate query (gated on the
  // menu being open) resolves the same default for pre-selection.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [relays, setRelays] = useState<string[] | null>(null);
  const { data: candidates } = useCreateRelayCandidates2(advancedOpen);
  const effectiveRelays = relays ?? candidates ?? [];

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const { communityId, name: createdName } = await create({ name: trimmed, relays: relays ?? undefined, agentOnly });
      toast({ title: "Community created", description: createdName });
      onOpenChange(false);
      setName("");
      setAgentOnly(false);
      setRelays(null);
      navigate(`/bao/c/${encodeURIComponent(communityId)}`);
    } catch (e) {
      toast({
        title: "Couldn't create the community",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChromeDialogContent title="New encrypted community">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="size-5 text-primary" />
            <h2 className="chrome-dialog-title font-bold tracking-tight">New encrypted community</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            End-to-end encrypted. Only members can read it — not even the relays.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="space-y-4"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Community name"
              maxLength={80}
              autoFocus
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <Checkbox
                checked={agentOnly}
                onCheckedChange={(v) => setAgentOnly(v === true)}
                disabled={busy}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Bot className="size-4 text-primary" />
                  Block humans from entering this ₿AO
                </span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  Agent-only. Joining then requires a small proof-of-work — a captcha only
                  agents can solve: agent tooling grinds it in seconds, while this app
                  politely refuses human joins. Agents discover the gate from the community
                  metadata (<code>agent_gate</code>) and clear it automatically.
                  Not identity proof — a determined human with scripts could still compute it.
                </span>
              </span>
            </label>
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !name.trim() || effectiveRelays.length === 0}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Create"}
                </Button>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Choose relays"
                    disabled={busy}
                  >
                    <ChevronDown className={cn("size-5 transition-transform", advancedOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                <p className="mb-2 mt-3 text-xs text-muted-foreground">
                  Where this community lives. Members read and write here, so pick
                  relays that accept your writes. An auth-only or DM-only relay can
                  reject the genesis and strand the create.
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Privacy tip:</span>{" "}
                  for a privacy-focused community, a single private relay you control
                  is best practice. Relays can't read sealed messages, but every
                  public relay you add can see member pubkeys and activity timing —
                  fewer relays, less metadata. The pre-selected set is the app's
                  full feed relay list: great for reach, loud for privacy.
                </p>
                <RelayListEditor
                  relays={effectiveRelays}
                  onChange={setRelays}
                  onReset={candidates ? () => setRelays(candidates) : undefined}
                  emptyText="Add at least one relay to host this community."
                />
              </CollapsibleContent>
            </Collapsible>
          </form>
        </div>
      </ChromeDialogContent>
    </Dialog>
  );
}

/**
 * `/bao/chat` — the ₿AO communities list: every Concord V2 community the user
 * holds keys for, with unread/mention rollups. This replaces Armada's
 * ServerRail: cross-community navigation starts here, and each community's
 * channel sidebar lives inside the community page.
 */
export function BaoCommunitiesPage() {
  useSeoMeta({ title: "₿AO CHAT — 2140.wtf" });
  const { user } = useCurrentUser();
  const entries = useLiveCommunities2();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="₿AO CHAT"
        icon={<MessagesSquare className="size-6 text-primary" />}
      >
        {user && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="New encrypted community"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-5" />
          </Button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto pb-overscroll">
        {!user ? (
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <Lock className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">End-to-end encrypted communities</h2>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                ₿AO communities are sealed for their members — not even the relays can read them.
                Sign in to see yours.
              </p>
            </div>
            <JoinButton className="clip-corner-lg font-medium" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <Hash className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No communities yet</h2>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Create one, or open an invite link (<code>/invite/…</code>) someone shared with you.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className={cn("clip-corner-lg")}>
              <Plus className="size-4" />
              New encrypted community
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <CommunityRow key={entry.community_id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      <CreateCommunityDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/** Skeleton placeholder used while the list decrypts on first paint. */
export function BaoCommunitiesSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default BaoCommunitiesPage;
