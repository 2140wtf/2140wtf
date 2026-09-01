/**
 * FalLivePage — fal.live studio iframed directly (fal.live sends no
 * X-Frame-Options and no CSP frame-ancestors, so it can be embedded
 * without a proxy), with a live trollbox chat docked on the right.
 *
 * The trollbox is open to EVERYONE for reading, but posting requires
 * Nostr auth: messages are kind-1 notes published through the user's
 * logged-in signer and tagged with the fal-live channel hashtag, and the
 * room view subscribes to the same tag on the app relays. No auth = read
 * only (the composer shows a login prompt instead).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NostrEvent } from "@nostrify/nostrify";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { useSeoMeta } from "@unhead/react";
import { ArrowLeft, ExternalLink, MessageSquare, Send, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { useToast } from "@/hooks/useToast";
import { APP_SEARCH_RELAY } from "@/lib/appRelays";
import { FAL_LIVE_URL } from "@/lib/falLive";

/** Channel tag for the trollbox feed (NIP-24 style public channel topic). */
const TROLLBOX_TAG = "fallive";

/**
 * The trollbox is intentionally wired to ONE relay for both directions
 * (publish + subscribe) — same architecture as the 2140.social chat, which
 * runs on a single relay (wss://2140.social/ws). A single relay means the
 * message you send is the message everyone reads: no pool split where a note
 * lands on a write-relay the readers never query. APP_SEARCH_RELAY is the
 * app's canonical full-content relay (relay.ditto.pub).
 */
const TROLLBOX_RELAY = APP_SEARCH_RELAY;

function Trollbox() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publish, isPending } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Recent trollbox history (query) + live tail (req), the same two-phase
  // pattern LiveStreamChat uses: react-query owns the event list, the
  // long-lived req subscription appends new kind-1 notes as they arrive.
  const { data: messages = [] } = useQuery<NostrEvent[]>({
    queryKey: ["fal-live-trollbox"],
    queryFn: async ({ signal }) => {
      const events = await nostr.relay(TROLLBOX_RELAY).query(
        [{ kinds: [1], "#t": [TROLLBOX_TAG], limit: 100 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );
      return events.sort((a, b) => a.created_at - b.created_at);
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Subscribe to new trollbox messages in real-time.
  useEffect(() => {
    const controller = new AbortController();
    setConnected(true);

    (async () => {
      try {
        for await (const msg of nostr.relay(TROLLBOX_RELAY).req(
          [{ kinds: [1], "#t": [TROLLBOX_TAG], since: Math.floor(Date.now() / 1000) }],
          { signal: controller.signal },
        )) {
          if (msg[0] === "EVENT") {
            const event = msg[2] as NostrEvent;
            queryClient.setQueryData<NostrEvent[]>(["fal-live-trollbox"], (old = []) => {
              if (old.some((e) => e.id === event.id)) return old;
              return [...old, event].sort((a, b) => a.created_at - b.created_at);
            });
          }
        }
      } catch {
        // Subscription ended
      }
      setConnected(false);
    })();

    return () => controller.abort();
  }, [nostr, queryClient]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || !user) return;
    void publish({
      kind: 1,
      content: `${text} #${TROLLBOX_TAG}`,
      tags: [["t", TROLLBOX_TAG]],
      relay: TROLLBOX_RELAY,
      // Optimistic insert: the message shows instantly (same event id the
      // live subscription will deliver, so no duplicates) instead of waiting
      // on — or depending on — the relay round-trip.
      onSigned: (event) => {
        queryClient.setQueryData<NostrEvent[]>(["fal-live-trollbox"], (old = []) => {
          if (old.some((e) => e.id === event.id)) return old;
          return [...old, event].sort((a, b) => a.created_at - b.created_at);
        });
      },
    })
      .then(() => setDraft(""))
      .catch((err) => {
        // Never lose a message silently: surface the real relay reason.
        toast({
          title: "Trollbox publish failed",
          description: err instanceof Error ? err.message : String(err),
        });
        setDraft(text);
      });
  }, [draft, user, publish, queryClient, toast]);

  const short = (pk: string) => `${pk.slice(0, 8)}…`;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-muted/30">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="size-4 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1">Nostr Trollbox</span>
        <span
          className={
            "size-2 rounded-full " + (connected ? "bg-green-500" : "bg-muted-foreground")
          }
          title={connected ? "connected" : "disconnected"}
        />
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground pt-4 text-center">
            No messages yet — say hi.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="text-xs leading-snug break-words">
            <span className="font-semibold text-primary">{short(m.pubkey)}</span>
            <span className="ml-1.5 text-muted-foreground">
              {new Date(m.created_at * 1000).toLocaleTimeString()}
            </span>
            <p className="text-foreground/90">{m.content}</p>
          </div>
        ))}
      </div>
      <div className="border-t p-2">
        {user ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Chat…"
              className="h-8 text-xs"
              maxLength={280}
            />
            <Button type="submit" size="sm" className="h-8 px-2" disabled={isPending || !draft.trim()}>
              <Send className="size-3.5" />
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground px-1 py-1.5">
            Read-only — log in to chat.
          </p>
        )}
      </div>
    </aside>
  );
}

export function FalLivePage() {
  const { config } = useAppContext();

  // Expanded mode: collapse the left sidebar to its icon rail and hide the
  // right sidebar so the studio gets the full width (same pattern as
  // BaoFundingPage focus mode). The page renders its own right-side trollbox.
  useLayoutOptions({
    collapseLeftSidebar: true,
    rightSidebar: null,
    noMaxWidth: true,
    noOverscroll: true,
    wrapperClassName: "max-w-none w-full",
  });

  useSeoMeta({ title: `fal.live | ${config.appName}` });

  return (
    <main className="flex h-[100dvh]">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="size-4 mr-1.5" />
              Back
            </Link>
          </Button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sparkles className="size-4 text-primary shrink-0" />
            <h1 className="text-sm font-semibold truncate">fal.live — AI generation studio</h1>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={FAL_LIVE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 mr-1.5" />
              Original site
            </a>
          </Button>
        </div>
        <iframe
          src={FAL_LIVE_URL}
          title="fal.live AI generation studio"
          className="flex-1 w-full border-0 bg-black"
          allow="fullscreen; clipboard-write"
        />
      </div>
      <Trollbox />
    </main>
  );
}
