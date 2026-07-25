import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, ExternalLink, Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/useAppContext';
import { LIGHTNING_OBSERVATORY_URL, LO_PROXY_URL } from '@/lib/lightningObservatory';

/**
 * Full 3D Lightning Observatory, iframed through the bao-lo-proxy Cloudflare
 * Worker (the origin sends X-Frame-Options: DENY; the proxy strips it and
 * rewrites asset/WebSocket URLs so the app works end-to-end through it).
 */
export function LightningObservatoryFullPage() {
  const { config } = useAppContext();

  useSeoMeta({ title: `Lightning Observatory 3D | ${config.appName}` });

  return (
    <main className="flex flex-col h-[100dvh]">
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/lightning-observatory">
            <ArrowLeft className="size-4 mr-1.5" />
            Stats
          </Link>
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Telescope className="size-4 text-primary shrink-0" />
          <h1 className="text-sm font-semibold truncate">Lightning Observatory — 3D network view</h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={LIGHTNING_OBSERVATORY_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4 mr-1.5" />
            Original site
          </a>
        </Button>
      </div>
      <iframe
        src={LO_PROXY_URL}
        title="Lightning Observatory 3D network view"
        className="flex-1 w-full border-0 bg-black"
        allow="fullscreen"
      />
    </main>
  );
}
