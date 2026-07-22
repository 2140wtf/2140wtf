import { ReactNode, useLayoutEffect, useEffect } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme } from '@/contexts/AppContext';
import { builtinThemes, buildThemeCssFromConfig, resolveTheme, resolveThemeConfig, type ThemeConfig, type ThemesConfig } from '@/themes';
import { RuntimeAppConfigSchema } from '@/lib/schemas';
import { loadAndApplyFont, loadAndApplyTitleFont } from '@/lib/fontLoader';
import { isAllowedHttpsUrl } from '@/lib/sanitizeUrl';

import { z } from 'zod';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence.
  // The deserializer uses safeParse per top-level field so that a single
  // invalid/incomplete field (e.g. feedSettings missing a new key) doesn't
  // nuke the entire config back to defaults. Valid fields are preserved.
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null) return {};

        const result: Partial<AppConfig> = {};
        // Validate each top-level field individually
        for (const key of Object.keys(parsed)) {
          const fieldSchema = RuntimeAppConfigSchema.shape[key as keyof typeof RuntimeAppConfigSchema.shape];
          if (fieldSchema) {
            const fieldResult = fieldSchema.safeParse(parsed[key]);
            if (fieldResult.success) {
              (result as Record<string, unknown>)[key] = fieldResult.data;
            }
          }
        }

        // Reset sidebar order when the default version has changed.
        const currentSidebarVersion = defaultConfig.sidebarOrderVersion ?? 0;
        if ((result.sidebarOrderVersion ?? 0) < currentSidebarVersion) {
          result.sidebarOrder = defaultConfig.sidebarOrder;
          result.sidebarOrderVersion = currentSidebarVersion;
        }

        // Reset right-sidebar widgets when the default widget set has changed.
        const currentWidgetsVersion = defaultConfig.sidebarWidgetsVersion ?? 0;
        if ((result.sidebarWidgetsVersion ?? 0) < currentWidgetsVersion) {
          result.sidebarWidgets = defaultConfig.sidebarWidgets;
          result.sidebarWidgetsVersion = currentWidgetsVersion;
        }

        // Reset theme to the new default when the default theme version has changed.
        const currentThemeVersion = defaultConfig.themeDefaultVersion ?? 0;
        if ((result.themeDefaultVersion ?? 0) < currentThemeVersion) {
          result.theme = defaultConfig.theme;
          result.customTheme = defaultConfig.customTheme;
          result.themeDefaultVersion = currentThemeVersion;
        }

        // Migrate legacy blossomServers (string[]) to blossomServerMetadata
        if (!result.blossomServerMetadata) {
          const legacyServers = parsed.blossomServers;
          if (Array.isArray(legacyServers)) {
            const parsed2 = z
              .array(z.string().url().refine(isAllowedHttpsUrl, { message: 'Blossom server URL must use https://' }))
              .safeParse(legacyServers);
            if (parsed2.success && parsed2.data.length > 0) {
              result.blossomServerMetadata = {
                servers: parsed2.data,
                updatedAt: 0,
              };
            }
          }
        }

        return result;
      }
    }
  );

  // Generic config updater with callback pattern
  const updateConfig = (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig(updater);
  };

  const config = {
    ...defaultConfig,
    ...rawConfig,
    // Deep-merge feedSettings so new keys added to the default are visible
    // even for existing users who have an older feedSettings in localStorage.
    feedSettings: { ...defaultConfig.feedSettings, ...rawConfig.feedSettings },
  };

  const appContextValue: AppContextType = {
    config,
    updateConfig,
  };

  // Apply theme effects to document
  useApplyTheme(config.theme, config.customTheme, config.themes);
  useApplyFonts(config.theme, config.customTheme, config.themes);
  useApplyBackground(config.theme, config.customTheme, config.themes);
  useApplyFavicon();

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to apply theme changes to the document root via an injected <style> tag.
 * When theme is "system", resolves to "light" or "dark" based on OS preference
 * and listens for changes to prefers-color-scheme.
 * When theme is "custom", uses the provided customTheme colors (derived to full tokens).
 * When theme is "light" or "dark", uses configured themes if available, otherwise builtin themes.
 */
