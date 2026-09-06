/**
 * FalLivePage — fal.live studio iframed directly (fal.live sends no
 * X-Frame-Options and no CSP frame-ancestors, so it can be embedded
 * without a proxy).
 *
 * Chat: the right panel is the REAL 2140 Trollbox encrypted scroll client
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
import { useEffect, useRef, useState } from "react";
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
 * but posting/reading is for signed-in users (members-only). */
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
            2140 Trollbox is members-only — sign in to join.
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
  const [kbOverlap, setKbOverlap] = useState(0);
  const videoColumnRef = useRef<HTMLDivElement | null>(null);
  const [pinnedVideoHeight, setPinnedVideoHeight] = useState<number | null>(null);

  // The page height reads --fal-live-dvh (see index.css .fal-live-height):
  // 100dvh recalculates as mobile browser chrome shows/hides — a URL-bar
  // collapse is often triggered by taps near the bottom edge, exactly where
  // the trollbox bar sits — and that layout churn resizes the cross-origin
  // studio iframe, pausing playback ("sometimes it stops video"). The value
  // is pinned once per session and refreshed ONLY on rotation (width change);
  // height-only changes (chrome, keyboard) never churn the layout.
  // The software keyboard is handled separately: the chat overlay lifts by
  // the visual-viewport overlap so typing stays usable — the overlay moves,
  // the iframe never does.
  useEffect(() => {
    const root = document.documentElement;
    let pinnedWidth = window.visualViewport?.width ?? window.innerWidth;
    const pinDvh = () => {
      const vv = window.visualViewport;
      root.style.setProperty("--fal-live-dvh", `${Math.round(vv?.height ?? window.innerHeight)}px`);
    };
    const sync = () => {
      const vv = window.visualViewport;
      const width = vv?.width ?? window.innerWidth;
      if (width !== pinnedWidth) {
        pinnedWidth = width; // rotation: re-pin the session height
        pinDvh();
      }
      // Keyboard overlap: gap between layout-viewport bottom and the visible
      // (visual) viewport bottom. 0 with no keyboard; >0 while typing.
      const overlap = Math.max(0, Math.round(window.innerHeight - (vv?.height ?? window.innerHeight) - (vv?.offsetTop ?? 0)));
      setKbOverlap(overlap);
    };
    pinDvh();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      root.style.removeProperty("--fal-live-dvh");
    };
  }, []);

  // Cross-origin video inside the studio iframe pauses in several mobile
  // browser engines whenever the iframe's rendered box changes size. Two
  // user actions used to trigger that:
  //   1. expanding the trollbox (the chat panel squeezed the flex-1 iframe),
  //   2. typing in the chat (the mobile keyboard resizes the layout viewport,
  //      which shrinks the 100dvh page container and the iframe with it).
  // Fix for (1): on mobile the expanded chat becomes a floating OVERLAY over
  // the video's bottom edge instead of participating in the column flow —
  // the iframe's box is identical collapsed and expanded.
  // Fix for (2): while the chat is open, pin the video column to its
  // measured pixel height (width changes — rotation — re-measure; height-only
  // changes — keyboards, URL bar — are ignored, they cannot distinguish
  // themselves from each other and must not resize the video).
  // Desktop layout (Tailwind lg) puts the chat back in flow beside the
  // video; the mobile pin and overlay are irrelevant there.
  const isDesktopLayout = () => window.matchMedia("(min-width: 1024px)").matches;

  useEffect(() => {
    if (!chatExpanded) {
      setPinnedVideoHeight(null);
      return;
    }
    const box = videoColumnRef.current;
    if (box && box.offsetHeight > 0 && !isDesktopLayout()) setPinnedVideoHeight(box.offsetHeight);
  }, [chatExpanded]);

  useEffect(() => {
    if (pinnedVideoHeight == null) return;
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastWidth) return; // height-only change (keyboard) — keep the pin
      lastWidth = window.innerWidth;
      if (isDesktopLayout()) {
        setPinnedVideoHeight(null); // side-by-side layout manages its own sizing
        return;
      }
      setPinnedVideoHeight(null); // rotation: re-measure from the fluid layout
      requestAnimationFrame(() => {
        const box = videoColumnRef.current;
        if (box && box.offsetHeight > 0) setPinnedVideoHeight(box.offsetHeight);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pinnedVideoHeight]);

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
    <main className="fal-live-height relative flex flex-col overflow-hidden lg:flex-row">
      <div
        ref={videoColumnRef}
        // Mobile: the bottom bar strip (pb-11) is reserved PERMANENTLY so the
        // iframe box is byte-identical whether the trollbox bar is collapsed
        // or expanded — the chat floats OVER the video and never resizes it.
        className="flex min-h-0 min-w-0 flex-1 flex-col pb-11 lg:pb-0"
        style={pinnedVideoHeight != null ? { flex: "1 0 auto", height: pinnedVideoHeight } : undefined}
      >
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
          // Delegated permissions are required for the cross-origin studio to
          // play on mobile: without `autoplay` the embedded player gets the
          // strictest policy (no Media Engagement history on phones), so the
          // stream never starts — desktop only worked via engagement heuristics.
          // `storage-access` lets fal.live's session state function under
          // third-party storage partitioning instead of failing silently.
          allow="autoplay; fullscreen; clipboard-write; storage-access"
        />
      </div>
      {/* Mobile: always an overlay anchored to the bottom (collapsed bar or
          expanded panel) — being out of flow, its height changes can never
          resize the cross-origin iframe, whose playback pauses in several
          mobile engines when its rendered box changes. Desktop: static side
          panel, unchanged. */}
      <aside
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col border-t bg-muted/30 transition-[height] duration-200 lg:static lg:h-auto lg:w-80 lg:flex-none lg:border-l lg:border-t-0 lg:shadow-none",
          chatExpanded
            ? "h-[min(40dvh,360px)] bg-background shadow-[0_-12px_32px_rgba(0,0,0,0.45)] lg:bg-muted/30"
            : "h-11",
        )}
        // While typing, lift the overlay above the software keyboard (inert
        // on desktop, where the aside is position:static and the inline
        // bottom is ignored).
        style={chatExpanded && kbOverlap > 0 ? { bottom: kbOverlap } : undefined}
      >
        <div className="relative flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {/* The WHOLE bar is the tap target on mobile (the chevron alone was
              ~28px and most taps missed it — "not expanding when clicked").
              Controls sit at z-10 above it and keep their own handlers; the
              chevron is decorative and tap-through (pointer-events-none). */}
          <button
            type="button"
            className="absolute inset-0 z-0 lg:hidden"
            aria-label={chatExpanded ? "Collapse Trollbox" : "Expand Trollbox"}
            aria-expanded={chatExpanded}
            onClick={() => setChatExpanded((expanded) => !expanded)}
          />
          <MessageSquare className="pointer-events-none relative z-10 size-4 shrink-0 text-primary" />
          <span className="pointer-events-none relative z-10 flex-1 truncate text-xs font-bold tracking-[0.16em]">TROLLBOX</span>
          {user && (
            <Button
              variant="ghost"
              size="sm"
              className="relative z-10 h-7 px-2 text-[10px] font-semibold tracking-wide"
              onClick={() => void logout()}
            >
              <LogOut className="mr-1 size-3" />
              SIGN OUT
            </Button>
          )}
          <span aria-hidden className="pointer-events-none relative z-10 rounded p-1 text-muted-foreground lg:hidden">
            {chatExpanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </span>
        </div>
        <div className={cn("min-h-0 flex-1", !chatExpanded && "hidden lg:flex")}>
          {user ? (
            // Authed: the real encrypted 2140 Trollbox scroll client, locked to
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
