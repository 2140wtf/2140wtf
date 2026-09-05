/**
 * FalLivePage — fal.live studio iframed directly (fal.live sends no
 * X-Frame-Options and no CSP frame-ancestors, so it can be embedded
 * without a proxy).
 *
 * Chat: the right panel is the REAL 2140 Social encrypted scroll client
 * (BaoScrollChat) locked to the Trollbox room. It stays on this page —
 * no redirect, no external host. Every message is an E2E-encrypted
 * envelope posted ONLY to the single wss://2140.social/ws relay:
 *
 *  - NO kind-1 notes, NO hashtags, nothing to the app's public Nostr
 *    relays — no publish path exists in this component by construction
 *    (guarded by assertTrollboxRelayPinned at boot).
 *  - The room is PUBLIC (shared General scroll) but READ/WRITE requires
 *    an account — authed users see it, anonymous users get the join gate.
 */
import { useState } from "react";
import { useSeoMeta } from "@unhead/react";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, LogOut, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { useLoginActions } from "@/hooks/useLoginActions";
import { BaoScrollChat } from "@/components/bao/BaoScrollChat";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { BAO_TROLLBOX_ROOM } from "@/lib/baosocial/rooms";
import { FAL_LIVE_URL } from "@/lib/falLive";
import { cn } from "@/lib/utils";

/** Members-only gate for the chat panel — the room is public on the relay
 * but posting/reading is for signed-in users (2140 Social parity). */
function ChatGate() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <ShieldCheck className="size-8 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Members-only chat</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The trollbox is a 2140 Social room — sign in to join.
          </p>
        </div>
        <Button size="sm" onClick={() => setLoginOpen(true)}>Join to enter</Button>
        <p className="text-[11px] text-muted-foreground">
          No account yet?{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => setSignupOpen(true)}
          >
            Create account
          </button>
        </p>
      </div>
      <LoginDialog isOpen={loginOpen} onClose={() => setLoginOpen(false)} onLogin={() => setLoginOpen(false)} />
      <SignupDialog isOpen={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}

export function FalLivePage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { logout } = useLoginActions();
  const [chatExpanded, setChatExpanded] = useState(false);

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
    // Mobile: the studio owns all remaining height and Trollbox starts as a
    // compact bar, keeping fal.live's answer controls visible. Desktop keeps
    // the chat as a narrow full-height panel beside the studio.
    <main className="fal-live-height flex flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 sm:h-auto sm:gap-3 sm:px-4 sm:py-2">
          <Button variant="ghost" size="sm" className="size-8 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3" asChild>
            <Link to="/" aria-label="Back to home">
              <ArrowLeft className="size-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Back</span>
            </Link>
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <h1 className="truncate text-xs font-semibold sm:text-sm">fal.live — AI generation studio</h1>
          </div>
          <Button variant="outline" size="sm" className="size-8 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3" asChild>
            <a href={FAL_LIVE_URL} target="_blank" rel="noopener noreferrer" aria-label="Open original fal.live site">
              <ExternalLink className="size-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Original site</span>
            </a>
          </Button>
        </div>
        <iframe
          src={FAL_LIVE_URL}
          title="fal.live AI generation studio"
          className="min-h-0 w-full flex-1 border-0 bg-black"
          allow="fullscreen; clipboard-write"
        />
      </div>
      <aside
        className={cn(
          "flex min-h-0 flex-none flex-col border-t bg-muted/30 transition-[height] duration-200 lg:h-auto lg:w-80 lg:flex-none lg:border-l lg:border-t-0",
          chatExpanded ? "h-[min(40dvh,360px)]" : "h-11",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <MessageSquare className="size-4 shrink-0 text-primary" />
          <span className="flex-1 truncate text-xs font-bold tracking-[0.16em]">TROLLBOX</span>
          {user && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] font-semibold tracking-wide"
              onClick={() => void logout()}
            >
              <LogOut className="mr-1 size-3" />
              SIGN OUT
            </Button>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-secondary/60 hover:text-foreground lg:hidden"
            aria-label={chatExpanded ? "Collapse Trollbox" : "Expand Trollbox"}
            aria-expanded={chatExpanded}
            onClick={() => setChatExpanded((expanded) => !expanded)}
          >
            {chatExpanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
        <div className={cn("min-h-0 flex-1", !chatExpanded && "hidden lg:flex")}>
          {user ? (
            // Authed: the real encrypted 2140 Social scroll client, locked to
            // the Trollbox room. The compact parent header is the only chrome
            // shown in this embedded view.
            <BaoScrollChat lockedRoom={BAO_TROLLBOX_ROOM} embedded />
          ) : (
            <ChatGate />
          )}
        </div>
      </aside>
    </main>
  );
}
