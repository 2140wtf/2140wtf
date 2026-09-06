import { useSeoMeta } from '@unhead/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { BaoScrollChat } from '@/components/bao/BaoScrollChat';
import { BAO_TROLLBOX_ROOM } from '@/lib/baosocial/rooms';
import LoginDialog from '@/components/auth/LoginDialog';
import SignupDialog from '@/components/auth/SignupDialog';
import { Button } from '@/components/ui/button';
import { MessageSquare, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

/**
 * Trollbox — the public encrypted community room of 2140 Trollbox, presented
 * in-page (no hosted-app iframe, no room directory, no masthead). The scroll
 * client is locked to the Trollbox room on wss://2140.social/ws; nothing is
 * ever published to the app's public Nostr relays.
 */
export function BaoCommunitiesPage(): React.JSX.Element {
  useLayoutOptions({
    collapseLeftSidebar: true,
    rightSidebar: null,
    noMaxWidth: true,
    noOverscroll: true,
    wrapperClassName: 'max-w-none w-full',
  });

  useSeoMeta({
    title: 'Trollbox',
    description: 'Trollbox — the public encrypted community room on 2140 Trollbox.',
  });

  const { user } = useCurrentUser();
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-[36rem] flex-col overflow-hidden bg-background">
      {user ? (
        <BaoScrollChat lockedRoom={BAO_TROLLBOX_ROOM} embedded />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <MessageSquare className="size-4 shrink-0 text-primary" />
            <span className="flex-1 truncate text-sm font-semibold">trollbox</span>
          </div>
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
              No account yet?{' '}
              <button
                type="button"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setSignupOpen(true)}
              >
                Create account
              </button>
            </p>
          </div>
        </div>
      )}
      <LoginDialog isOpen={loginOpen} onClose={() => setLoginOpen(false)} onLogin={() => setLoginOpen(false)} />
      <SignupDialog isOpen={signupOpen} onClose={() => setSignupOpen(false)} />
    </main>
  );
}

export default BaoCommunitiesPage;
