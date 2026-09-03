import { useSeoMeta } from '@unhead/react';
import { ExternalLink, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';

export function BaoCommunitiesPage(): React.JSX.Element {
  useSeoMeta({
    title: '2140 Community Chat',
    description: '2140 Community Chat — the authenticated, encrypted community scroll.',
  });

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
          onClick={() => void openUrl(BAO_HOSTED_ORIGIN)}
        >
          Open separately
          <ExternalLink className="ml-2 size-4" aria-hidden="true" />
        </Button>
      </header>

      <iframe
        src={BAO_HOSTED_ORIGIN}
        title="2140 Community Chat"
        className="min-h-0 flex-1 border-0 bg-black"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
      />
    </main>
  );
}
