import type { NostrEvent } from '@nostrify/nostrify';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ExternalFavicon } from '@/components/ExternalFavicon';
import { NsitePermissionManager } from '@/components/NsitePermissionManager';
import { NsitePermissionPrompt } from '@/components/NsitePermissionPrompt';
import { SandboxFrame } from '@/components/SandboxFrame';
import { useCenterColumn } from '@/contexts/LayoutContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNsiteSignerRpc } from '@/hooks/useNsiteSignerRpc';
import { APP_BLOSSOM_SERVERS, getEffectiveBlossomServers } from '@/lib/appBlossom';
import { deriveIframeSubdomain } from '@/lib/iframeSubdomain';
import { getNsiteNostrProviderScript } from '@/lib/nsiteNostrProvider';
import { getNsiteSubdomain } from '@/lib/nsiteSubdomain';
import { getPreviewInjectedScript } from '@/lib/previewInjectedScript';
import { getMimeType } from '@/lib/sandbox';
import type { FileResponse, InjectedScript } from '@/lib/sandbox';
import {
  buildNsiteManifest,
  isSafeNsitePath,
  resolveNsiteServers,
  verifyNsiteContent,
} from '@/lib/nsiteContent';

interface Rect { left: number; top: number; width: number; height: number }

/** Track the viewport-relative bounding rect of an element, updating on resize. */
function useElementRect(el: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!el) { setRect(null); return; }

    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [el]);

  return rect;
}

/**
 * Module-level preferred server. Once a Blossom server successfully serves
 * a blob, it is promoted here so subsequent requests try it first.
 */
let preferredServer: string | null = null;

