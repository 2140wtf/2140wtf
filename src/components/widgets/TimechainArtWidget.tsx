/**
 * TimechainArtWidget — a compact gallery of images harvested from a single
 * Nostr account's kind-1 notes.
 *
 * Defaults to the Timechain Art Magazine account (the npub embedded in
 * https://2140.wtf/npub1zrclffvv67nlda0ds8kw755lzm8yy9eavxta54qn4g8wegxzzv3q8amvxc),
 * but is fully reusable: pass any NIP-19 identifier via the `npub` prop to
 * track a different artist or curator.
 *
 * Images are pulled from two places in each note:
 *   1. NIP-94 `imeta` tags whose MIME is an image (preferred — carries
 *      `dim`/`blurhash` for nicely-sized placeholders).
 *   2. Bare https image URLs pasted directly into the note `content`.
 *
 * Every URL originates from untrusted event data and is run through
 * `sanitizeUrl()` before it ever reaches an `<img src>`, so malicious
 * `javascript:` or `http://localhost` URIs can never render.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Lightbox } from '@/components/ImageGallery';
import { useBlossomFallback } from '@/hooks/useBlossomFallback';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { IMAGE_URL_REGEX } from '@/lib/mediaUrls';
import { parseImetaMap } from '@/lib/imeta';
import { getContentWarning } from '@/lib/contentWarning';
import { cn } from '@/lib/utils';
import { ChevronRight, ExternalLink, ImageOff, ShieldAlert } from 'lucide-react';

/** The Timechain Art Magazine npub, embedded in the widget's source URL. */
export const TIMELCHAIN_ART_NPUB =
  'npub1zrclffvv67nlda0ds8kw755lzm8yy9eavxta54qn4g8wegxzzv3q8amvxc';

/** One image harvested from a kind-1 note, with its source context. */
interface ArtImage {
  /** Sanitized https URL safe to place in `<img src>`. */
  url: string;
  alt?: string;
  blurhash?: string;
  dim?: string;
  eventId: string;
  createdAt: number;
  /** NIP-36 content-warning reason, or undefined when the note is unmarked. */
  contentWarning?: string;
}

/** Decode an npub / nprofile identifier to a hex pubkey. Returns null if invalid. */
function decodeNpub(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    return null;
  }
  return null;
}

/** Pre-compute the default artist's pubkey once, at module load. */
const TIMELCHAIN_ART_PUBKEY = decodeNpub(TIMELCHAIN_ART_NPUB);

/** Global regex derived from the canonical IMAGE_URL_REGEX (safe `.match()` copy). */
const IMAGE_URLS_REGEX = new RegExp(IMAGE_URL_REGEX.source, 'gi');

/** How many recent notes to scan for images. */
const QUERY_LIMIT = 60;

/** Maximum number of images to render in the grid. */
const MAX_IMAGES = 24;

/**
 * Harvest image URLs from a single kind-1 event: imeta image entries first,
 * then bare image URLs pasted directly into the note content.
 */
function extractImagesFromEvent(event: NostrEvent): ArtImage[] {
  const imeta = parseImetaMap(event.tags);
  const content = event.content ?? '';
  const contentUrls = content.match(IMAGE_URLS_REGEX) ?? [];
  // `String.match` with a /g regex ignores lastIndex, but reset defensively
  // since IMAGE_URLS_REGEX is a shared module-level instance.
  IMAGE_URLS_REGEX.lastIndex = 0;

  const images: ArtImage[] = [];
  const seen = new Set<string>();

  // Bare (non-`image/`-prefixed) MIME types seen in the wild — e.g. Timechain
  // Art Magazine publishes `m jpeg` instead of `m image/jpeg`.
  const IMAGE_MIMES = new Set([
    'jpeg', 'jpg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic', 'heif', 'bmp',
  ]);

  // 1) imeta-tagged media: keep entries whose MIME is an image (or whose URL
  //    looks like an image). imeta is preferred because it carries metadata.
  for (const [, entry] of imeta) {
    const mime = entry.mime?.toLowerCase();
    const isImage = mime
      ? mime.startsWith('image/') || IMAGE_MIMES.has(mime)
      : IMAGE_URL_REGEX.test(entry.url);
    if (!isImage) continue;
    const url = sanitizeUrl(entry.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      alt: entry.name,
      blurhash: entry.blurhash,
      dim: entry.dim,
      eventId: event.id,
      createdAt: event.created_at,
    });
  }

  // 2) bare image URLs embedded directly in the note content.
  for (const raw of contentUrls) {
    const url = sanitizeUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const entry = imeta.get(raw) ?? imeta.get(url);
    images.push({
      url,
      alt: entry?.name,
      blurhash: entry?.blurhash,
      dim: entry?.dim,
      eventId: event.id,
      createdAt: event.created_at,
    });
  }

  return images;
}

