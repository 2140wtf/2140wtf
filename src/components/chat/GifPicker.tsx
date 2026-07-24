import { useCallback, useRef, useEffect, useState } from 'react';
import { Search, Star, X, ImageOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useGifSearch, type GifResult } from '@/hooks/useGifSearch';
import { useFavoriteGifs } from '@/hooks/useFavoriteGifs';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

interface GifPickerProps {
  onSelect: (gif: GifResult) => void;
}

/** Reference column width used to derive thumbnail heights from aspect ratios. */
const THUMB_REF_WIDTH = 170;

/**
 * Compute a thumbnail's display height from its true aspect ratio, clamping the
 * ratio so very wide/tall GIFs aren't forced into an ultrawide/sliver shape.
 */
function thumbHeight(gif: GifResult): number {
  const rawRatio = gif.width && gif.height ? gif.width / gif.height : 1;
  const aspectRatio = Math.min(Math.max(rawRatio, 0.6), 1.5);
  return Math.round(THUMB_REF_WIDTH / aspectRatio);
}

function GifThumbnail({ gif, onClick, isFavorite, onToggleFavorite }: { gif: GifResult; onClick: (gif: GifResult) => void; isFavorite?: boolean; onToggleFavorite?: (gif: GifResult) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Calculate the height from the (clamped) aspect ratio to prevent layout shifts
  const displayHeight = thumbHeight(gif);

  return (
    <button
      type="button"
      onClick={() => onClick(gif)}
      className={cn(
        'relative w-full rounded-lg overflow-hidden cursor-pointer',
        'transition-all duration-200 hover:ring-2 hover:ring-primary/60 hover:scale-[1.02]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'group',
      )}
      style={{ height: displayHeight }}
      title={gif.title}
    >
      {/* Skeleton placeholder */}
      {!loaded && !error && (
        <Skeleton className="absolute inset-0 rounded-lg" />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-lg">
          <ImageOff className="size-5 text-muted-foreground/40" />
        </div>
      )}

      {/* GIF image */}
      <img
        ref={imgRef}
        src={gif.previewUrl}
        alt={gif.title}
        loading="lazy"
        className={cn(
          'w-full h-full object-cover rounded-lg transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />

      {/* Favorite toggle button */}
      {onToggleFavorite && (
        <div
          className="absolute top-1.5 right-1.5 z-10"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToggleFavorite(gif);
          }}
        >
          <span
            role="button"
            tabIndex={0}
            className={cn(
              'flex items-center justify-center size-7 touch:size-9 rounded-full backdrop-blur-sm transition-all cursor-pointer',
              isFavorite
                ? 'bg-amber-500/90 text-white opacity-100'
                : 'bg-black/40 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/60',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onToggleFavorite(gif);
              }
            }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn('size-3.5', isFavorite && 'fill-current')} />
          </span>
        </div>
      )}

      {/* Hover overlay with title */}
      <div className={cn(
        'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent',
        'px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150',
      )}>
        <span className="text-[10px] text-white line-clamp-1 font-medium">
          {gif.title}
        </span>
      </div>
    </button>
  );
}

/** Masonry-style multi-column grid for GIF results. */
function GifGrid({ results, columns: columnCount, onSelect, isFavorite, onToggleFavorite }: { results: GifResult[]; columns: number; onSelect: (gif: GifResult) => void; isFavorite?: (id: string) => boolean; onToggleFavorite?: (gif: GifResult) => void }) {
  // Split results across columns for a masonry-like layout
  const columns: GifResult[][] = Array.from({ length: columnCount }, () => []);
  const columnHeights = new Array<number>(columnCount).fill(0);

  for (const gif of results) {
    const height = thumbHeight(gif);

    // Add to the shortest column
    let shortest = 0;
    for (let i = 1; i < columnCount; i++) {
      if (columnHeights[i] < columnHeights[shortest]) shortest = i;
    }
    columns[shortest].push(gif);
    columnHeights[shortest] += height + 8; // 8px gap
  }

  return (
    <div className="flex gap-2 px-2 pb-2">
      {columns.map((col, colIdx) => (
        <div key={colIdx} className="flex-1 flex flex-col gap-2">
          {col.map((gif) => (
            <GifThumbnail key={gif.id} gif={gif} onClick={onSelect} isFavorite={isFavorite?.(gif.id)} onToggleFavorite={onToggleFavorite} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function GifPicker({ onSelect }: GifPickerProps) {
  const { query, setQuery, clearQuery, results, isLoading, isError, isSearching } = useGifSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const columnCount = isMobile ? 2 : 3;
  const { isFavorite, toggleFavorite, favoriteList, count: favoriteCount } = useFavoriteGifs();
  const [activeTab, setActiveTab] = useState<'search' | 'favorites'>('search');

  // Auto-focus the search input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'search') inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const handleSelect = useCallback((gif: GifResult) => {
    onSelect(gif);
  }, [onSelect]);

  const favorites = activeTab === 'favorites' ? favoriteList() : [];

  return (
    <div className="flex flex-col w-full h-[360px] max-h-[55dvh] bg-popover rounded-lg overflow-hidden">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('search')}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-colors touch:px-4 touch:py-1.5',
            activeTab === 'search'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('favorites')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors touch:px-4 touch:py-1.5',
            activeTab === 'favorites'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Star className={cn('size-3', activeTab === 'favorites' && 'fill-current')} />
          Favorites
          {favoriteCount > 0 && (
            <span className={cn(
              'text-[10px] rounded-full px-1.5',
              activeTab === 'favorites' ? 'bg-primary-foreground/20' : 'bg-muted',
            )}>
              {favoriteCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'search' && (
        <>
          {/* Search input */}
          <div className="px-3 pt-1 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search GIFs..."
                className="pl-8 pr-20 h-9 text-base md:text-sm bg-muted/50 border-0 rounded-lg"
              />
              {query ? (
                <button
                  type="button"
                  onClick={clearQuery}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 pointer-events-none select-none">
                  Powered by GIFverse
                </span>
              )}
            </div>
          </div>

          {/* Section header */}
          <div className="px-3 pb-1.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {isSearching ? 'Results' : 'Trending'}
            </span>
          </div>

          {/* Results area */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="px-2 pb-2">
                <div className="flex gap-2">
                  {Array.from({ length: columnCount }).map((_, col) => (
                    <div key={col} className="flex-1 flex flex-col gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton
                          key={i}
                          className="w-full rounded-lg"
                          style={{ height: 60 + Math.random() * 50 }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <ImageOff className="size-8 mb-2 opacity-40" />
                <p className="text-sm">Failed to load GIFs</p>
                <p className="text-xs mt-1">Please try again</p>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <p className="text-sm">No GIFs found</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            ) : (
              <GifGrid results={results} columns={columnCount} onSelect={handleSelect} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
            )}
          </ScrollArea>
        </>
      )}

      {activeTab === 'favorites' && (
        <>
          <div className="px-3 pt-1 pb-1.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {favoriteCount > 0 ? `${favoriteCount} favorite${favoriteCount === 1 ? '' : 's'}` : 'No favorites yet'}
            </span>
          </div>
          <ScrollArea className="flex-1">
            {favorites.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Star className="size-8 mb-2 opacity-40" />
                <p className="text-sm">No favorite GIFs yet</p>
                <p className="text-xs mt-1">Tap the star on any GIF to save it here</p>
              </div>
            ) : (
              <GifGrid results={favorites} columns={columnCount} onSelect={handleSelect} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

