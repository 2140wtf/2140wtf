/**
 * FalLivePage — fal.live studio iframed directly (fal.live sends no
 * X-Frame-Options and no CSP frame-ancestors, so it can be embedded
 * without a proxy).
 *
 * Chat: POSTING IS DISABLED. The earlier "trollbox" published plaintext
 * kind-1 Nostr notes to public relays — a privacy leak for a privacy-first
 * app. The Fal Live TV chat must run as an encrypted 2140 Social scroll
 * room (single relay wss://2140.social/ws, end-to-end encrypted envelopes)
 * once that room is minted on the relay host. Until then the panel shows a
 * notice only: no composer, no publish path, no public Nostr writes.
 */
import { useSeoMeta } from "@unhead/react";
import { ArrowLeft, ExternalLink, MessageSquare, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAppContext } from "@/hooks/useAppContext";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { FAL_LIVE_URL } from "@/lib/falLive";

/** Static panel — see file header for why there is no composer here. */
function ChatNotice() {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-muted/30">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="size-4 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1">Fal Live TV chat</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Chat is coming back as an encrypted 2140 Social room — messages are
          end-to-end encrypted and never touch the public Nostr network.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Posting is temporarily disabled while the room is being set up.
        </p>
      </div>
    </aside>
  );
}

export function FalLivePage() {
  const { config } = useAppContext();

  // Expanded mode: collapse the left sidebar to its icon rail and hide the
  // right sidebar so the studio gets the full width (same pattern as
  // BaoFundingPage focus mode). The page renders its own right-side panel.
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
      <ChatNotice />
    </main>
  );
}
