import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, ExternalLink, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import { FAL_LIVE_URL } from '@/lib/falLive';

const CHAT_AUTH_REQUEST = '2140-chat-auth-request';
const CHAT_AUTH_RESPONSE = '2140-chat-auth-response';
const CHAT_AUTH_OFFER = '2140-chat-auth-offer';

function parseChatAuthRequest(data: unknown): { requestId: string; challenge: string } | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (
    value.type !== CHAT_AUTH_REQUEST ||
    typeof value.requestId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.requestId) ||
    typeof value.challenge !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.challenge)
  ) return null;
  return { requestId: value.requestId, challenge: value.challenge };
}

export function FalLivePage(): React.JSX.Element {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const chatFrameRef = useRef<HTMLIFrameElement>(null);

  const offerParentAuth = useCallback(() => {
    if (!user) return;
    chatFrameRef.current?.contentWindow?.postMessage({
      type: CHAT_AUTH_OFFER,
      pubkey: user.pubkey,
    }, BAO_HOSTED_ORIGIN);
  }, [user]);

  useEffect(() => {
    const receiveChatAuthRequest = (message: MessageEvent<unknown>) => {
      if (message.origin !== BAO_HOSTED_ORIGIN || message.source !== chatFrameRef.current?.contentWindow || !user) return;
      const request = parseChatAuthRequest(message.data);
      if (!request) return;
      void user.signer.signEvent({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['challenge', request.challenge],
          ['relay', `${BAO_HOSTED_ORIGIN.replace(/^http/, 'ws')}/ws`],
        ],
        content: '',
      }).then((event) => {
        chatFrameRef.current?.contentWindow?.postMessage({
          type: CHAT_AUTH_RESPONSE,
          requestId: request.requestId,
          event,
        }, BAO_HOSTED_ORIGIN);
      }).catch(() => {
        chatFrameRef.current?.contentWindow?.postMessage({
          type: CHAT_AUTH_RESPONSE,
          requestId: request.requestId,
          error: 'signature declined',
        }, BAO_HOSTED_ORIGIN);
      });
    };
    window.addEventListener('message', receiveChatAuthRequest);
    return () => window.removeEventListener('message', receiveChatAuthRequest);
  }, [user]);

  useEffect(offerParentAuth, [offerParentAuth]);

  useLayoutOptions({
    collapseLeftSidebar: true,
    rightSidebar: null,
    noMaxWidth: true,
    noOverscroll: true,
    wrapperClassName: 'max-w-none w-full',
  });
  useSeoMeta({ title: `fal.live | ${config.appName}` });

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="mr-1.5 size-4" />Back</Link>
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <h1 className="truncate text-sm font-semibold">fal.live — AI generation studio</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void openUrl(FAL_LIVE_URL)}>
            <ExternalLink className="mr-1.5 size-4" />Original site
          </Button>
        </div>
        <iframe
          src={FAL_LIVE_URL}
          title="fal.live AI generation studio"
          className="h-[55dvh] w-full flex-none border-0 bg-black lg:h-auto lg:flex-1"
          allow="fullscreen; clipboard-write"
        />
      </div>
      <aside className="flex min-h-0 flex-1 flex-col border-t bg-black lg:w-96 lg:flex-none lg:border-l lg:border-t-0">
        <iframe
          ref={chatFrameRef}
          onLoad={offerParentAuth}
          src={`${BAO_HOSTED_ORIGIN}/?room=trollbox`}
          title="2140 Social Chat Trollbox"
          className="min-h-0 flex-1 border-0"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      </aside>
    </main>
  );
}
