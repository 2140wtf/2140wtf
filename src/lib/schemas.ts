import { z } from 'zod';

import type { Theme, ContentWarningPolicy } from '@/contexts/AppContext';
import type { CoreThemeColors, ThemeConfig, ThemesConfig } from '@/themes';
import {
  isAllowedHttpsUrl,
  isAllowedRelayUrl,
  isAllowedShareOrigin,
  isAllowedUrlTemplate,
} from './sanitizeUrl';

// ─── Theme Schemas ───────────────────────────────────────────────────

/** Zod schema for Theme validation */
export const ThemeSchema = z.enum(['dark', 'light', 'system', 'custom']) satisfies z.ZodType<Theme>;


/** HSL value string like "258 70% 55%" */
const HslValue = z.string().regex(/^\d/);

/** Zod schema for CoreThemeColors (the 3 core colors) */
export const CoreThemeColorsSchema = z.object({
  background: HslValue,
  text: HslValue,
  primary: HslValue,
}) satisfies z.ZodType<CoreThemeColors>;

/**
 * Legacy schema that accepts the old 19-token ThemeTokens format.
 * Used for backward compatibility when reading old configs/events.
 * Extracts core colors from legacy format.
 */
export const LegacyThemeTokensSchema = z.object({
  background: HslValue,
  foreground: HslValue,
  primary: HslValue,
}).passthrough();

/**
 * Legacy schema that accepts the old 4-color format (with secondary).
 * Strips the secondary field and normalizes to CoreThemeColors.
 */
export const LegacyFourColorSchema = z.object({
  background: HslValue,
  text: HslValue,
  primary: HslValue,
  secondary: HslValue,
}).transform(({ background, text, primary }): CoreThemeColors => ({
  background,
  text,
  primary,
}));

/**
 * Schema that accepts CoreThemeColors, legacy 4-color, or legacy ThemeTokens,
 * always normalizing to CoreThemeColors.
 */
export const ThemeColorsCompatSchema = z.union([
  CoreThemeColorsSchema,
  LegacyFourColorSchema,
  LegacyThemeTokensSchema.transform((legacy): CoreThemeColors => ({
    background: legacy.background,
    text: legacy.foreground,
    primary: legacy.primary,
  })),
]);

// ─── ThemeConfig Schemas ──────────────────────────────────────────────

/** Zod schema for ThemeFont */
export const ThemeFontSchema = z.object({
  family: z.string(),
  // Reject non-URL strings at the schema layer. Downstream consumers still
  // run the value through \`sanitizeUrl()\` to enforce \`https:\` and strip
  // \`javascript:\`/\`data:\` URIs before use — this is defense-in-depth.
  url: z.url().optional(),
});

/** Zod schema for ThemeBackground */
export const ThemeBackgroundSchema = z.object({
  url: z.url(),
  mode: z.enum(['cover', 'tile']).optional(),
  dimensions: z.string().optional(),
  mimeType: z.string().optional(),
  blurhash: z.string().optional(),
});

/** Zod schema for the full ThemeTokens object. */
export const ThemeTokensSchema = z.object({
  background: HslValue,
  foreground: HslValue,
  card: HslValue,
  cardForeground: HslValue,
  popover: HslValue,
  popoverForeground: HslValue,
  primary: HslValue,
  primaryForeground: HslValue,
  secondary: HslValue,
  secondaryForeground: HslValue,
  muted: HslValue,
  mutedForeground: HslValue,
  accent: HslValue,
  accentForeground: HslValue,
  destructive: HslValue,
  destructiveForeground: HslValue,
  border: HslValue,
  input: HslValue,
  ring: HslValue,
});

/** Zod schema for the full ThemeConfig */
export const ThemeConfigSchema = z.object({
  title: z.string().optional(),
  colors: CoreThemeColorsSchema,
  font: ThemeFontSchema.optional(),
  titleFont: ThemeFontSchema.optional(),
  background: ThemeBackgroundSchema.optional(),
  tokens: ThemeTokensSchema.partial().optional(),
  radius: z.string().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
});

/** Zod schema for ThemesConfig (light + dark theme configs) */
export const ThemesConfigSchema = z.object({
  light: z.lazy(() => ThemeConfigSchema),
  dark: z.lazy(() => ThemeConfigSchema),
}) satisfies z.ZodType<ThemesConfig>;

