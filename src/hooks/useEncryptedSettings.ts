import { useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrFilter } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { isVerifiedOwnEvent } from '@/lib/nostrEvents';
import { getStorageKey } from '@/lib/storageKey';
import { useCurrentUser } from './useCurrentUser';
import { useUploadFile } from './useUploadFile';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';
import { buildBlossomBackupTag, createBackupFile, fetchEncryptedBackup, parseBlossomBackupTag } from '@/lib/encryptedBackup';
import type { Theme, FeedSettings, ContentWarningPolicy, SavedFeed, WidgetConfig } from '@/contexts/AppContext';
import type { ThemeConfig } from '@/themes';
import type { ContentFilter } from './useContentFilters';
import { EncryptedSettingsSchema } from '@/lib/schemas';
import { toast } from '@/hooks/useToast';

/**
 * Timestamp (ms) of last local encrypted-settings write this session.
 * NostrSync uses this to avoid overwriting a local edit with a stale relay event.
 */
let lastWriteTs: number = 0;

/**
 * Persist the created_at timestamp of the last applied encrypted-settings event
 * so page reloads can ignore stale relay events.
 */
export function getLocalSettingsCreatedAt(appId: string, pubkey: string): number {
  try {
    return Number(localStorage.getItem(getStorageKey(appId, `settings-created-at:${pubkey}`))) || 0;
  } catch {
    return 0;
  }
}

export function setLocalSettingsCreatedAt(appId: string, pubkey: string, createdAt: number): void {
  try {
    localStorage.setItem(getStorageKey(appId, `settings-created-at:${pubkey}`), String(createdAt));
  } catch {
    // localStorage may not be available
  }
}
export function getLocalSettingsSync(appId: string, pubkey: string): number {
  try {
    return Number(localStorage.getItem(getStorageKey(appId, `settings-lastSync:${pubkey}`))) || 0;
  } catch {
    return 0;
  }
}

export function setLocalSettingsSync(appId: string, pubkey: string, lastSync: number): void {
  try {
    localStorage.setItem(getStorageKey(appId, `settings-lastSync:${pubkey}`), String(lastSync));
  } catch {
    // localStorage may not be available
  }
}

/**
 * Complete encrypted app settings stored in NIP-78
 */
