import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, ExternalLink, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/useAppContext';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';
import { FAL_LIVE_URL } from '@/lib/falLive';

export function FalLivePage(): React.JSX.Element {
  const { config } = useAppContext();

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
      <aside className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 border-t bg-muted/30 px-6 text-center lg:w-80 lg:flex-none lg:border-l lg:border-t-0">
        <MessageSquare className="size-8 text-primary" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Trollbox</h2>
          <p className="text-muted-foreground">
            Chat opens on its authenticated origin. No room key or message is routed through the
            app's public Nostr relays.
          </p>
        </div>
        <Button onClick={() => void openUrl(BAO_HOSTED_ORIGIN)}>
          <ShieldCheck className="mr-2 size-4" />Open encrypted chat
        </Button>
      </aside>
    </main>
  );
}