/**
 * Compat schema that accepts either the new ThemeConfig format or the old
 * bare CoreThemeColors format (and all legacy color variants), normalizing
 * to ThemeConfig.
 */
export const ThemeConfigCompatSchema = z.union([
  ThemeConfigSchema,
  // Bare CoreThemeColors (old format) → wrap in ThemeConfig
  ThemeColorsCompatSchema.transform((colors): ThemeConfig => ({ colors })),
]);

/** Zod schema for ContentWarningPolicy validation */
export const ContentWarningPolicySchema = z.enum(['blur', 'hide', 'show']) satisfies z.ZodType<ContentWarningPolicy>;

// ─── Feed & Relay Schemas ────────────────────────────────────────────

export const RelayMetadataSchema = z.object({
  relays: z.array(z.object({
    url: z.string().url().refine(isAllowedRelayUrl, { message: 'Relay URL must use wss:// (or ws://localhost)' }),
    read: z.boolean(),
    write: z.boolean(),
  })),
  updatedAt: z.number(),
});

/** Zod schema for BlossomServerMetadata (BUD-03 kind 10063 server list). */
export const BlossomServerMetadataSchema = z.object({
  servers: z.array(z.string().url().refine(isAllowedHttpsUrl, { message: 'Blossom server URL must use https://' })),
  updatedAt: z.number(),
});

/**
 * Zod schema for FeedSettings validation.
 * All fields use .optional() so data with missing keys
 * (from older encrypted settings) doesn't reject the whole object.
 * Uses looseObject to preserve extra keys from newer encrypted settings.
 * Missing fields get filled in by the defaultConfig merge downstream.
 */
export const FeedSettingsSchema = z.looseObject({
  feedIncludePosts: z.boolean().optional(),
  feedIncludeComments: z.boolean().optional(),
  feedIncludeReposts: z.boolean().optional(),
  feedIncludeGenericReposts: z.boolean().optional(),
  feedIncludeReactions: z.boolean().optional(),
  feedIncludeZaps: z.boolean().optional(),
  feedIncludeArticles: z.boolean().optional(),
  showArticles: z.boolean().optional(),
  showHighlights: z.boolean().optional(),
  feedIncludeHighlights: z.boolean().optional(),
  feedIncludeCampaigns: z.boolean().optional(),
  showEvents: z.boolean().optional(),
  feedIncludeEvents: z.boolean().optional(),
  showPolls: z.boolean().optional(),
  showPeopleLists: z.boolean().optional(),
  showStreams: z.boolean().optional(),
  feedIncludePolls: z.boolean().optional(),
  feedIncludePeopleLists: z.boolean().optional(),
  feedIncludeStreams: z.boolean().optional(),
  showProfileThemes: z.boolean().optional(),
  feedIncludeProfileThemes: z.boolean().optional(),
  showThemeDefinitions: z.boolean().optional(),
  feedIncludeThemeDefinitions: z.boolean().optional(),
  showProfileThemeUpdates: z.boolean().optional(),
  feedIncludeProfileThemeUpdates: z.boolean().optional(),
  showCustomProfileThemes: z.boolean().optional(),
  feedIncludeVoiceMessages: z.boolean().optional(),
  showEmojiPacks: z.boolean().optional(),
  feedIncludeEmojiPacks: z.boolean().optional(),
  showCustomEmojis: z.boolean().optional(),
  showUserStatuses: z.boolean().optional(),
  showMusic: z.boolean().optional(),
  feedIncludeMusicTracks: z.boolean().optional(),
  feedIncludeMusicPlaylists: z.boolean().optional(),
  showPodcasts: z.boolean().optional(),
  feedIncludePodcastEpisodes: z.boolean().optional(),
  feedIncludePodcastTrailers: z.boolean().optional(),
  showDevelopment: z.boolean().optional(),
  feedIncludeDevelopment: z.boolean().optional(),
  feedIncludePets: z.boolean().optional(),
  showBadgeAwards: z.boolean().optional(),
  feedIncludeBadgeAwards: z.boolean().optional(),
  showBirdstar: z.boolean().optional(),
  showRoadstr: z.boolean().optional(),
  feedIncludeRoadstr: z.boolean().optional(),
  feedIncludeBirdDetections: z.boolean().optional(),
  feedIncludeBirdex: z.boolean().optional(),
  feedIncludeConstellations: z.boolean().optional(),
  feedIncludeLoveLists: z.boolean().optional(),
});

