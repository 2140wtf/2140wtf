import { useMusicArtists } from '@/hooks/useMusicArtists';
import { ProfileCard, ProfileCardSkeleton } from '@/components/discovery/ProfileCard';

/**
 * The "Artists" tab — grid of artist profile cards.
 *
 * Shows curated artists first (with track counts), then all other
 * artists discovered from track events, sorted by track count.
 *
 * **States**:
 * - Loading: Grid of skeleton cards
 * - Empty: Centered message
 * - Loaded: Grid of profile cards with track counts
 */
export function MusicArtistsTab() {
  const { artists, isLoading, isError } = useMusicArtists();

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-8">
        {Array.from({ length: 9 }).map((_, i) => (
          <ProfileCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-12 text-sm text-muted-foreground text-center">
        Failed to load artists. Check your relay connections and try again.
      </p>
    );
  }

  if (artists.length === 0) {
    return (
      <p className="px-4 py-12 text-sm text-muted-foreground text-center">
        No music artists found yet. Check back soon!
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-8">
      {artists.map((a) => (
        <ProfileCard
          key={a.pubkey}
          pubkey={a.pubkey}
          subtitle={a.trackCount > 0 ? `${a.trackCount} track${a.trackCount !== 1 ? 's' : ''}` : undefined}
        />
      ))}
    </div>
  );
}
