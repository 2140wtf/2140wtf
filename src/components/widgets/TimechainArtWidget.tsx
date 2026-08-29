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

import { useMemo, useState } from 'react';
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
import { ExternalLink, ShieldAlert } from 'lucide-react';

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

  // 1) imeta-tagged media: keep entries whose MIME is an image (or whose URL
  //    looks like an image). imeta is preferred because it carries metadata.
  for (const [, entry] of imeta) {
    const isImage = entry.mime
      ? entry.mime.startsWith('image/')
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

/**
 * Compact art gallery widget.
 *
 * Fetches kind-1 notes from the given (default: Timechain Art Magazine) pubkey,
 * harvests every image, and lays them out in a responsive grid. Clicking a tile
 * opens the shared full-screen `Lightbox` with arrow navigation, a counter, and
 * a bottom bar showing the note caption and a link to the source post.
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

  // Author lookup + derived values. These hooks MUST run before the early
  // returns below (React rules-of-hooks): `useAuthor` is a no-op query when
  // `pubkey` is undefined — it is internally `enabled: !!pubkey`.
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.name || metadata?.display_name || 'Timechain Art';

  // Link to the source note of the newest image (lightbox bottom bar + attribution).
  // Only computed when there's at least one image — safe no-op otherwise.
  const sourceNote = useMemo(
    () =>
      images.length && pubkey
        ? nip19.neventEncode({ id: images[0].eventId, author: pubkey })
        : undefined,
    [images, pubkey],
  );

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
      <div className={cn('grid grid-cols-2 gap-1 p-1', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-lg" />
        ))}
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
      <div className={cn('grid grid-cols-2 gap-1', className)}>
        {images.map((img, i) => {
          const revealBlurred =
            img.contentWarning !== undefined &&
            config.contentWarningPolicy === 'blur';
          return (
            <ArtTile
              key={img.url + img.eventId}
              img={img}
              revealBlurred={revealBlurred}
              onClick={() => setLightboxIndex(i)}
            />
          );
        })}
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
          Latest note
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
  onClick,
}: {
  img: ArtImage;
  revealBlurred: boolean;
  onClick: () => void;
}) {
  const { src, onError, failed } = useBlossomFallback(img.url);
  const [loaded, setLoaded] = useState(false);

  // Once every fallback server has 404'd, there's no point holding an empty tile.
  if (failed && !loaded) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="View artwork"
      className="relative aspect-square w-full rounded-lg overflow-hidden bg-secondary/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <img
        src={src}
        alt={img.alt ?? 'Art'}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => onError()}
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
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