/** Schema for a NIP-01 filter object (lenient — allows variable placeholder strings). */
export const TabFilterSchema = z.record(z.string(), z.unknown());

/** Schema for a variable definition. */
export const TabVarDefSchema = z.object({
  name: z.string(),
  tagName: z.string(),
  pointer: z.string(),
});

export const SavedFeedSchema = z.object({
  id: z.string(),
  label: z.string(),
  filter: TabFilterSchema,
  vars: z.array(TabVarDefSchema).default([]),
  createdAt: z.number(),
});

// ─── RuntimeAppConfigSchema ─────────────────────────────────────────────────

/**
 * Zod schema for the full AppConfig stored in localStorage.
 *
 * Uses ThemeConfigCompatSchema for the customTheme field so legacy
 * 19-token color objects still parse successfully.
 */
export const RuntimeAppConfigSchema = z.object({
  appName: z.string().optional(),
  appId: z.string().optional(),
  shareOrigin: z.string().url().refine(isAllowedShareOrigin, { message: 'Share origin must be an https:// origin without path' }).optional(),
  homePage: z.string().optional(),
  clientName: z.string().optional(),
  /** NIP-19 naddr1 string for the kind 31990 handler event. */
  client: z.string().startsWith('naddr1').optional(),
  magicMouse: z.boolean().optional(),
  theme: ThemeSchema,
  customTheme: ThemeConfigCompatSchema.optional(),
  themes: ThemesConfigSchema.optional(),
  relayMetadata: RelayMetadataSchema,
  useAppRelays: z.boolean(),
  useUserRelays: z.boolean(),
  marketplaceRelays: z.array(
    z.string().url().refine(isAllowedRelayUrl, { message: 'Marketplace relay URL must be wss:// or ws:// localhost' }),
  ).optional().default([]),
  groupChatRelays: z.array(
    z.string().url().refine(isAllowedRelayUrl, { message: 'Group chat relay URL must be wss:// or ws:// localhost' }),
  ).optional().default([]),
  /** ₿AO chat (Concord V2) app relays for generic community-plane traffic. */
  appRelays: z.array(
    z.string().url().refine(isAllowedRelayUrl, { message: 'App relay URL must be wss:// or ws:// localhost' }),
  ).optional().default([]),
  /** Last-open ₿AO channel per community (`c:${communityIdHex}` → channel id hex). */
  lastChannelByServer: z.record(z.string(), z.string()).optional().default({}),
  /** Muted ₿AO communities (`c2:${communityIdHex}`). */
  mutedCommunities: z.array(z.string()).optional().default([]),
  /** Muted ₿AO channels (`c2:${communityIdHex}::${channelIdHex}`). */
  mutedChannels: z.array(z.string()).optional().default([]),
  /** Per-conversation ₿AO notification levels keyed by community/channel scope. */
  notifLevels: z.record(z.string(), z.enum(['all', 'mentions', 'nothing'])).optional().default({}),
  /** Per-community "filter agents by web of trust" toggle (`c2:${communityIdHex}` → on). */
  wotAgentFilterByCommunity: z.record(z.string(), z.boolean()).optional().default({}),
  /** Whether zap/wallet/financial features are enabled in the UI. */
  zapsEnabled: z.boolean().optional().default(true),
  /** Preselected amount (sats) when the zap dialog opens. */
  defaultZapAmount: z.number().int().positive().optional().default(1000),
  feedSettings: FeedSettingsSchema,
  sidebarOrder: z.array(z.string()),
  sidebarOrderVersion: z.number().int().nonnegative().optional(),
  themeDefaultVersion: z.number().int().nonnegative().optional(),
  nip85StatsPubkey: z.string().refine(
    (val) => val.length === 0 || (val.length === 64 && /^[0-9a-f]{64}$/.test(val)),
    { message: 'Must be empty or a valid 64-character hex pubkey' }
  ),
  blossomServerMetadata: BlossomServerMetadataSchema,
  useAppBlossomServers: z.boolean(),
  faviconUrl: z.string().refine(isAllowedUrlTemplate, { message: 'Favicon URL template must use https://' }),
  linkPreviewUrl: z.string().refine(isAllowedUrlTemplate, { message: 'Link preview URL template must use https://' }),
  corsProxy: z.string().refine(isAllowedUrlTemplate, { message: 'CORS proxy URL template must use https://' }),
  baoSignetMintUrl: z.string().url().refine(isAllowedHttpsUrl, { message: '₿AO mint URL must use https://' }).optional(),
  baoSignetFaucetUrl: z.string().url().refine(isAllowedHttpsUrl, { message: '₿AO faucet URL must use https://' }).optional(),
  /** BAO Markets custom signet Mempool API root, e.g. https://mempool.bao.markets/api */
  baoCustomSignetMempoolUrl: z.string().url().refine(isAllowedHttpsUrl, { message: '₿AO mempool URL must use https://' }).optional(),
  baoApiUrl: z.string().url().refine(isAllowedHttpsUrl, { message: '₿AO API URL must use https://' }).optional(),
  /** Optional Cashu P2PK pubkey for a trusted battle escrow operator. */
  petsBattleEscrowPubkey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Optional URL to request release of battle escrow funds to the winner. */
  petsBattleEscrowServiceUrl: z.string().url().refine(isAllowedHttpsUrl, { message: 'Escrow service URL must use https://' }).optional(),
  /** npub that receives real-sats Pets shop payments (nutzaps) in Cashu mode. */
  petsTreasuryNpub: z.string().regex(/^npub1[02-9ac-hj-np-z]+$/).optional(),
  contentWarningPolicy: ContentWarningPolicySchema,
  sentryDsn: z.string().refine(isAllowedHttpsUrl, { message: 'Sentry DSN must use https:// or be empty' }),
  sentryEnabled: z.boolean(),
  plausibleDomain: z.string(),
  plausibleEndpoint: z.string().refine(isAllowedHttpsUrl, { message: 'Plausible endpoint must use https:// or be empty' }),
  savedFeeds: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      if ((item as Record<string, unknown>).destination !== undefined) return [];
      const result = SavedFeedSchema.safeParse(item);
      return result.success ? [result.data] : [];
    })
  ).optional().default([]),
  autoplayVideos: z.boolean(),
  imageQuality: z.enum(['compressed', 'original']),
  curatorPubkey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  sandboxDomain: z.string().optional(),
  esploraApis: z.array(z.string().url().refine(isAllowedHttpsUrl, { message: 'Esplora API URL must use https://' })).min(1),
  currencyDisplay: z.enum(['usd', 'sats']).optional(),
  sidebarWidgets: z.array(z.object({
    id: z.string(),
    height: z.number().optional(),
  })).optional(),
  sidebarWidgetsVersion: z.number().int().nonnegative().optional(),
  maxCachedEventAge: z.number().int().nonnegative().optional(),
  bip352IndexerUrl: z.string().url().refine(isAllowedHttpsUrl, { message: 'BIP-352 indexer URL must use https://' }).optional(),
  bip352ScanConcurrency: z.number().int().positive().optional(),
});