function useApplyTheme(theme: Theme, customTheme: ThemeConfig | undefined, themes: ThemesConfig | undefined) {
  useLayoutEffect(() => {
    function apply() {
      const resolved = resolveTheme(theme);
      let css: string;

      if (resolved === 'custom') {
        // Use custom theme config, falling back to dark if not yet set
        const config = customTheme ?? { colors: builtinThemes.dark };
        css = buildThemeCssFromConfig(config);
      } else {
        css = buildThemeCssFromConfig(resolveThemeConfig(resolved, themes));
      }

      let el = document.getElementById('theme-vars') as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = 'theme-vars';
        document.head.appendChild(el);
      }
      el.textContent = css;
      document.documentElement.className = resolved;
      // Now that CSS variables are set, the inline body background from
      // theme.js is no longer needed — bg-background will resolve correctly.
      document.body.removeAttribute('style');
    }

    apply();

    // When theme is "system", listen for OS color scheme changes
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme, customTheme, themes]);
}

/**
 * Hook to load and apply custom fonts when the theme config changes.
 * Applies fonts from custom themes, or from configured light/dark themes if available.
 */
function useApplyFonts(theme: Theme, customTheme: ThemeConfig | undefined, themes: ThemesConfig | undefined) {
  const resolved = resolveTheme(theme);
  const activeConfig = resolved === 'custom' ? customTheme : resolveThemeConfig(resolved, themes);
  const fontFamily = activeConfig?.font?.family;
  const fontUrl = activeConfig?.font?.url;
  const titleFontFamily = activeConfig?.titleFont?.family;
  const titleFontUrl = activeConfig?.titleFont?.url;

  useEffect(() => {
    if (fontFamily) {
      loadAndApplyFont({ family: fontFamily, url: fontUrl });
    } else {
      // Clear any custom font overrides when no font is configured
      loadAndApplyFont(undefined);
    }
  }, [theme, fontFamily, fontUrl]);

  useEffect(() => {
    if (titleFontFamily) {
      loadAndApplyTitleFont({ family: titleFontFamily, url: titleFontUrl });
    } else {
      // Clear any custom title font overrides when no title font is configured
      loadAndApplyTitleFont(undefined);
    }
  }, [theme, titleFontFamily, titleFontUrl]);
}

/** Style element ID for background image CSS. */
const BG_STYLE_ID = 'theme-background';

/**
 * Hook to apply or remove a background image when the theme config changes.
 * Supports backgrounds from custom themes and configured light/dark themes.
 * When backgroundOpacity is < 1, the image is rendered on a `body::before`
 * pseudo-element so opacity only affects the image, not the body background color.
 */
function useApplyBackground(theme: Theme, customTheme: ThemeConfig | undefined, themes: ThemesConfig | undefined) {
  const resolved = resolveTheme(theme);
  const activeConfig = resolved === 'custom' ? customTheme : resolveThemeConfig(resolved, themes);
  const bgUrl = activeConfig?.background?.url;
  const bgMode = activeConfig?.background?.mode ?? 'cover';
  const bgOpacity = activeConfig?.backgroundOpacity ?? 1;

  useEffect(() => {
    let style = document.getElementById(BG_STYLE_ID) as HTMLStyleElement | null;

    if (!bgUrl) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement('style');
      style.id = BG_STYLE_ID;
      document.head.appendChild(style);
    }

    let css: string;
    if (bgOpacity < 1) {
      // Render the image behind content with adjustable opacity.
      const baseProps = bgMode === 'tile'
        ? `background-image: url("${bgUrl}"); background-repeat: repeat; background-size: auto;`
        : `background-image: url("${bgUrl}"); background-size: cover; background-repeat: no-repeat; background-position: center; background-attachment: fixed;`;
      css = `body::before { content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none; ${baseProps} opacity: ${bgOpacity}; }`;
    } else if (bgMode === 'tile') {
      css = `body { background-image: url("${bgUrl}"); background-repeat: repeat; background-size: auto; }`;
    } else {
      css = `body { background-image: url("${bgUrl}"); background-size: cover; background-repeat: no-repeat; background-position: center; background-attachment: fixed; }`;
    }

    style.textContent = css;

    return () => {
      document.getElementById(BG_STYLE_ID)?.remove();
    };
  }, [theme, bgUrl, bgMode, bgOpacity]);
}

/** Keep the favicon pointing at the 2140 logo. */
function useApplyFavicon() {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link && !link.href.endsWith('/logo.jpg')) {
      link.type = 'image/jpeg';
      link.href = '/logo.jpg';
    }
  }, []);
}
