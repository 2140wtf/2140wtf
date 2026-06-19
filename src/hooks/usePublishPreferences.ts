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
  | 'autoShareTheme'
  | 'publishRelayList'
  | 'publishBlossomList';

/**
 * User-controlled publishing preferences.
 *
 * All features default to enabled (`true`). When a feature is disabled, the
 * app should not publish the corresponding Nostr event. This lets users
 * decide what they share on Nostr and what stays local.
 */
export function usePublishPreferences() {
  const { settings, updateSettings } = useEncryptedSettings();
  const prefs = settings?.publishPreferences ?? {};

  const isEnabled = (feature: PublishFeature) => prefs[feature] !== false;

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
