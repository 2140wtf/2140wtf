import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { ThemeConfig } from '@/themes';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { usePublishPreferences } from './usePublishPreferences';
import { toast } from './useToast';
import {
  THEME_DEFINITION_KIND,
  buildThemeDefinitionTags,
  titleToSlug,
  type ThemeDefinition,
} from '@/lib/themeEvent';
import { resolveFontUrl } from '@/lib/fontLoader';

/**
 * Resolve font URLs for Nostr publishing.
 * Bundled fonts get CDN URLs, others keep their existing URL.
 * If no title font is set, it falls back to the body font so published
 * events always include both font tags when a body font is present.
 */
function resolveThemeForPublishing(config: ThemeConfig): ThemeConfig {
  const effectiveTitleFont = config.titleFont ?? config.font;
  return {
    ...config,
    font: config.font ? {
      family: config.font.family,
      url: resolveFontUrl(config.font.family, config.font.url),
    } : undefined,
    titleFont: effectiveTitleFont ? {
      family: effectiveTitleFont.family,
      url: resolveFontUrl(effectiveTitleFont.family, effectiveTitleFont.url),
    } : undefined,
  };
}

export function usePublishTheme() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const themeDefinitionsEnabled = isEnabled('themeDefinitions');
  const deleteRequestsEnabled = isEnabled('deleteRequests');
  const queryClient = useQueryClient();

  /** Publish or update a kind 36767 theme definition. */
  const publishTheme = useCallback(async (opts: {
    themeConfig: ThemeConfig;
    title: string;
    description?: string;
    /** Existing identifier to update; if omitted, generates from title */
    identifier?: string;
  }) => {
    if (!user) throw new Error('Must be logged in');
    if (!themeDefinitionsEnabled) {
      toast({
        title: 'Theme definitions publishing disabled',
        description: 'Turn on “Theme definitions” in Settings → Privacy & Publishing to publish themes.',
      });
      throw new Error('Theme definitions publishing disabled');
    }

    const identifier = opts.identifier || titleToSlug(opts.title);
    const resolved = resolveThemeForPublishing(opts.themeConfig);
    const tags = buildThemeDefinitionTags(identifier, opts.title, resolved, opts.description);

    await publishEvent({
      kind: THEME_DEFINITION_KIND,
      content: '',
      tags,
    });

    // Invalidate the user's theme list cache
    queryClient.invalidateQueries({ queryKey: ['userThemes', user.pubkey] });

    return identifier;
  }, [user, publishEvent, queryClient, themeDefinitionsEnabled]);

  /** Delete a kind 36767 theme definition. */
  const deleteTheme = useCallback(async (theme: ThemeDefinition) => {
    if (!user) throw new Error('Must be logged in');
    if (!deleteRequestsEnabled) {
      toast({
        title: 'Delete requests publishing disabled',
        description: 'Turn on “Delete requests” in Settings → Privacy & Publishing to delete themes.',
      });
      throw new Error('Delete requests publishing disabled');
    }

    await publishEvent({
      kind: 5,
      content: '',
      tags: [
        ['e', theme.event.id],
        ['a', `${THEME_DEFINITION_KIND}:${user.pubkey}:${theme.identifier}`],
        ['k', String(THEME_DEFINITION_KIND)],
      ],
    });

    // Optimistically remove the deleted theme from the query cache immediately
    // (the pool's internal cache may still return the event on re-query)
    queryClient.setQueryData<ThemeDefinition[]>(
      ['userThemes', user.pubkey],
      (old) => old?.filter((t) => t.identifier !== theme.identifier) ?? [],
    );
    // Also invalidate feed caches so the theme disappears from public feeds
    queryClient.invalidateQueries({ queryKey: ['feed'] });
    queryClient.invalidateQueries({ queryKey: ['streamKind'] });
  }, [user, publishEvent, queryClient, deleteRequestsEnabled]);

  return { publishTheme, deleteTheme, isPending };
}