// ─── AppConfigSchema (build-time app.json) ───────────────────────

/**
 * Schema for the build-time `app.json` configuration file.
 * Derived from RuntimeAppConfigSchema with all fields made optional and strict
 * mode enabled so unknown keys are rejected.
 */
export const AppConfigSchema = RuntimeAppConfigSchema
  .partial()
  .strict();

/** Inferred type for the build-time configuration. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ─── Content Filter Schemas ──────────────────────────────────────────

/** Zod schema for FilterRule validation */
export const FilterRuleSchema = z.object({
  type: z.enum(['kind', 'content-regex', 'tag', 'author-metadata']),
  field: z.string().optional(),
  operator: z.enum(['equals', 'contains', 'regex', 'not-equals', 'not-contains']),
  value: z.string(),
  caseSensitive: z.boolean().optional(),
});

/** Zod schema for ContentFilter validation */
export const ContentFilterSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  rules: z.array(FilterRuleSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// ─── SavedFeed Schema ────────────────────────────────────────────────

// ─── EncryptedSettings Schema ────────────────────────────────────────

/**
 * Zod schema for EncryptedSettings validation.
 * All fields are optional since settings are incrementally synced.
 * Uses looseObject to preserve unknown keys from newer app versions.
 */
export const EncryptedSettingsSchema = z.looseObject({
  theme: ThemeSchema.optional(),
  customTheme: ThemeConfigCompatSchema.optional(),
  useAppRelays: z.boolean().optional(),
  useUserRelays: z.boolean().optional(),
  marketplaceRelays: z.array(
    z.string().url().refine(isAllowedRelayUrl, { message: 'Marketplace relay URL must be wss:// or ws:// localhost' }),
  ).optional(),
  groupChatRelays: z.array(
    z.string().url().refine(isAllowedRelayUrl, { message: 'Group chat relay URL must be wss:// or ws:// localhost' }),
  ).optional(),
  feedSettings: FeedSettingsSchema.optional(),
  contentFilters: z.array(ContentFilterSchema).optional(),
  contentWarningPolicy: ContentWarningPolicySchema.optional(),
  notificationsEnabled: z.boolean().optional(),
  notificationStyle: z.enum(['push', 'persistent']).optional(),
  notificationsCursor: z.number().optional(),
  dmReadCursors: z.record(z.string(), z.number()).optional(),
  groupReadCursors: z.record(z.string(), z.number()).optional(),
  notificationPreferences: z.object({
    reactions: z.boolean().optional(),
    reposts: z.boolean().optional(),
    zaps: z.boolean().optional(),
    mentions: z.boolean().optional(),
    comments: z.boolean().optional(),
    badges: z.boolean().optional(),
    onlyFollowing: z.boolean().optional(),
  }).optional(),
  publishPreferences: z.object({
    pets: z.boolean().optional(),
    reactions: z.boolean().optional(),
    reposts: z.boolean().optional(),
    comments: z.boolean().optional(),
    zaps: z.boolean().optional(),
    follows: z.boolean().optional(),
    mutes: z.boolean().optional(),
    bookmarks: z.boolean().optional(),
    publishRelayList: z.boolean().optional(),
    publishBlossomList: z.boolean().optional(),
    notes: z.boolean().optional(),
    polls: z.boolean().optional(),
    photos: z.boolean().optional(),
    articles: z.boolean().optional(),
    marketplace: z.boolean().optional(),
    badges: z.boolean().optional(),
    profile: z.boolean().optional(),
    lists: z.boolean().optional(),
    rsvp: z.boolean().optional(),
    reports: z.boolean().optional(),
    roadstr: z.boolean().optional(),
    directMessages: z.boolean().optional(),
    recovery: z.boolean().optional(),
    encryptedSettings: z.boolean().optional(),
    deleteRequests: z.boolean().optional(),
    drafts: z.boolean().optional(),
    emojiPacks: z.boolean().optional(),
    liveChat: z.boolean().optional(),
    themeDefinitions: z.boolean().optional(),
    pushSubscriptions: z.boolean().optional(),
    nutzaps: z.boolean().optional(),
  }).optional(),
  lastSync: z.number().optional(),
  sidebarOrder: z.array(z.string()).optional(),
  sidebarWidgets: z.array(z.object({
    id: z.string(),
    height: z.number().optional(),
  })).optional(),
  sidebarWidgetsVersion: z.number().int().nonnegative().optional(),
  homePage: z.string().optional(),
  showGlobalFeed: z.boolean().optional(),
  showCommunityFeed: z.boolean().optional(),
  communityData: z.object({
    domain: z.string(),
    label: z.string(),
    userCount: z.number(),
    nip05: z.record(z.string(), z.unknown()),
  }).optional(),
  autoplayVideos: z.boolean().optional(),
  corsProxy: z.string().refine(isAllowedUrlTemplate, { message: 'CORS proxy URL template must use https://' }).optional(),
  faviconUrl: z.string().refine(isAllowedUrlTemplate, { message: 'Favicon URL template must use https://' }).optional(),
  linkPreviewUrl: z.string().refine(isAllowedUrlTemplate, { message: 'Link preview URL template must use https://' }).optional(),
  sentryDsn: z.string().refine(isAllowedHttpsUrl, { message: 'Sentry DSN must use https:// or be empty' }).optional(),
  currencyDisplay: z.enum(['usd', 'sats']).optional(),
  /** Whether zap/wallet/financial features are enabled in the UI. */
  zapsEnabled: z.boolean().optional(),
  /** Preselected amount (sats) when the zap dialog opens. */
  defaultZapAmount: z.number().int().positive().optional(),
  pets3dEnabled: z.boolean().optional(),
  savedFeeds: z.array(z.unknown()).transform((arr) =>
    arr.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      if ((item as Record<string, unknown>).destination !== undefined) return [];
      const result = SavedFeedSchema.safeParse(item);
      return result.success ? [result.data] : [];
    })
  ).optional(),
});
