type RouteLoader = () => Promise<unknown>;

const exactRoutes: Record<string, RouteLoader> = {
  '/notifications': () => import('@/pages/NotificationsPage'),
  '/search': () => import('@/pages/SearchPage'),
  '/trends': () => import('@/pages/TrendsPage'),
  '/settings': () => import('@/pages/SettingsPage'),
  '/settings/privacy': () => import('@/pages/PrivacySettingsPage'),
  '/settings/profile': () => import('@/pages/ProfileSettings'),
  '/settings/pets': () => import('@/pages/PetsSettingsPage'),
  '/settings/feed': () => import('@/pages/ContentSettingsPage'),
  '/settings/content': () => import('@/pages/ContentPage'),
  '/settings/wallet': () => import('@/pages/WalletSettingsPage'),
  '/settings/notifications': () => import('@/pages/NotificationSettings'),
  '/settings/advanced': () => import('@/pages/AdvancedSettingsPage'),
  '/settings/magic': () => import('@/pages/MagicSettingsPage'),
  '/settings/network': () => import('@/pages/NetworkSettingsPage'),
  '/lists': () => import('@/pages/UserListsPage'),
  '/events': () => import('@/pages/EventsFeedPage'),
  '/photos': () => import('@/pages/PhotosFeedPage'),
  '/videos': () => import('@/pages/VideosFeedPage'),
  '/music': () => import('@/pages/MusicPage'),
  '/podcasts': () => import('@/pages/PodcastsFeedPage'),
  '/art': () => import('@/pages/ArtFeedPage'),
  '/themes': () => import('@/pages/ThemesPage'),
  '/wallet': () => import('@/pages/WalletPage'),
  '/btcmap': () => import('@/pages/BtcMapPage'),
  '/lightning-observatory': () => import('@/pages/LightningObservatoryPage'),
  '/lightning-observatory/full': () => import('@/pages/LightningObservatoryFullPage'),
  '/roadstr': () => import('@/pages/RoadstrPage'),
  '/market': () => import('@/pages/MarketPage'),
  '/messages': () => import('@/pages/MessagesPage'),
  '/community': () => import('@/pages/BaoCommunitiesPage'),
  '/bao/community': () => import('@/pages/BaoCommunitiesPage'),
  '/bao/markets': () => import('@/pages/PredictionMarketsPage'),
  '/bao/fund': () => import('@/pages/BaoFundingPage'),
  '/mints': () => import('@/pages/MintDiscoveryPage'),
  '/mints/details': () => import('@/pages/MintDetailsPage'),
  '/court': () => import('@/pages/CourtPage'),
  '/bookmarks': () => import('@/pages/BookmarksPage'),
  '/groups': () => import('@/pages/GroupChatPage'),
  '/pets': () => import('@/pages/PetsPage'),
  '/pets/battle': () => import('@/pages/PetsBattlePage'),
  '/pets/chase-btc': () => import('@/pages/ChaseBtcPage'),
  '/badges': () => import('@/pages/BadgesPage'),
  '/books': () => import('@/pages/BooksPage'),
  '/archive': () => import('@/pages/ArchivePage'),
  '/wikipedia': () => import('@/pages/WikipediaPage'),
  '/help': () => import('@/pages/HelpPage'),
  '/agents': () => import('@/pages/AgentsPage'),
  '/privacy': () => import('@/pages/PrivacyPolicyPage'),
  '/legal': () => import('@/pages/LegalPage'),
  '/safety': () => import('@/pages/CSAEPolicyPage'),
  '/changelog': () => import('@/pages/ChangelogPage'),
  '/about': () => import('@/pages/LandingPage'),
};

const prefixRoutes: Array<[string, RouteLoader]> = [
  ['/messages/', () => import('@/pages/MessageThreadPage')],
  ['/articles/new', () => import('@/pages/ArticleEditorPage')],
  ['/articles/edit/', () => import('@/pages/ArticleEditorPage')],
  ['/t/', () => import('@/pages/HashtagPage')],
  ['/g/', () => import('@/pages/GeotagPage')],
  ['/feed/', () => import('@/pages/DomainFeedPage')],
  ['/client/', () => import('@/pages/ClientFeedPage')],
  ['/r/', () => import('@/pages/RelayPage')],
  ['/i/', () => import('@/pages/ExternalContentPage')],
];

const pending = new Map<RouteLoader, Promise<unknown>>();

function loaderFor(pathname: string): RouteLoader | undefined {
  const exact = exactRoutes[pathname];
  if (exact) return exact;
  const prefix = prefixRoutes.find(([path]) => pathname.startsWith(path));
  if (prefix) return prefix[1];
  if (/^\/(?:npub|nprofile|note|nevent|naddr)1/i.test(pathname)) {
    return () => import('@/pages/NIP19Page');
  }
  return undefined;
}

/** Download a lazy route's module before React Router needs to suspend. */
export function preloadRoute(pathname: string): Promise<unknown> | undefined {
  const loader = loaderFor(pathname);
  if (!loader) return undefined;
  const existing = pending.get(loader);
  if (existing) return existing;
  const request = loader().catch((error: unknown) => {
    pending.delete(loader);
    throw error;
  });
  pending.set(loader, request);
  return request;
}

export const IDLE_PRELOAD_ROUTES = [
  '/pets',
  '/notifications',
  '/wallet',
  '/messages',
  '/videos',
  '/music',
  '/events',
  '/trends',
  '/settings',
] as const;
