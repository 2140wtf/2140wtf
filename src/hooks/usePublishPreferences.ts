import { useEncryptedSettings } from './useEncryptedSettings';

export type PublishFeature =
  | 'pets'
  | 'reactions'
  | 'reposts'
  | 'comments'
  | 'zaps'
  | 'follows'
  | 'mutes'
  | 'bookmarks'
  | 'publishRelayList'
  | 'publishBlossomList'
  | 'notes'
  | 'polls'
  | 'photos'
  | 'articles'
  | 'marketplace'
  | 'badges'
  | 'profile'
  | 'lists'
  | 'rsvp'
  | 'reports'
  | 'roadstr'
  | 'directMessages'
  | 'recovery'
  | 'encryptedSettings'
  | 'deleteRequests'
  | 'drafts'
  | 'emojiPacks'
  | 'liveChat'
  | 'themeDefinitions'
  | 'pushSubscriptions'
  | 'nutzaps';

/**
 * Per-feature default state. Most features default to enabled so existing users
 * keep their current behavior. New, more revealing features default to off.
 */
const FEATURE_DEFAULTS: Record<PublishFeature, boolean> = {
  pets: true,
  reactions: true,
  reposts: true,
  comments: true,
  zaps: true,
  follows: true,
  mutes: true,
  bookmarks: true,
  publishRelayList: true,
  publishBlossomList: true,
  notes: true,
  polls: true,
  photos: true,
  articles: true,
  marketplace: true,
  badges: true,
  profile: true,
  lists: true,
  rsvp: true,
  reports: true,
  roadstr: true,
  directMessages: true,
  recovery: true,
  encryptedSettings: true,
  deleteRequests: true,
  drafts: true,
  emojiPacks: true,
  liveChat: true,
  themeDefinitions: true,
  pushSubscriptions: true,
  nutzaps: false,
};

/**
 * User-controlled publishing preferences.
 *
 * All features default to enabled (`true`) unless listed in
 * `FEATURE_DEFAULTS`. When a feature is disabled, the app should not publish
 * the corresponding Nostr event. This lets users decide what they share on
 * Nostr and what stays local.
 */
export function usePublishPreferences() {
  const { settings, updateSettings } = useEncryptedSettings();
  const prefs = settings?.publishPreferences ?? {};

  const isEnabled = (feature: PublishFeature) => prefs[feature] ?? FEATURE_DEFAULTS[feature];

  const setEnabled = (feature: PublishFeature, enabled: boolean) => {
    updateSettings.mutate({
      publishPreferences: {
        ...prefs,
        [feature]: enabled,
      },
    });
  };

  return {
    prefs,
    isEnabled,
    setEnabled,
    isLoading: updateSettings.isPending,
  };
}
