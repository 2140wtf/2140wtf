/**
 * FalLivePage — fal.live studio iframed directly (fal.live sends no
 * X-Frame-Options and no CSP frame-ancestors, so it can be embedded
 * without a proxy).
 *
 * Chat: the right panel is the REAL 2140 Social encrypted scroll client
 * (BaoScrollChat) locked to the Trollbox FAL TV room. Every message is an
 * E2E-encrypted envelope on the single wss://2140.social/ws relay — nothing
 * is ever published to public Nostr (no kind-1 notes, no hashtags). The
 * historical kind-1 "#fallive" trollbox is deleted; this panel has no
 * public publish path by construction.
 */
import { useState } from "react";
import { useSeoMeta } from "@unhead/react";
import { ArrowLeft, ExternalLink, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { BaoScrollChat } from "@/components/bao/BaoScrollChat";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { BAO_TROLLBOX_ROOM } from "@/lib/baosocial/rooms";
import { FAL_LIVE_URL } from "@/lib/falLive";

/** Members-only gate for the chat panel (2140 Social parity — entering the
 *  encrypted chat requires an account; the identity module then decides how
 *  to appear inside the envelope). */
function ChatGate() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="size-4 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1 truncate">Trollbox FAL TV</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <ShieldCheck className="size-8 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Members-only encrypted chat</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            The trollbox is an encrypted 2140 Social room — sign in to join.
            Messages never leave the encrypted scroll.
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
      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={() => setLoginOpen(false)}
        onSignupClick={() => {
          setLoginOpen(false);
          setSignupOpen(true);
        }}
      />
      <SignupDialog isOpen={signupOpen} onClose={() => setSignupOpen(false)} />
    </div>
  );
}

export function FalLivePage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();

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
    // Mobile: stack — studio on top, chat below (video keeps ~55dvh, chat
    // takes the rest). Desktop: side-by-side — studio flex-1, chat w-80.
    <main className="flex h-[100dvh] flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          className="h-[55dvh] w-full flex-none border-0 bg-black lg:h-auto lg:flex-1"
          allow="fullscreen; clipboard-write"
        />
      </div>
      <aside className="flex min-h-0 flex-1 flex-col border-t bg-muted/30 lg:w-80 lg:flex-none lg:border-l lg:border-t-0">
        {user ? (
          // Authed: the real encrypted 2140 Social scroll client, locked to
          // the Trollbox FAL TV room (embedded — parent provides the height).
          // No kind-1 publish path exists here.
          <BaoScrollChat lockedRoom={BAO_TROLLBOX_ROOM} embedded />
        ) : (
          <ChatGate />
        )}
      </aside>
    </main>
  );
}
