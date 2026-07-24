// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { NostrLoginProvider } from "@nostrify/react/login";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InferSeoMetaPlugin } from "@unhead/addons";
import { createHead, UnheadProvider } from "@unhead/react/client";
import { AppProvider } from "@/components/AppProvider";
import { sunsetPreset } from "@/themes";
import { NativeNotifications } from "@/components/NativeNotifications";
import NostrProvider from "@/components/NostrProvider";
import { NostrSync } from "@/components/NostrSync";
import { PlausibleProvider } from "@/components/PlausibleProvider";
import { SentryProvider } from "@/components/SentryProvider";


import { TooltipProvider } from "@/components/ui/tooltip";
import { useNsecPasteGuard } from "@/hooks/useNsecPasteGuard";
import { useWindowChunkErrorRecovery } from "@/hooks/useWindowChunkErrorRecovery";
import { useResetChunkRecoveryOnLoad } from "@/hooks/useResetChunkRecoveryOnLoad";
import type { AppConfig } from "@/contexts/AppContext";
import { NWCProvider } from "@/contexts/NWCContext";
import { CashuWalletProvider } from "@/contexts/CashuWalletContext";
import { DmInboxProvider } from "@/contexts/DmInboxContext";
import { GroupChatProvider } from "@/contexts/GroupChatContext";
import { AppConfigSchema, type AppConfig as AppBuildConfig } from "@/lib/schemas";
import { secureStorage } from "@/lib/secureStorage";
import { createEncryptedLoginStorage } from "@/lib/encryptedLoginStorage";
import { DEFAULT_ESPLORA_APIS } from "@/lib/esplora";
import { APP_RELAYS } from "@/lib/platform";
import { DEFAULT_SIDEBAR_WIDGETS, SIDEBAR_WIDGETS_VERSION } from "@/lib/sidebarWidgets";
import { EmotionDevProvider } from "@/pets/dev/EmotionDevContext";
import { RemoteBattleProvider } from "@/pets/battle";
import { WireSync } from "@/wire/WireSync";
import AppRouter from "./AppRouter";

const head = createHead({
  plugins: [InferSeoMetaPlugin()],
});

/** Sanitize an optional build-time URL so malformed env values cannot leak
 *  into the wallet/faucet flow.
 */
function safeOptionalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed;
  } catch {
    // invalid URL
  }
  return undefined;
}

/**
 * Encrypted storage adapter for NostrLoginProvider. The login JSON blob is
 * encrypted with NIP-44 self-encryption before being persisted.
 */
const encryptedLoginStorage = createEncryptedLoginStorage(secureStorage);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      gcTime: 300000, // 5 minutes
    },
  },
});

