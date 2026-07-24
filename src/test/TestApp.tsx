import { NostrLoginProvider } from "@nostrify/react/login";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from "@unhead/react/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "@/components/AppProvider";
import { sunsetPreset } from "@/themes";
import NostrProvider from "@/components/NostrProvider";
import type { AppConfig } from "@/contexts/AppContext";
import { NWCProvider } from "@/contexts/NWCContext";

interface TestAppProps {
  children: React.ReactNode;
}

export function TestApp({ children }: TestAppProps) {
  const head = createHead();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const defaultConfig: AppConfig = {
    appName: "2140.wtf",
    appId: "2140",
    homePage: "feed",
    theme: "custom",
    customTheme: sunsetPreset,
    useAppRelays: true,
    useUserRelays: false,
    marketplaceRelays: [],
    groupChatRelays: [],
    appRelays: [],
    lastChannelByServer: {},
    mutedCommunities: [],
    mutedChannels: [],
    notifLevels: {},
    wotAgentFilterByCommunity: {},
    zapsEnabled: true,
    defaultZapAmount: 1000,
    relayMetadata: {
      relays: [{ url: "wss://relay.primal.net", read: true, write: true }],
      updatedAt: 0,
    },
    feedSettings: {
      feedIncludePosts: true,
      feedIncludeComments: true,
      feedIncludeReposts: true,
      feedIncludeGenericReposts: true,
      feedIncludeReactions: false,
      feedIncludeZaps: false,
      feedIncludeArticles: false,
      showArticles: false,
      showHighlights: false,
      feedIncludeHighlights: false,
      feedIncludeCampaigns: false,
      showEvents: false,
      feedIncludeEvents: false,
      showPolls: false,
      showPeopleLists: true,
      feedIncludePolls: false,
      feedIncludePeopleLists: false,
      showProfileThemes: false,
      feedIncludeProfileThemes: true,
      showThemeDefinitions: true,
      feedIncludeThemeDefinitions: true,
      showProfileThemeUpdates: true,
      feedIncludeProfileThemeUpdates: true,
      showCustomProfileThemes: true,
      feedIncludeVoiceMessages: false,
      showCustomEmojis: true,
      showEmojiPacks: false,
      feedIncludeEmojiPacks: false,
      showPhotos: true,
      feedIncludePhotos: true,
      showVideos: true,
      feedIncludeNormalVideos: true,
      feedIncludeShortVideos: true,
      showUserStatuses: true,
      showMusic: false,
      feedIncludeMusicTracks: false,
      feedIncludeMusicPlaylists: false,
      showPodcasts: false,
      feedIncludePodcastEpisodes: false,
      feedIncludePodcastTrailers: false,
      showDevelopment: false,
      feedIncludeDevelopment: false,
      showBadges: false,
      showBadgeDefinitions: true,
      showProfileBadges: true,
      showBadgeAwards: true,
      feedIncludeBadgeDefinitions: false,
      feedIncludeProfileBadges: false,
      feedIncludeBadgeAwards: false,
      feedIncludeVanish: true,
      feedIncludeLoveLists: true,
      feedIncludePets: true,
      showBirdstar: false,
      showRoadstr: false,
      feedIncludeRoadstr: false,
      feedIncludeBirdDetections: false,
      feedIncludeBirdex: false,
      feedIncludeConstellations: false,
      followsFeedShowReplies: true,
    },
    sidebarOrder: [],
    sidebarOrderVersion: 1,
    themeDefaultVersion: 3,
    nip85StatsPubkey:
      "5f68e85ee174102ca8978eef302129f081f03456c884185d5ec1c1224ab633ea",
    blossomServerMetadata: {
      servers: [],
      updatedAt: 0,
    },
    useAppBlossomServers: true,
    faviconUrl: "",
    linkPreviewUrl: "",
    corsProxy: "",
    magicMouse: false,
    contentWarningPolicy: "blur",
    sentryDsn: "",
    sentryEnabled: false,
    plausibleDomain: "",
    plausibleEndpoint: "",
    savedFeeds: [],
    autoplayVideos: false,
    imageQuality: 'compressed',
    sandboxDomain: 'iframe.diy',
    esploraApis: ['https://mempool.space/api'],
    currencyDisplay: 'sats',
    sidebarWidgets: [],
    sidebarWidgetsVersion: 1,
    maxCachedEventAge: 604800,
    baoSignetMintUrl: 'https://relay.bao.network/cashu',
    baoSignetFaucetUrl: 'https://relay.bao.network/faucet/',
    baoCustomSignetMempoolUrl: 'https://mempool.bao.markets/api',
    bip352ScanConcurrency: 8,
  };

  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="test-app-config" defaultConfig={defaultConfig}>
        <QueryClientProvider client={queryClient}>
          <NostrLoginProvider storageKey="test-login">
            <NostrProvider>
              <NWCProvider>
                <BrowserRouter>{children}</BrowserRouter>
              </NWCProvider>
            </NostrProvider>
          </NostrLoginProvider>
        </QueryClientProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default TestApp;
