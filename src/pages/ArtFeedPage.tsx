import { useState } from 'react';
import { KindFeedPage } from '@/pages/KindFeedPage';
import { ArtListingComposeDialog } from '@/components/ArtListingComposeDialog';
import { sidebarItemIcon } from '@/lib/sidebarItems';

const ART_KIND = 30402;

export function ArtFeedPage() {
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <>
      <KindFeedPage
        kind={ART_KIND}
        title="Art"
        icon={sidebarItemIcon('art', 'size-5')}
        tagFilters={{ '#t': ['art'] }}
        emptyMessage="No art listings yet. The 2140 art feed is powered by NIP-99 classifieds tagged #art."
        onFabClick={() => setComposeOpen(true)}
      />
      <ArtListingComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </>
  );
}