export interface EncryptedSettings {
  /** App theme preference */
  theme?: Theme;
  /** Custom theme config (colors, fonts, background) */
  customTheme?: ThemeConfig;
  /** Whether to use app default relays in addition to user relays */
  useAppRelays?: boolean;
  /** Whether to include the user's personal NIP-65 relay list in the effective relay set. */
  useUserRelays?: boolean;
  /** User-added relays used specifically for NIP-99 marketplace listings. */
  marketplaceRelays?: string[];
  /** User-added relays used for private group chat messages and welcome events. */
  groupChatRelays?: string[];
  /** Feed and sidebar content settings */
  feedSettings?: FeedSettings;
  /** Advanced content filters */
  contentFilters?: ContentFilter[];
  /** How to handle NIP-36 content-warning events */
  contentWarningPolicy?: ContentWarningPolicy;
  /** Whether the user has enabled push notifications */
  notificationsEnabled?: boolean;
  /** Notification delivery style on native: 'push' (default) or 'persistent' (foreground service) */
  notificationStyle?: 'push' | 'persistent';
  /** Timestamp of last viewed notification (Unix timestamp in seconds) */
  notificationsCursor?: number;
  /** Per-conversation DM read cursors (conversationId -> newest seen created_at). */
  dmReadCursors?: Record<string, number>;
  /** ₿AO chat read-state map (scope key -> last-read timestamp), mirrored
   *  across devices by the ReadStateProvider. */
  readState?: Record<string, number>;
  /** Per-group read cursors (nostrGroupId -> newest seen message timestamp ms). */
  groupReadCursors?: Record<string, number>;
  /** Per-type notification preferences (all default to true/enabled) */
  notificationPreferences?: {
    reactions?: boolean;
    reposts?: boolean;
    zaps?: boolean;
    mentions?: boolean;
    comments?: boolean;
    badges?: boolean;
    letters?: boolean;
    highlights?: boolean;
    onlyFollowing?: boolean;
  };
  /** Per-feature publishing preferences (all default to true/enabled) */
  publishPreferences?: {
    pets?: boolean;
    reactions?: boolean;
    reposts?: boolean;
    comments?: boolean;
    zaps?: boolean;
    follows?: boolean;
    mutes?: boolean;
    bookmarks?: boolean;
    publishRelayList?: boolean;
    publishBlossomList?: boolean;
    notes?: boolean;
    polls?: boolean;
    photos?: boolean;
    articles?: boolean;
    marketplace?: boolean;
    badges?: boolean;
    profile?: boolean;
    lists?: boolean;
    rsvp?: boolean;
    reports?: boolean;
    roadstr?: boolean;
    directMessages?: boolean;
    recovery?: boolean;
    encryptedSettings?: boolean;
    deleteRequests?: boolean;
    drafts?: boolean;
    emojiPacks?: boolean;
    liveChat?: boolean;
    themeDefinitions?: boolean;
    pushSubscriptions?: boolean;
    nutzaps?: boolean;
  };
  /** Last sync timestamp */
  lastSync?: number;
  /** Ordered list of sidebar item IDs (built-in + extra-kind) */
  sidebarOrder?: string[];
  /** Ordered list of right sidebar widget configs. */
  sidebarWidgets?: WidgetConfig[];
  /** Sidebar item ID to display on the homepage ("/") */
  homePage?: string;
  /** Whether the Global feed tab is shown */
  showGlobalFeed?: boolean;
  /** Whether the Community feed tab is shown */
  showCommunityFeed?: boolean;
  /** Community data: domain, label, user count, and NIP-05 JSON */
  communityData?: {
    domain: string;
    label: string;
    userCount: number;
    nip05: Record<string, unknown>;
  };
  /** Custom CORS proxy URI template (only synced when non-empty) */
  corsProxy?: string;
  /** Custom favicon URI template (only synced when non-empty) */
  faviconUrl?: string;
  /** Custom link preview URI template (only synced when non-empty) */
  linkPreviewUrl?: string;
  /** Autoplay videos in feeds and previews (muted) */
  autoplayVideos?: boolean;
  /** Sentry DSN for error reporting (empty string = disabled) */
  sentryDsn?: string;
  /** How to display monetary amounts ("usd" or "sats"). */
  currencyDisplay?: 'usd' | 'sats';
  /** Whether zap/wallet/financial features are enabled in the UI. */
  zapsEnabled?: boolean;
  /** Preselected amount (sats) when the zap dialog opens. */
  defaultZapAmount?: number;
  /** Whether 3D pet/room rendering is enabled. */
  pets3dEnabled?: boolean;
  /** Saved feed tabs created from the search page. */
  savedFeeds?: SavedFeed[];
}

/**
 * Hook to manage all encrypted app settings using NIP-78 (kind 30078)
 * Syncs settings across devices while keeping them private
 */
