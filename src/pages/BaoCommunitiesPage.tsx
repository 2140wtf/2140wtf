import { Bot, Hash, Loader2, Lock, MessagesSquare, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";

import { JoinButton } from "@/components/auth/JoinButton";
import { PageHeader } from "@/components/PageHeader";
import { RelayIdentity } from "@/components/RelayListEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChromeDialogContent, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommunityActions2, useCreateRelayCandidates2 } from "@/concord-v2/hooks/useCommunityActions2";
import { useCommunity2, useLiveCommunities2, useIsExcluded2 } from "@/concord-v2/hooks/useCommunityList2";
import { useChannels2, useControlFold2 } from "@/concord-v2/hooks/useControlPlane2";
import { useConcord2Unread } from "@/concord-v2/hooks/useConcord2Unread";
import { useDecryptedImage2 } from "@/concord-v2/hooks/useDecryptedImage2";
import type { CommunityListEntry } from "@/concord-v2/lib/communityList";
import { MAX_COMMUNITY_RELAYS } from "@/concord-v2/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMutes } from "@/hooks/useMutes";
import { toast } from "@/hooks/useToast";
import { normalizeRelayUrl } from "@/lib/platform";
import { APP_RELAYS as APP_RELAY_METADATA } from "@/lib/appRelays";
import { STOCK_RELAYS } from "@/concord-v2/lib/invite";
import { cn } from "@/lib/utils";

const DISCOVERY_RELAY_URLS = [
  "wss://atlas.nostr.land", "wss://eden.nostr.land",
  "wss://relay.dreamith.to", "wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band",
  "wss://offchain.pub", "wss://relay.snort.social", "wss://bitcoiner.social", "wss://nostr.bitcoiner.social", "wss://nostr.jcloud.es",
  "wss://purplepag.es", "wss://relay.mostr.pub", "wss://relay.nsecbunker.com", "wss://nostr-relay.psfoundation.info", "wss://nostr.swiss-enigma.ch", "wss://jskitty.com/nostr",
  "wss://asia.vectorapp.io/nostr", "wss://relay.nostrview.com", "wss://relay.notoshi.io", "wss://nostr.slothy.win", "wss://relay.nostr.ro",
  "wss://relay.nostr.bg", "wss://nostr.wine", "wss://nostr.land", "wss://relay.nostr.info", "wss://relay.nostrati.com",
  "wss://relay.nostr.net", "wss://nostr.mom", "wss://nostr.oxtr.dev", "wss://relay.orangepill.dev", "wss://relay.f7z.io",
  "wss://nostr21.com", "wss://relay.nostr.band", "wss://relay.nostrplebs.com", "wss://relay.nostrified.org", "wss://nostr-relay.app",
  "wss://nostr-relay.wlvs.dev", "wss://relay.nostr.net", "wss://nostr.mutinywallet.com", "wss://relay.nostr.bg", "wss://relay.nostrverse.com",
  "wss://nostr-relay.dtonon.com", "wss://relay.nostr.wine", "wss://nostr.azzamo.net", "wss://relay.nostr.ro", "wss://nostr.privex.io",
  "wss://nostr-relay.schnitzel.world", "wss://relay.nostr.express", "wss://relay.nostr.au", "wss://nostr-relay.online", "wss://nostr.21.co",
  "wss://relay.nostr.nu", "wss://relay.nostr.place", "wss://nostr-relay.einundzwanzig.space", "wss://relay.nostr.guru", "wss://nostr-relay.damus.io",
];

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

  // Relay picks are EXPLICIT and start EMPTY: nothing is pre-ticked, and the
  // Create button stays disabled until at least one relay is chosen. Choosing
  // is the user's confirmation that they've seen the reach-vs-privacy
  // tradeoff explained above the list — a pre-selected "everything" default
  // let a privacy-sensitive creator mint a community onto the full feed relay
  // set without ever looking at this section.
  const [picked, setPicked] = useState<string[]>([]);
  const [showMoreRelays, setShowMoreRelays] = useState(false);
  const [relaySearch, setRelaySearch] = useState("");
  const { data: candidates } = useCreateRelayCandidates2(open);
  // Rows = candidates ∪ picked — a custom-added relay is simply a picked
  // relay the candidates don't know about, so unticking it drops it from the
  // list again.
  const starterCandidates = useMemo(() => {
    const neutral = (candidates ?? []).filter((candidate) => !candidate.url.includes("relay.ditto.pub"));
    const preferred = DISCOVERY_RELAY_URLS
      .map(normalizeRelayUrl)
      .filter((url): url is string => Boolean(url))
      .filter((url) => !neutral.some((candidate) => candidate.url === url))
      .slice(0, 5 - neutral.length)
      .map((url) => ({ url, source: "fallback" as const }));
    return [...neutral, ...preferred].slice(0, 5);
  }, [candidates]);
  const relayRows = useMemo(() => {
    const rows = new Map<string, "dm" | "app" | "fallback" | "custom">();
    for (const candidate of starterCandidates) rows.set(candidate.url, candidate.source);
    for (const url of picked) {
      if (!rows.has(url)) rows.set(url, "custom");
    }
    return [...rows].map(([url, source]) => ({ url, source }));
  }, [starterCandidates, picked]);
  const allSuggestedRelaysPicked = Boolean(
    starterCandidates.length > 0 && starterCandidates.every((candidate) => picked.includes(candidate.url)),
  );
  const discoveryRelays = useMemo(() => {
    const known = new Set(relayRows.map((row) => row.url));
    const urls = [
      ...DISCOVERY_RELAY_URLS,
      ...APP_RELAY_METADATA.relays.map((relay) => relay.url),
      ...STOCK_RELAYS,
    ];
    return [...new Set(urls.map(normalizeRelayUrl).filter((url): url is string => Boolean(url)))]
      .filter((url) => !known.has(url) && !url.includes("relay.ditto.pub"));
  }, [relayRows]);
  const filteredDiscoveryRelays = useMemo(() => {
    const query = relaySearch.trim().toLowerCase();
    return query ? discoveryRelays.filter((url) => url.toLowerCase().includes(query)) : discoveryRelays;
  }, [discoveryRelays, relaySearch]);

  const toggleRelay = (url: string, on: boolean) =>
    setPicked((cur) => (on ? (cur.includes(url) ? cur : [...cur, url]) : cur.filter((u) => u !== url)));

  const [newRelayUrl, setNewRelayUrl] = useState("");
  const addCustomRelay = () => {
    const normalized = normalizeRelayUrl(newRelayUrl);
    if (!normalized) {
      toast({ title: "Invalid relay URL", description: "Enter a ws:// or wss:// URL.", variant: "destructive" });
      return;
    }
    if (picked.includes(normalized)) {
      toast({ title: "Already picked", description: normalized });
      return;
    }
    setPicked([...picked, normalized]);
    setNewRelayUrl("");
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || picked.length === 0) return;
    setBusy(true);
    try {
      const { communityId, name: createdName } = await create({ name: trimmed, relays: picked, agentOnly });
      toast({ title: "Community created", description: createdName });
      onOpenChange(false);
      setName("");
      setAgentOnly(false);
      setPicked([]);
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
      {/* The whole dialog scrolls (max height + overflow) with generous bottom
          padding: the candidate relay list can be long, and without this the
          tail of the module was unreachable unless the browser went
          fullscreen. */}
      <ChromeDialogContent
        title="New encrypted community"
        contentClassName="max-h-[85dvh] overflow-y-auto overscroll-contain pb-24"
      >
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

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Where this community lives. Members read and write here, so pick
                relays that accept your writes. An auth-only or DM-only relay can
                reject the genesis and strand the create. A community lives on up
                to {MAX_COMMUNITY_RELAYS} relays — only the first {MAX_COMMUNITY_RELAYS} picks are used.
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Privacy tip:</span>{" "}
                messages, member list, and community metadata stay sealed — relays
                only ever hold ciphertext. What every relay you add CAN see is
                traffic shape (timing and volume) and direct-invite handoffs
                (a direct invite p-tags the invitee once; links avoid that recipient
                tag but are not anonymous). For most communities the everyday app relays are a fine
                home; only a super privacy-focused group benefits from trimming
                down to a single relay you control, ideally with NIP-42 read
                auth — and preferring invite links over direct invites. Nothing
                is pre-ticked: your pick below doubles as confirming you've read
                this.
              </p>

              <div className="space-y-1.5 pt-1">
                {relayRows.map(({ url, source }, index) => {
                  const checkboxId = `community-relay-${index}`;
                  return (
                  <div
                    key={url}
                    className="flex cursor-pointer items-center gap-3 rounded-md bg-background/40 px-3 py-2.5"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={picked.includes(url)}
                      onCheckedChange={(v) => toggleRelay(url, v === true)}
                      disabled={busy}
                      aria-label={`Use relay ${url}`}
                    />
                    <div className="flex-1 min-w-0">
                      <label htmlFor={checkboxId} className="block cursor-pointer">
                        <RelayIdentity url={url} />
                      </label>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {source === "dm" ? "Your DM relay · not yet tested for community writes" : source === "app" ? "App relay" : source === "fallback" ? "Interop fallback" : "Custom relay"}
                      </span>
                    </div>
                  </div>
                  );
                })}
                {relayRows.length === 0 && (
                  <p className="text-sm text-muted-foreground py-1">Loading relay suggestions…</p>
                )}
              </div>

              {discoveryRelays.length > 0 && (
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between border-primary/40 bg-background/40 text-xs text-foreground hover:bg-primary/10"
                    onClick={() => setShowMoreRelays((open) => !open)}
                    aria-expanded={showMoreRelays}
                  >
                    {showMoreRelays ? "Hide additional relays" : "Discover more relays"}
                  </Button>
                  {showMoreRelays && (
                    <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-border/60 bg-background/30 p-1.5">
                      <Input
                        value={relaySearch}
                        onChange={(event) => setRelaySearch(event.target.value)}
                        placeholder="Search relays…"
                        aria-label="Search additional relays"
                        className="h-8 bg-background/60 text-xs"
                      />
                      {filteredDiscoveryRelays.map((url, index) => {
                        const checkboxId = `community-discovery-relay-${index}`;
                        return (
                          <div key={url} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-background/60">
                            <Checkbox
                              id={checkboxId}
                              checked={picked.includes(url)}
                              onCheckedChange={(checked) => toggleRelay(url, checked === true)}
                              disabled={busy || (!picked.includes(url) && picked.length >= MAX_COMMUNITY_RELAYS)}
                              aria-label={`Use relay ${url}`}
                            />
                            <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer text-xs">
                              <span className="block truncate">{url}</span>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Discovery relay</span>
                            </label>
                          </div>
                        );
                      })}
                      {filteredDiscoveryRelays.length === 0 && (
                        <p className="px-2 py-3 text-xs text-muted-foreground">No relays match that search.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Not a <form>: nested forms are invalid HTML — the browser drops
                  the inner one and "Add" would submit the parent. */}
              <div className="flex gap-2 pt-1">
                <Input
                  value={newRelayUrl}
                  onChange={(e) => setNewRelayUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomRelay();
                    }
                  }}
                  placeholder="wss://relay.example.com"
                  aria-label="Add relay"
                  autoComplete="off"
                  className="text-base md:text-sm bg-background/40 border-transparent"
                />
                <Button type="button" disabled={!newRelayUrl.trim()} className="clip-corner-lg shrink-0" onClick={addCustomRelay}>
                  <Plus className="size-4 mr-1.5" /> Add
                </Button>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  {picked.length === 0
                    ? "Pick at least one relay to enable Create."
                    : `${picked.length} relay${picked.length === 1 ? "" : "s"} picked${picked.length > MAX_COMMUNITY_RELAYS ? ` — only the first ${MAX_COMMUNITY_RELAYS} are used` : ""}`}
                </p>
                {starterCandidates.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground -mr-2"
                    disabled={busy}
                    onClick={() => {
                      if (allSuggestedRelaysPicked) {
                        setPicked([]);
                      } else {
                        setPicked((cur) => [...new Set([...cur, ...starterCandidates.map((candidate) => candidate.url)])]);
                      }
                    }}
                  >
                    {allSuggestedRelaysPicked ? "Deselect all" : "Select all"}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim() || picked.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Create"}
              </Button>
            </div>
          </form>
        </div>
      </ChromeDialogContent>
    </Dialog>
  );
}

/**
 * `/bao/baocommunity` — the ₿AO communities list: every Concord V2 community the user
 * holds keys for, with unread/mention rollups. This replaces Armada's
 * ServerRail: cross-community navigation starts here, and each community's
 * channel sidebar lives inside the community page.
 */
export function BaoCommunitiesPage() {
  useSeoMeta({ title: "₿AO Community — 2140.wtf" });
  const { user } = useCurrentUser();
  const entries = useLiveCommunities2();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="₿AO Community"
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
          <div className="px-4 pb-16 pt-16 sm:px-6">
            <div className="flex flex-col items-center gap-4 text-center">
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

            <figure className="mx-auto mt-20 grid max-w-6xl overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm sm:mt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="aspect-[3/2] overflow-hidden bg-muted lg:aspect-auto lg:min-h-72">
                <img
                  src="/david-chaum.webp"
                  alt="David Chaum speaking on stage"
                  className="size-full object-cover grayscale"
                />
              </div>
              <figcaption className="flex flex-col justify-center px-6 py-8 sm:px-8 sm:py-10 lg:px-12">
                <blockquote className="font-serif text-xl italic leading-relaxed text-foreground sm:text-2xl lg:text-3xl">
                  “In one direction lies unprecedented scrutiny and control of people&apos;s lives; in
                  the other, secure parity between individuals and organizations. The shape of
                  society in the next century may depend on which approach predominates.”
                </blockquote>
                <cite className="mt-6 text-base not-italic text-muted-foreground sm:text-lg">
                  — David Chaum <time dateTime="1992">1992</time>
                </cite>
              </figcaption>
            </figure>
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
