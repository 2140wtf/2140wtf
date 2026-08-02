import { Moon, Sun, Terminal, type LucideIcon } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import { themePresets } from '@/themes';

export type AppearanceModeId = 'bright' | 'dark' | 'hacker';

export interface AppearanceMode {
  id: AppearanceModeId;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
}

/** Fast access to the three primary color modes without opening theme settings. */
export function useAppearanceModes(): AppearanceMode[] {
  const { theme, customTheme, setTheme, applyCustomTheme } = useTheme();
  const hacker = themePresets.hacker;

  return [
    {
      id: 'bright',
      label: 'Bright',
      icon: Sun,
      active: theme === 'light',
      onSelect: () => setTheme('light'),
    },
    {
      id: 'dark',
      label: 'Dark',
      icon: Moon,
      active: theme === 'dark',
      onSelect: () => setTheme('dark'),
    },
    {
      id: 'hacker',
      label: 'Hacker',
      icon: Terminal,
      active: theme === 'custom' && customTheme?.title === hacker.label,
      onSelect: () => applyCustomTheme(hacker),
    },
  ];
}