/** Hardcoded fallback values. Always provides every required field. */
const hardcodedConfig: AppConfig = {
  appName: "2140.wtf",
  appId: "2140",
  shareOrigin: import.meta.env.VITE_SHARE_ORIGIN || undefined,
  homePage: "feed",
  client: "naddr1qvzqqqru7cpzq7q6z5ns2hm5c8msyv83qwzxpxe52j8c4d4q5m92wsp9sflelkh9qqzkg6t5w3hswjl4yp",
  magicMouse: false,
  theme: "custom",
  customTheme: sunsetPreset,
  useAppRelays: true,
  useUserRelays: false,
  marketplaceRelays: [],
  groupChatRelays: [],
  appRelays: [...APP_RELAYS],
  lastChannelByServer: {},
  mutedCommunities: [],
  mutedChannels: [],
  notifLevels: {},
  zapsEnabled: true,
  relayMetadata: {
    relays: [],
    updatedAt: 0,
  },
  feedSettings: {
    feedIncludePosts: true,
    feedIncludeComments: true,
    feedIncludeReposts: true,
    feedIncludeGenericReposts: true,
    feedIncludeReactions: true,
    feedIncludeZaps: true,
    feedIncludeArticles: true,
    showArticles: true,
    showHighlights: true,
    feedIncludeHighlights: true,
    feedIncludeCampaigns: true,
    showEvents: true,
    feedIncludeEvents: true,
    showPolls: true,
    showPeopleLists: true,
    feedIncludePolls: true,
    feedIncludePeopleLists: true,
    showPhotos: true,
    feedIncludePhotos: true,
    showVideos: true,
    feedIncludeNormalVideos: true,
    feedIncludeShortVideos: true,
    showProfileThemes: false,
    feedIncludeProfileThemes: true,
    showThemeDefinitions: true,
    feedIncludeThemeDefinitions: true,
    showProfileThemeUpdates: true,
    feedIncludeProfileThemeUpdates: true,
    showCustomProfileThemes: true,
    feedIncludeVoiceMessages: true,
    showEmojiPacks: true,
    feedIncludeEmojiPacks: true,
    showCustomEmojis: true,
    showUserStatuses: true,
    showMusic: true,
    feedIncludeMusicTracks: true,
    feedIncludeMusicPlaylists: true,
    showPodcasts: true,
    feedIncludePodcastEpisodes: true,
    feedIncludePodcastTrailers: true,
    showDevelopment: true,
    feedIncludeDevelopment: true,
    showBadges: true,
    showBadgeDefinitions: true,
    showProfileBadges: true,
    showBadgeAwards: true,
    feedIncludeBadgeDefinitions: true,
    feedIncludeProfileBadges: true,
    feedIncludeBadgeAwards: true,
    feedIncludeVanish: true,
    feedIncludeLoveLists: true,
    feedIncludePets: false,
    showBirdstar: true,
    showRoadstr: true,
    feedIncludeRoadstr: true,
    feedIncludeBirdDetections: true,
    feedIncludeBirdex: true,
    feedIncludeConstellations: true,
    followsFeedShowReplies: true,
  },
  sidebarOrder: [
    "feed",
    "notifications",
    "messages",
    "prediction-markets",
    "polls",
    "media",
    "pets",
    "wallet",
    "events",
    "btcmap",
  ],
  sidebarOrderVersion: 12,
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
  baoSignetMintUrl: safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_BAO_MINT_URL) ?? 'https://relay.bao.network/cashu',
  baoSignetFaucetUrl: safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_BAO_FAUCET_URL) ?? 'https://relay.bao.network/faucet/',
  baoCustomSignetMempoolUrl:
    safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_BAO_CUSTOM_SIGNET_MEMPOOL_URL) ??
    'https://mempool.bao.markets/api',
  baoApiUrl: safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_BAO_API_URL) ?? 'https://relay.bao.network/bao-api',
  petsBattleEscrowPubkey:
    ((import.meta.env as Record<string, unknown>).VITE_PETS_BATTLE_ESCROW_PUBKEY as string | undefined) || undefined,
  petsBattleEscrowServiceUrl:
    safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_PETS_BATTLE_ESCROW_URL) ?? undefined,
  petsTreasuryNpub:
    ((import.meta.env as Record<string, unknown>).VITE_PETS_TREASURY_NPUB as string | undefined) ||
    // The canonical 2140.wtf account (see SupportContactCard). Receives all
    // mainnet pets payments (shop, adoption, rerolls) as Cashu nutzaps.
    // Its nsec stays with the operator and never enters this repo.
    'npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j',
  contentWarningPolicy: "blur",
  sentryDsn: import.meta.env.VITE_SENTRY_DSN || "",
  sentryEnabled: true,
  plausibleDomain: import.meta.env.VITE_PLAUSIBLE_DOMAIN || "",
  plausibleEndpoint: import.meta.env.VITE_PLAUSIBLE_ENDPOINT || "",
  savedFeeds: [],
  autoplayVideos: false,
  imageQuality: 'compressed',
  curatorPubkey: '932614571afcbad4d17a191ee281e39eebbb41b93fac8fd87829622aeb112f4d',
  sandboxDomain: 'iframe.diy',
  esploraApis: [...DEFAULT_ESPLORA_APIS],
  currencyDisplay: 'sats',
  sidebarWidgets: DEFAULT_SIDEBAR_WIDGETS,
  sidebarWidgetsVersion: SIDEBAR_WIDGETS_VERSION,
  maxCachedEventAge: 604800,
  bip352IndexerUrl: safeOptionalUrl((import.meta.env as Record<string, unknown>).VITE_BIP352_INDEXER_URL) ?? undefined,
  bip352ScanConcurrency: 8,
};

/**
 * Parse and validate build-time app.json overrides from the env string.
 * Returns an empty object when no config file was provided or validation fails.
 */
function parseAppConfig(): AppBuildConfig {
  try {
    const json = JSON.parse(import.meta.env.APP_CONFIG);
    if (!json) return {};
    return AppConfigSchema.parse(json);
  } catch {
    return {};
  }
}

/**
 * Merge hardcoded defaults with build-time app.json overrides.
 * Deep-merges feedSettings so a partial override doesn't erase defaults.
 * Precedence (handled by AppProvider): user localStorage > build-time > hardcoded.
 */
const appConfig = parseAppConfig();
const defaultConfig: AppConfig = {
  ...hardcodedConfig,
  ...appConfig,
  feedSettings: { ...hardcodedConfig.feedSettings, ...appConfig.feedSettings },
};

export function App() {
  useNsecPasteGuard();
  useWindowChunkErrorRecovery();
  useResetChunkRecoveryOnLoad();


  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig}>
        <SentryProvider>
          <PlausibleProvider>
            <QueryClientProvider client={queryClient}>
              <NostrLoginProvider storageKey="nostr:login" storage={encryptedLoginStorage}>
                <NostrProvider>
                  <NostrSync />
                  <NativeNotifications />

                    <NWCProvider>
                      <EmotionDevProvider>
                        <TooltipProvider>
                          <DmInboxProvider>
                            <CashuWalletProvider>
                              <RemoteBattleProvider>
                                <GroupChatProvider>
                                  <AppRouter />
                                </GroupChatProvider>
                                {/* ₿AO chat (Concord V2) wire: one standing REQ per
                                    community relay + parked-wrap drain. Renders null;
                                    no UI of its own (the chat UI lands in phase 2). */}
                                <WireSync />
                              </RemoteBattleProvider>
                            </CashuWalletProvider>
                          </DmInboxProvider>
                        </TooltipProvider>
                      </EmotionDevProvider>
                    </NWCProvider>
                </NostrProvider>
              </NostrLoginProvider>
            </QueryClientProvider>
          </PlausibleProvider>
        </SentryProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default App;