export function useEncryptedSettings() {
  const { config } = useAppContext();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: uploadFile } = useUploadFile();
  const queryClient = useQueryClient();



  // Query the encrypted settings event
  const query = useQuery({
    queryKey: ['encryptedSettings', user?.pubkey],
    queryFn: async () => {
      if (!user) return null;

      const filter: NostrFilter = {
        kinds: [30078],
        authors: [user.pubkey],
        '#d': [`${config.appId}/metadata`],
        limit: 1,
      };

      const events = await nostr.query([filter]);
      if (events.length === 0) return null;

      return events[0];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes — allows window-focus refetch to pick up cross-device changes
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
  });

  // Parse settings from encrypted content
  const settings = useQuery({
    queryKey: ['parsedSettings', query.data?.id],
    queryFn: async () => {
      const event = query.data;
      if (!event || !user) return null;

      // Reject forged or tampered settings events before decrypting.
      if (!isVerifiedOwnEvent(event, user.pubkey)) {
        console.warn('Encrypted settings event failed verification, ignoring:', event.id);
        return null;
      }

      // Decrypt the content
      if (!user.signer.nip44) {
        return null;
      }

      try {
        let ciphertext: string | null = event.content || null;

        // Fallback to Blossom backup when the event content is empty.
        if (!ciphertext) {
          const backup = parseBlossomBackupTag(event.tags);
          if (backup) {
            ciphertext = await fetchEncryptedBackup(backup.url, backup.hash);
          }
        }

        if (!ciphertext) {
          return null;
        }

        const decrypted = await user.signer.nip44.decrypt(user.pubkey, ciphertext);
        const json = JSON.parse(decrypted);
        const result = EncryptedSettingsSchema.safeParse(json);
        if (!result.success) {
          console.warn('Encrypted settings failed validation, using partial data:', result.error.issues);
          // Return whatever fields are valid rather than wiping everything
          return (json ?? {}) as EncryptedSettings;
        }
        return result.data as EncryptedSettings;
      } catch (error) {
        console.error('Failed to decrypt settings:', error);
        return null;
      }
    },
    enabled: !!query.data && !!user,
    staleTime: 0, // Always re-derive when the upstream event changes
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Tracks the latest optimistic settings so rapid successive mutations
  // don't overwrite each other by reading stale cache data.
  const pendingSettings = useRef<EncryptedSettings | null>(null);

  // Update settings
  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<EncryptedSettings>) => {
      if (!user) throw new Error('User not logged in');
      if (!user.signer.nip44) throw new Error('NIP-44 encryption not supported by signer');
      if (settings.data?.publishPreferences?.encryptedSettings === false) {
        toast({
          title: 'Encrypted settings publishing disabled',
          description: 'Turn on “Encrypted settings” in Settings → Privacy & Publishing to sync settings.',
        });
        throw new Error('Encrypted settings publishing disabled');
      }

      // Use the latest pending settings if available (rapid successive mutations).
      // Otherwise, fetch fresh from relays to avoid cross-device stale reads.
      let currentSettings: EncryptedSettings;
      if (pendingSettings.current) {
        currentSettings = pendingSettings.current;
      } else {
        const freshEvent = await fetchFreshEvent(nostr, {
          kinds: [30078],
          authors: [user.pubkey],
          '#d': [`${config.appId}/metadata`],
        });
        // fetchFreshEvent verifies the signature and author, but double-check
        // before we decrypt and merge so a malicious relay response can't roll
        // settings back.
        if (freshEvent && !isVerifiedOwnEvent(freshEvent, user.pubkey)) {
          throw new Error('Fetched encrypted settings event has invalid signature or unexpected author');
        }
        if (freshEvent) {
          try {
            let ciphertext: string | null = freshEvent.content || null;
            if (!ciphertext) {
              const backup = parseBlossomBackupTag(freshEvent.tags);
              if (backup) {
                ciphertext = await fetchEncryptedBackup(backup.url, backup.hash);
              }
            }
            if (ciphertext) {
              const decrypted = await user.signer.nip44.decrypt(user.pubkey, ciphertext);
              const json = JSON.parse(decrypted);
              const result = EncryptedSettingsSchema.safeParse(json);
              currentSettings = result.success ? (result.data as EncryptedSettings) : (json ?? {}) as EncryptedSettings;
            } else {
              currentSettings = settings.data ?? {};
            }
          } catch {
            currentSettings = settings.data ?? {};
          }
        } else {
          currentSettings = settings.data ?? {};
        }
      }
      const mergedPatch: Partial<EncryptedSettings> = { ...patch };
      for (const key of ['dmReadCursors', 'groupReadCursors'] as const) {
        const current = currentSettings[key] ?? {};
        const next = patch[key] ?? {};
        if (Object.keys(next).length > 0 || Object.keys(current).length > 0) {
          const merged = { ...current };
          let changed = false;
          for (const [id, ts] of Object.entries(next)) {
            if (ts > (merged[id] ?? 0)) {
              merged[id] = ts;
              changed = true;
            }
          }
          if (changed || Object.keys(current).length !== Object.keys(next).length) {
            mergedPatch[key] = merged;
          }
        }
      }

      const updatedSettings: EncryptedSettings = {
        ...currentSettings,
        ...mergedPatch,
        lastSync: Date.now(),
      };

      // Optimistically track so the next rapid mutation sees this state immediately
      pendingSettings.current = updatedSettings;

      // Encrypt the settings
      const plaintext = JSON.stringify(updatedSettings);
      const encrypted = await user.signer.nip44.encrypt(user.pubkey, plaintext);

      // Build tags; try to upload a redundant Blossom backup in the background.
      const tags: string[][] = [
        ['d', `${config.appId}/metadata`],
        ['title', `${config.appName} Metadata`],
        ['client', config.appName, ...(config.client ? [config.client] : [])],
      ];

      try {
        const backupFile = createBackupFile(encrypted);
        const uploadTags = await uploadFile(backupFile);
        const url = uploadTags[0]?.[1];
        if (url) {
          tags.push(buildBlossomBackupTag(url, encrypted));
        }
      } catch (error) {
        // Backup is best-effort; the primary encrypted content is still published below.
        console.warn('Failed to upload encrypted settings backup:', error);
      }

      // Sign the event
      const unsignedEvent = {
        kind: 30078,
        content: encrypted,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      const signedEvent = await user.signer.signEvent(unsignedEvent);

      // Mark that we just wrote, so NostrSync doesn't fight us.
      lastWriteTs = Date.now();

      // Publish in background
      nostr.event(signedEvent, { signal: AbortSignal.timeout(5000) }).catch((error) => {
        console.error('Failed to publish encrypted settings:', error);
      });

      return { updatedSettings, signedEvent };
    },
    // Update cache in-place instead of refetching, which avoids
    // NostrSync re-running and causing a re-render loop.
    // Do NOT invalidate the encryptedSettings query here — doing so triggers a
    // relay refetch that can return the old event before the new one propagates,
    // which causes NostrSync to overwrite the theme the user just selected.
    //
    // Use the signed event's ID (not the old query event ID) so the parsed
    // settings cache entry is keyed correctly and NostrSync picks it up.
    onSuccess: ({ updatedSettings, signedEvent }) => {
      queryClient.setQueryData(['encryptedSettings', user?.pubkey], signedEvent);
      queryClient.setQueryData(['parsedSettings', signedEvent.id], updatedSettings);
      // Cache is now up to date — pending ref no longer needed
      pendingSettings.current = null;
      // Persist the sync timestamp so the next page load can skip the spinner
      if (user && updatedSettings.lastSync) {
        setLocalSettingsSync(config.appId, user.pubkey, updatedSettings.lastSync);
      }
    },
  });

  // Initialize settings if they don't exist
  const initializeSettings = async (initialSettings: Partial<EncryptedSettings>) => {
    if (settings.data !== null || !user?.signer?.nip44) {
      return; // Already initialized or no encryption support
    }

    try {
      await updateSettings.mutateAsync(initialSettings);
    } catch (error) {
      console.warn('Failed to initialize encrypted settings:', error);
    }
  };

  return {
    settings: settings.data,
    /** The created_at timestamp of the verified raw encrypted-settings event, if any. */
    settingsCreatedAt: query.data && settings.data ? query.data.created_at : undefined,
    isLoading: query.isLoading || settings.isLoading,
    isError: query.isError || settings.isError,
    error: query.error || settings.error,
    updateSettings,
    initializeSettings,
    hasNip44Support: !!user?.signer?.nip44,
    lastSync: settings.data?.lastSync,
    /** True if a local write happened recently. NostrSync should skip applying. */
    recentlyWritten: () => Date.now() - lastWriteTs < 10_000,
  };
}
