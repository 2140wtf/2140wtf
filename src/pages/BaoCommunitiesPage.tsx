import { useSeoMeta } from '@unhead/react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const CHAT_AUTH_REQUEST = '2140-chat-auth-request';
const CHAT_AUTH_RESPONSE = '2140-chat-auth-response';
const CHAT_AUTH_OFFER = '2140-chat-auth-offer';

interface ChatAuthRequest {
  type: typeof CHAT_AUTH_REQUEST;
  requestId: string;
  challenge: string;
}

function parseChatAuthRequest(data: unknown): ChatAuthRequest | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (
    value.type !== CHAT_AUTH_REQUEST ||
    typeof value.requestId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.requestId) ||
    typeof value.challenge !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.challenge)
  ) return null;
  return value as unknown as ChatAuthRequest;
}

export function BaoCommunitiesPage(): React.JSX.Element {
  const { user } = useCurrentUser();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const offerParentAuth = useCallback(() => {
    if (!user) return;
    iframeRef.current?.contentWindow?.postMessage({
      type: CHAT_AUTH_OFFER,
      pubkey: user.pubkey,
    }, BAO_HOSTED_ORIGIN);
  }, [user]);

  useEffect(() => {
    const receiveChatAuthRequest = (message: MessageEvent<unknown>) => {
      if (message.origin !== BAO_HOSTED_ORIGIN || message.source !== iframeRef.current?.contentWindow) return;
      const request = parseChatAuthRequest(message.data);
      if (!request || !user) return;

      void user.signer.signEvent({
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['challenge', request.challenge],
          ['relay', `${BAO_HOSTED_ORIGIN.replace(/^http/, 'ws')}/ws`],
        ],
        content: '',
      }).then((event) => {
        iframeRef.current?.contentWindow?.postMessage({
          type: CHAT_AUTH_RESPONSE,
          requestId: request.requestId,
          event,
        }, BAO_HOSTED_ORIGIN);
      }).catch(() => {
        iframeRef.current?.contentWindow?.postMessage({
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

  useSeoMeta({
    title: '2140 Social Chat',
    description: '2140 Social Chat — the authenticated, encrypted community scroll.',
  });

  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-[36rem] flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="truncate text-base font-semibold">2140 Social Chat</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Encrypted on the dedicated chat relay
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void openUrl(BAO_HOSTED_ORIGIN)}
        >
          Open separately
          <ExternalLink className="ml-2 size-4" aria-hidden="true" />
        </Button>
      </header>

      <iframe
        ref={iframeRef}
        onLoad={offerParentAuth}
        src={BAO_HOSTED_ORIGIN}
        title="2140 Social Chat"
        className="min-h-0 flex-1 border-0 bg-black"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
      />
    </main>
  );
}
