import { useSeoMeta } from '@unhead/react';
import { ExternalLink, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openUrl } from '@/lib/downloadFile';
import { BAO_HOSTED_ORIGIN } from '@/lib/baosocial/relayPolicy';

export function BaoCommunitiesPage(): React.JSX.Element {
  useSeoMeta({
    title: '2140 Community Chat',
    description: 'Open the authenticated, encrypted ₿AO Chat application.',
  });

  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-xl space-y-6 rounded-xl border bg-card p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto size-12 text-primary" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">2140 Community Chat</h1>
          <p className="text-lg text-muted-foreground">
            Room discovery and authentication run on the dedicated chat origin so private room
            capabilities are never bundled into this public Nostr client.
          </p>
        </div>
        <Button size="lg" onClick={() => void openUrl(BAO_HOSTED_ORIGIN)}>
          Open encrypted chat <ExternalLink className="ml-2 size-4" />
        </Button>
        <p className="text-sm text-muted-foreground">
          Chat uses only <code>wss://2140.social/ws</code>. If it is unavailable, the app will not
          fall back to a public relay.
        </p>
      </section>
    </main>
  );
}
