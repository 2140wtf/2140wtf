import { useSeoMeta } from '@unhead/react';
import { useState } from 'react';

import { Feed } from '@/components/Feed';
import { KindInfoButton } from '@/components/KindInfoButton';
import { PageHeader } from '@/components/PageHeader';
import { SubHeaderBar } from '@/components/SubHeaderBar';
import { TabButton } from '@/components/TabButton';
import { PodcastDirectory } from '@/components/podcasts/PodcastDirectory';
import { useAppContext } from '@/hooks/useAppContext';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { getExtraKindDef } from '@/lib/extraKinds';
import { sidebarItemIcon } from '@/lib/sidebarItems';

const podcastsDef = getExtraKindDef('podcasts')!;

type PodcastTab = 'discover' | 'nostr';

/**
 * Podcasts page. The "Discover" tab searches the full podcast catalog (iTunes
 * Search API) — Nostr-native podcast lists (kinds 30054/30055) still have
 * near-zero ecosystem adoption, so on their own the page showed the same ~3
 * shows forever. The "On Nostr" tab keeps the native feed for whoever does
 * publish them.
 */
export function PodcastsFeedPage() {
  const { config } = useAppContext();
  const [tab, setTab] = useState<PodcastTab>('discover');
  const [infoOpen, setInfoOpen] = useState(false);

  useSeoMeta({
    title: `Podcasts | ${config.appName}`,
    description: 'Podcasts on Nostr',
  });
  useLayoutOptions({ showFAB: false, hasSubHeader: true });

  const header = (
    <>
      <PageHeader title='Podcasts' icon={sidebarItemIcon('podcasts', 'size-5')}>
        <KindInfoButton kindDef={podcastsDef} icon={sidebarItemIcon('podcasts', 'size-5')} open={infoOpen} onOpenChange={setInfoOpen} />
      </PageHeader>
      <SubHeaderBar>
        <TabButton label='Discover' active={tab === 'discover'} onClick={() => setTab('discover')} />
        <TabButton label='On Nostr' active={tab === 'nostr'} onClick={() => setTab('nostr')} />
      </SubHeaderBar>
    </>
  );

  if (tab === 'nostr') {
    return (
      <Feed
        kinds={[30054, 30055]}
        hideCompose
        feedId='podcasts'
        emptyMessage='No podcasts published to Nostr yet — the Discover tab has the full catalog.'
        header={header}
      />
    );
  }

  return (
    <main className='mx-auto w-full max-w-2xl'>
      {header}
      <PodcastDirectory />
    </main>
  );
}
