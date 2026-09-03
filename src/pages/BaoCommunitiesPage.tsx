import { useSeoMeta } from '@unhead/react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import {
  buildChatAuthErrorResponse,
  buildChatAuthOffer,
  buildChatAuthResponse,
  buildChatAuthTemplate,
  CHAT_TARGET_ORIGIN,
  isChatAuthRequest,
} from '@/lib/baosocial/chatParentAuth';

/**
 * 2140 Community Chat, embedded.
 *
 * The hosted origin serves a server-side auth gate when there is no
 * `bao_auth` session cookie — and inside an iframe that cookie is
 * third-party partitioned, so the gate's own login can loop forever. The
 * deployed gate therefore listens for an auth OFFER from its parent and
 * answers with a challenge for the parent's signer (see chatParentAuth.ts).
 * Completing the handshake sets the chat session and reloads the iframe
 * into the real chat.
 */
export function BaoCommunitiesPage(): React.JSX.Element {
  useSeoMeta({
    title: '2140 Community Chat',
    description: '2140 Community Chat — the authenticated, encrypted community scroll.',
  });

  const { user } = useCurrentUser();
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Pubkey we already offered to this frame load, so we don't loop the handshake. */
  const offeredPubkeyRef = useRef<string | null>(null);

  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    const onMessage = (message: MessageEvent) => {
      if (message.origin !== BAO_HOSTED_ORIGIN) return;
      if (message.source !== frameRef.current?.contentWindow) return;
      if (!isChatAuthRequest(message.data)) return;

      const { requestId, challenge } = message.data;

      if (!user) {
        frameRef.current?.contentWindow?.postMessage(
          buildChatAuthErrorResponse(requestId, 'not logged in on 2140.wtf'),
          CHAT_TARGET_ORIGIN,
        );
        return;
      }

      const signer = user.signer;
      void (async () => {
        try {
          const event = await signer.signEvent(buildChatAuthTemplate(challenge));
          frameRef.current?.contentWindow?.postMessage(
            buildChatAuthResponse(requestId, event),
            CHAT_TARGET_ORIGIN,
          );
        } catch (error) {
          frameRef.current?.contentWindow?.postMessage(
            buildChatAuthErrorResponse(
              requestId,
              error instanceof Error ? error.message : 'signing failed',
            ),
            CHAT_TARGET_ORIGIN,
          );
        }
      })();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [user]);

  // Offer the current identity to the chat gate once per frame load. The gate
  // only consumes the FIRST valid offer (it removes its listener after the
  // first), so re-offer on the same load is a no-op by design.
  useEffect(() => {
    if (!user) return;
    if (offeredPubkeyRef.current === user.pubkey) return;
    offeredPubkeyRef.current = user.pubkey;
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(buildChatAuthOffer(user.pubkey), CHAT_TARGET_ORIGIN);
  }, [user, frameKey]);

  const handleIframeLoad = () => {
    // New document: reset the offer bookkeeping, then offer again.
    offeredPubkeyRef.current = null;
  };

  // Re-run the offer after each (re)load — frameKey bumps force a remount.
  useEffect(() => {
    offeredPubkeyRef.current = null;
  }, [frameKey]);

  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-[36rem] flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="truncate text-base font-semibold">2140 Community Chat</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Encrypted on the dedicated chat relay
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setFrameKey((k) => k + 1);
            void openUrl(BAO_HOSTED_ORIGIN);
          }}
        >
          Open separately
          <ExternalLink className="ml-2 size-4" aria-hidden="true" />
        </Button>
      </header>

      <iframe
        key={frameKey}
        ref={frameRef}
        src={`${BAO_HOSTED_ORIGIN}/?embed=${frameKey}`}
        title="2140 Community Chat"
        className="min-h-0 flex-1 border-0 bg-black"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
        onLoad={handleIframeLoad}
      />
    </main>
  );
}