/** Fetch a verified blob from the trusted Blossom server list. */
async function fetchFromBlossom(sha256: string, servers: string[]): Promise<Uint8Array> {
  let lastError: unknown;
  const orderedServers = preferredServer && servers.includes(preferredServer)
    ? [preferredServer, ...servers.filter((server) => server !== preferredServer)]
    : servers;

  for (const server of orderedServers) {
    const base = server.replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/${sha256}`);
      if (!res.ok) continue;
      const body = new Uint8Array(await res.arrayBuffer());
      if (!verifyNsiteContent(body, sha256)) {
        lastError = new Error(`Blossom server returned content with an invalid hash: ${server}`);
        continue;
      }
      preferredServer = server;
      return body;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error(`Failed to fetch verified blob ${sha256} from all servers`);
}

interface NsitePreviewDialogProps {
  /** The nsite event (kind 15128 or 35128) containing path and server tags. */
  event: NostrEvent;
  /** Display name for the app. */
  appName: string;
  /** Optional app icon URL. */
  appPicture?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * An in-app preview panel that covers the center column and loads an nsite in
 * a sandboxed iframe.
 *
 * Files are served directly from Blossom servers using the manifest data
 * embedded in the nsite event's `path` tags. Each path tag maps a file path
 * to its sha256 hash, which is used to construct a Blossom content-addressed URL.
 *
 * The panel is portaled into the center column DOM element (via CenterColumnContext)
 * and uses `position: fixed` to fill the viewport column area.
 */
export function NsitePreviewDialog({ event, appName, appPicture, open, onOpenChange }: NsitePreviewDialogProps) {
  const centerColumn = useCenterColumn();
  const columnRect = useElementRect(open ? centerColumn : null);
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  // Use the NIP-5A canonical subdomain as the stable identifier, then derive
  // a private HMAC-SHA256 subdomain so the raw identifier is never exposed as
  // a sandbox origin (preventing cross-app localStorage/IndexedDB collisions).
  const nsiteSubdomain = getNsiteSubdomain(event);
  const siteUrl = `https://${nsiteSubdomain}.nsite.lol`;
  const previewSubdomain = useMemo(() => deriveIframeSubdomain(config.appId, 'nsite', nsiteSubdomain), [config.appId, nsiteSubdomain]);

  // NIP-07 signer proxy — only active when a user is logged in.
  const signerRpc = useNsiteSignerRpc({
    siteId: nsiteSubdomain,
    siteName: appName,
  });

  // Build the manifest and server list from the event (memoised per event identity)
  const manifest = useRef<Map<string, string>>(new Map());
  const servers = useRef<string[]>([]);

  useEffect(() => {
    manifest.current = buildNsiteManifest(event);
    const appServers = getEffectiveBlossomServers(
      config.blossomServerMetadata,
      config.useAppBlossomServers ?? true,
    );
    servers.current = resolveNsiteServers(event, appServers.length > 0 ? appServers : APP_BLOSSOM_SERVERS.servers);
  }, [event, config.blossomServerMetadata, config.useAppBlossomServers]);

  /** Injected scripts: SPA path normalisation + NIP-07 provider (when logged in). */
  const injectedScripts = useMemo<InjectedScript[]>(() => {
    const scripts: InjectedScript[] = [{
      path: '__injected__/preview.js',
      content: getPreviewInjectedScript(),
    }];

    // When a user is logged in, inject a NIP-07 provider so the nsite can
    // use window.nostr to interact with the user's signer. The parent origin
    // is passed explicitly — document.referrer is always empty under the
    // app's global no-referrer policy, so the provider cannot infer it.
    if (user) {
      scripts.push({
        path: '__injected__/nostr-provider.js',
        content: getNsiteNostrProviderScript(
          user.pubkey,
          typeof window !== 'undefined' ? window.location.origin : undefined,
        ),
      });
    }

    return scripts;
  }, [user]);

  /** Resolve a pathname to file content from the Blossom manifest. */
  const resolveFile = useCallback(async (pathname: string): Promise<FileResponse | null> => {
    // Only resolve canonical paths from the iframe protocol. Invalid paths
    // must not be allowed to select an arbitrary manifest entry.
    if (!isSafeNsitePath(pathname)) return null;

    // If not found, fall back to /index.html (SPA client-side routing).
    let sha256 = manifest.current.get(pathname);
    let servingPath = pathname;

    if (!sha256) {
      sha256 = manifest.current.get('/index.html');
      servingPath = '/index.html';
    }

    if (!sha256) return null;

    // Fetch and verify the content-addressed blob before serving it to the
    // sandbox. A compromised/misbehaving mirror must not inject arbitrary JS.
    const body = await fetchFromBlossom(sha256, servers.current);

    // Always determine content type from the file extension.
    // Blossom servers commonly return incorrect types (e.g. text/plain for .js
    // files), which causes browsers to reject module scripts. The file path from
    // the manifest is authoritative for the correct MIME type.
    const contentType = getMimeType(servingPath);

    return { status: 200, contentType, body };
  }, []);

  if (!open || !centerColumn || !columnRect) return null;

  // If the user has scrolled down, columnRect.top is negative (the column top
  // is above the viewport). Clamp to 0 so the panel always starts at the
  // viewport top edge and never grows taller than the viewport.
  const panelTop = Math.max(0, columnRect.top);
  const panelHeight = window.innerHeight - panelTop;

  return createPortal(
    <div
      className="fixed z-50 flex flex-col bg-background"
      style={{
        left: columnRect.left,
        top: panelTop,
        width: columnRect.width,
        height: panelHeight,
      }}
    >
      {/* Nav bar */}
      <div className="min-h-11 border-b bg-muted/30 shrink-0 safe-area-top">
        <div className="px-3 py-2 flex items-center gap-2 w-full">
          {/* App icon + name */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {appPicture ? (
              <img
                src={appPicture}
                alt={appName}
                className="size-6 rounded-md object-cover shrink-0"
              />
            ) : (
              <div className="size-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <ExternalFavicon
                  url={siteUrl}
                  size={18}
                  fallback={<Package className="size-3.5 text-primary/50" />}
                />
              </div>
            )}
            <span className="text-sm font-medium truncate">{appName}</span>
          </div>

          {/* Permissions manager (only when logged in) */}
          {user && (
            <NsitePermissionManager siteId={nsiteSubdomain} />
          )}

          {/* Close */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => onOpenChange(false)}
            title="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Sandboxed iframe */}
      <div className="flex-1 min-h-0 bg-background relative">
        <SandboxFrame
          key={`${previewSubdomain}-${open}`}
          id={previewSubdomain}
          resolveFile={resolveFile}
          onRpc={user ? signerRpc.onRpc : undefined}
          injectedScripts={injectedScripts}
          className="w-full h-full border-0"
          title={`${appName} preview`}
        />

        {/* Permission prompt overlay */}
        {signerRpc.pendingPrompt && (
          <NsitePermissionPrompt
            appPicture={appPicture}
            appName={appName}
            siteUrl={siteUrl}
            prompt={signerRpc.pendingPrompt}
            onResolve={signerRpc.resolvePrompt}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