interface TimechainArtWidgetProps {
  /** NIP-19 pubkey (or nprofile) to source art from. Defaults to Timechain Art Magazine. */
  npub?: string;
  /** How many recent notes to scan for images. */
  limit?: number;
  /** Optional className applied to the grid wrapper. */
  className?: string;
}

/** How often the gallery rotates to the next image (21 min 40 s). */
export const ROTATE_INTERVAL_MS = 21 * 60 * 1000 + 40 * 1000;

/** Max time to wait for an image before swapping to a fallback Blossom server. */
const LOAD_TIMEOUT_MS = 8_000;

/** Parse an imeta `dim` value like "1038.0x1015.0" into integer dimensions. */
function parseDim(dim?: string): { w: number; h: number } | null {
  if (!dim) return null;
  const m = dim.match(/^([\d.]+)x([\d.]+)$/);
  if (!m) return null;
  const w = Math.round(parseFloat(m[1]));
  const h = Math.round(parseFloat(m[2]));
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Compact art gallery widget.
 *
 * Fetches kind-1 notes from the given (default: Timechain Art Magazine) pubkey,
 * harvests every image, and shows ONE image at a time — rotating automatically
 * down the history (newest → oldest) every 21 min 40 s. A next/skip button
 * lets the user advance manually. Clicking the image opens the shared
 * full-screen `Lightbox` with arrow navigation, a counter, and a bottom bar
 * showing the note caption and a link to the source post.
 */
export function TimechainArtWidget({
  npub = TIMELCHAIN_ART_NPUB,
  limit = QUERY_LIMIT,
  className,
}: TimechainArtWidgetProps) {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  // Resolve the target pubkey (decoded now, or the pre-computed default).
  const pubkey = useMemo<string | undefined>(
    () => decodeNpub(npub) ?? TIMELCHAIN_ART_PUBKEY ?? undefined,
    [npub],
  );

  const {
    data: events,
    isPending,
    isError,
  } = useQuery<NostrEvent[]>({
    queryKey: ['widget-timechain-art', pubkey, limit],
    queryFn: async () => {
      if (!pubkey) return [];
      return nostr.query(
        [{ kinds: [1], authors: [pubkey], limit }],
        { signal: AbortSignal.timeout(8000) },
      );
    },
    // Don't fire until a valid pubkey is available.
    enabled: !!pubkey,
    staleTime: 5 * 60_000,
  });

  // Flatten, de-duplicate globally, drop CW images per policy, cap the grid.
  const images = useMemo(() => {
    const seen = new Set<string>();
    const all = (events ?? [])
      .flatMap((ev) => {
        const cw = getContentWarning(ev);
        const imgs = extractImagesFromEvent(ev);
        if (cw !== undefined) imgs.forEach((i) => (i.contentWarning = cw));
        return imgs;
      })
      .filter((img) => {
        if (!img.contentWarning) return true;
        return config.contentWarningPolicy !== 'hide';
      })
      .filter((img) => {
        if (seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });
    // Newest first so the freshest art tops the grid.
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, MAX_IMAGES);
  }, [events, config.contentWarningPolicy]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Index of the currently displayed image in the rotating gallery. Starts at
  // the newest image and advances down the history on an interval.
  const [displayIndex, setDisplayIndex] = useState(0);
  const current = images[Math.min(displayIndex, images.length - 1)];

  // Auto-rotate every 21 min 40 s. The interval always calls the functional
  // updater, so a manual skip simply moves the pointer and the timer keeps
  // stepping from wherever it landed. Clamped modulo in case `images` shrinks.
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayIndex((i) => (images.length ? (i + 1) % images.length : 0));
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [images.length]);

  // Reset to the newest image whenever the image list itself changes.
  useEffect(() => {
    setDisplayIndex(0);
  }, [images]);

  // Author lookup + derived values. These hooks MUST run before the early
  // returns below (React rules-of-hooks): `useAuthor` is a no-op query when
  // `pubkey` is undefined — it is internally `enabled: !!pubkey`.
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.name || metadata?.display_name || 'Timechain Art';

  // Link to the source note of the currently displayed image (lightbox bottom
  // bar + attribution). Only computed when there's an image — safe no-op otherwise.
  const sourceNote = useMemo(() => {
    const img = images[Math.min(displayIndex, images.length - 1)];
    return img && pubkey
      ? nip19.neventEncode({ id: img.eventId, author: pubkey })
      : undefined;
  }, [images, displayIndex, pubkey]);

  // Per-image imeta metadata for the lightbox (no-op when the grid is empty).
  const mediaMeta = useMemo(
    () => images.map((img) => ({ dim: img.dim, blurhash: img.blurhash })),
    [images],
  );

  if (!pubkey) {
    return (
      <p className="text-sm text-muted-foreground p-1" role="status">
        Invalid artist pubkey.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className={cn('p-1', className)}>
        <Skeleton className="w-full h-48 rounded-lg" />
      </div>
    );
  }

  if (isError || images.length === 0) {
    return (
      <div className={cn('p-1', className)}>
        <p className="text-sm text-muted-foreground">
          {isError ? 'Failed to load artwork.' : 'No images yet.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={cn('flex flex-col', className)}>
        {/* Single rotating image. Click opens the lightbox at this position. */}
        <ArtTile
          img={current}
          revealBlurred={
            current.contentWarning !== undefined &&
            config.contentWarningPolicy === 'blur'
          }
          fill
          onClick={() => setLightboxIndex(displayIndex)}
        />

        {/* Controls: position indicator + skip-to-next button. */}
        <div className="flex items-center justify-between px-1 pt-1.5">
          <span
            className="text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {displayIndex + 1} / {images.length}
          </span>
          <button
            type="button"
            onClick={() =>
              setDisplayIndex((i) => (i + 1) % images.length)
            }
            aria-label="Next artwork"
            title="Next artwork"
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Next
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Attribution strip: artist name + a link to the source note. */}
      <div className="flex items-center justify-between px-1 py-1.5 text-xs text-muted-foreground">
        <Link to={`/${npub}`} className="hover:text-foreground hover:underline">
          @ {displayName}
        </Link>
        <Link
          to={`/${sourceNote}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 hover:text-foreground hover:underline"
        >
          Source note
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={images.map((i) => i.url)}
          mediaTypes={images.map(() => 'image')}
          mediaMeta={mediaMeta}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNext={() =>
            setLightboxIndex((i) =>
              i === null ? null : Math.min(i + 1, images.length - 1),
            )
          }
          onPrev={() =>
            setLightboxIndex((i) =>
              i === null ? null : Math.max(i - 1, 0),
            )
          }
          topBarLeft={
            <span className="text-white/80 text-sm font-medium tabular-nums">
              {lightboxIndex + 1} / {images.length}
            </span>
          }
          bottomBar={
            <ArtLightboxBottomBar
              img={images[lightboxIndex]!}
              pubkey={pubkey}
            />
          }
        />
      )}
    </>
  );
}

/** Single image tile with a blurhash/skeleton placeholder while it loads. */
function ArtTile({
  img,
  revealBlurred,
  fill = false,
  onClick,
}: {
  img: ArtImage;
  revealBlurred: boolean;
  /** Fill mode: full-width, flexible height (rotating gallery) instead of a square tile. */
  fill?: boolean;
  onClick: () => void;
}) {
  const { src, onError, failed } = useBlossomFallback(img.url);
  const [loaded, setLoaded] = useState(false);
  // Only set once `src` has been verified to return a real image response.
  const [verifiedSrc, setVerifiedSrc] = useState<string | null>(null);

  // Some Blossom hosts answer missing blobs with a 404 status whose body is
  // still a decodable placeholder JPEG ("image not found" from nostr.build),
  // and others (blossom.primal.net from some networks) accept the TCP
  // connection but never respond — in both cases `<img>` fires onLoad/onError
  // uselessly and the tile shows junk or stays blank. So preflight each URL
  // with fetch and only render the <img> once the server returned a real
  // 2xx image response; anything else advances to the next fallback server.
  useEffect(() => {
    let cancelled = false;
    setVerifiedSrc(null);
    setLoaded(false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await fetch(src, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) {
          onError();
          return;
        }
        // nostr.build serves HTTP 200 for missing blobs — a fixed 512x512
        // "image not found" placeholder JPEG that is always exactly 64096
        // bytes. Detect it by content length (header when present, body
        // size otherwise) and treat it as a miss.
        const PLACEHOLDER_SIZE = '64096';
        if (res.headers.get('content-length') === PLACEHOLDER_SIZE) {
          onError();
          return;
        }
        if (res.headers.get('content-length') === null) {
          const blob = await res.blob();
          if (blob.size === Number(PLACEHOLDER_SIZE)) {
            onError();
            return;
          }
        }
        setVerifiedSrc(src);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Hung connection — skip to the next fallback server.
          onError();
        } else {
          // CORS or network-level failure: we can't preflight this host, so
          // let <img> try anyway (it may render fine without CORS).
          setVerifiedSrc(src);
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [src, onError]);

  // Once every fallback server has been exhausted, there's no point holding
  // an empty tile.
  if (failed && !verifiedSrc) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="View artwork"
      className={cn(
        'relative w-full rounded-lg overflow-hidden bg-secondary/30 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        fill ? 'h-full min-h-40' : 'aspect-square',
      )}
    >
      {revealBlurred && (
        <div className="absolute inset-0 flex items-center justify-center z-10 rounded-lg">
          <div className="absolute inset-0 bg-muted/60" />
          <ShieldAlert className="relative size-5 text-muted-foreground" />
        </div>
      )}
      {!loaded && (
        <Skeleton className="absolute inset-0 w-full h-full rounded-lg" />
      )}
      {verifiedSrc && (
        <img
          src={verifiedSrc}
          alt={img.alt ?? 'Art'}
          loading="lazy"
          onLoad={(e) => {
            // Placeholder detection: nostr.build serves missing blobs as a
            // 512x512 thumbnail of the original stamped with "image not
            // found". If the served size doesn't match the imeta `dim`, it's
            // a placeholder — skip to the next fallback server.
            const expected = parseDim(img.dim);
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (expected && (naturalWidth !== expected.w || naturalHeight !== expected.h)) {
              onError();
              return;
            }
            setLoaded(true);
          }}
          onError={() => onError()}
          className={cn(
            'absolute inset-0 h-full w-full transition-opacity duration-200',
            fill ? 'object-contain' : 'object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {failed && !verifiedSrc && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60"
          aria-label="Artwork unavailable"
        >
          <ImageOff className="size-5" />
          <span className="text-[10px] uppercase tracking-wider">Unavailable</span>
        </div>
      )}
    </button>
  );
}

/** Bottom bar for the lightbox: the note's caption + a link to the source post. */
function ArtLightboxBottomBar({
  img,
  pubkey,
}: {
  img: ArtImage;
  pubkey: string;
}) {
  const encoded = nip19.neventEncode({ id: img.eventId, author: pubkey });
  const caption = img.alt || '';
  return (
    <Link
      to={`/${encoded}`}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="size-3 shrink-0" />
      <span className="truncate">
        {caption
          ? `${caption.slice(0, 120)}${caption.length > 120 ? '…' : ''}`
          : 'Open note on 2140.wtf'}
      </span>
    </Link>
  );
}


