/**
 * 2140 Social — encrypted community scroll, in-app.
 *
 * Page shell: SEO header + members-only auth gate. The chat itself lives in
 * the reusable BaoScrollChat component (extracted so the same encrypted
 * client also powers the Fal Live TV trollbox panel). Rooms, identity,
 * receipts and the scroll are all handled there.
 */
import { useState } from "react";
import { useSeoMeta } from "@unhead/react";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { BaoScrollChat } from "@/components/bao/BaoScrollChat";

export function BaoCommunitiesPage() {
  useSeoMeta({
    title: "2140 Community Chat",
    description: "2140 Community Chat — encrypted community scroll on Nostr, inside 2140.",
  });

  const { user } = useCurrentUser();
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  if (!user) {
    return (
      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">2140 Community Chat</h1>
        </div>
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
          <ShieldCheck className="size-10 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold">Members-only encrypted chat</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              2140 Community Chat is an encrypted, burner-keyed community scroll. Sign in
              to join the rooms — your identity key never touches the chat wire.
            </p>
          </div>
          <Button onClick={() => setLoginOpen(true)}>Join to enter</Button>
          <p className="text-xs text-muted-foreground">
            No account yet?{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setSignupOpen(true)}
            >
              Create account
            </button>
          </p>
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
      </main>
    );
  }

  // Authed: mount the shared encrypted scroll client (multi-room mode — the
  // full directory sidebar, including the Trollbox FAL TV room).
  return <BaoScrollChat />;
}
