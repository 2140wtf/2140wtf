import { useState, useCallback } from 'react';
import { Music, Upload } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';
import { KindInfoButton } from '@/components/KindInfoButton';
import { PageHeader } from '@/components/PageHeader';
import { SubHeaderBar } from '@/components/SubHeaderBar';
import { TabButton } from '@/components/TabButton';
import { ARC_OVERHANG_PX } from '@/components/ArcBackground';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getExtraKindDef } from '@/lib/extraKinds';
import { sidebarItemIcon } from '@/lib/sidebarItems';
import { MusicDiscoverTab } from '@/components/music/MusicDiscoverTab';
import { MusicTracksTab } from '@/components/music/MusicTracksTab';
import { MusicPlaylistsTab } from '@/components/music/MusicPlaylistsTab';
import { MusicArtistsTab } from '@/components/music/MusicArtistsTab';
import { MusicLibraryTab } from '@/components/music/MusicLibraryTab';
import { MusicTrackComposeDialog } from '@/components/music/MusicTrackComposeDialog';
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer';

const musicDef = getExtraKindDef('music')!;

type MusicTab = 'discover' | 'library' | 'tracks' | 'playlists' | 'artists';

/**
 * Dedicated music discovery page.
 *
 * Replaces the generic KindFeedPage with a tabbed layout:
 * - **Discover** (default): Curated showcase with hero, featured, genres, etc.
 * - **Tracks**: Infinite-scroll list of all music tracks with genre filter
 * - **Playlists**: Grid of music playlists
 * - **Artists**: Grid of artist profile cards
 *
 * All content is global by default. The Discover tab surfaces curated
 * content from the curator's kind 30000 `d:music-artists` follow set.
 */
export function MusicPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<MusicTab>('discover');
  const [uploadOpen, setUploadOpen] = useState(false);

  useSeoMeta({
    title: `Music | ${config.appName}`,
    description: 'Discover music on Nostr',
  });

  useLayoutOptions({ showFAB: false, hasSubHeader: !!user });

  const switchToTracks = useCallback(() => setActiveTab('tracks'), []);
  const switchToPlaylists = useCallback(() => setActiveTab('playlists'), []);
  const switchToArtists = useCallback(() => setActiveTab('artists'), []);

  return (
    <main className="flex-1 min-w-0">
      <PageHeader title="Music" icon={sidebarItemIcon('music', 'size-5')}>
        <KindInfoButton kindDef={musicDef} icon={<Music className="size-5" />} />
        {user && (
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Upload className="size-4" /> Upload
          </button>
        )}
      </PageHeader>

      {/* Tabs */}
      <SubHeaderBar>
        <TabButton label="Discover" active={activeTab === 'discover'} onClick={() => setActiveTab('discover')} />
        <TabButton label="Library" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
        <TabButton label="Tracks" active={activeTab === 'tracks'} onClick={() => setActiveTab('tracks')} />
        <TabButton label="Playlists" active={activeTab === 'playlists'} onClick={() => setActiveTab('playlists')} />
        <TabButton label="Artists" active={activeTab === 'artists'} onClick={() => setActiveTab('artists')} />
      </SubHeaderBar>
      <div style={{ height: ARC_OVERHANG_PX }} />

      {/* Tab content */}
      {activeTab === 'discover' && (
        <MusicDiscoverTab
          onSwitchToTracks={switchToTracks}
          onSwitchToPlaylists={switchToPlaylists}
          onSwitchToArtists={switchToArtists}
        />
      )}
      {activeTab === 'tracks' && <MusicTracksTab />}
      {activeTab === 'library' && <MusicLibraryTab />}
      {activeTab === 'playlists' && <MusicPlaylistsTab />}
      {activeTab === 'artists' && <MusicArtistsTab />}

      <MusicTrackComposeDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <MusicMiniPlayer />
    </main>
  );
}
