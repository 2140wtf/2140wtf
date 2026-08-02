import { Palette } from 'lucide-react';

import { useAppearanceModes } from '@/hooks/useAppearanceModes';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

/** Top-bar color switch: segmented on desktop and one-button cycling on mobile. */
export function ThemeQuickSwitch({ compact = false }: { compact?: boolean }) {
  const modes = useAppearanceModes();
  const { theme, customTheme } = useTheme();
  const activeMode = modes.find((mode) => mode.active);
  const fallbackLabel = theme === 'system' ? 'System' : customTheme?.title ?? 'Custom';

  if (compact) {
    const currentIndex = modes.findIndex((mode) => mode.active);
    const current = modes[currentIndex];
    const next = current ? modes[(currentIndex + 1) % modes.length] : modes[0];
    const Icon = current?.icon ?? Palette;
    const currentLabel = current?.label ?? fallbackLabel;

    return (
      <button
        type="button"
        onClick={next.onSelect}
        aria-label={`Color mode: ${currentLabel}; switch to ${next.label}`}
        title={`Color mode: ${currentLabel}; switch to ${next.label}`}
        className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Color mode"
      className="flex items-center gap-0.5 rounded-full border border-border bg-background/85 p-0.5"
    >
      {!activeMode && (
        <button
          type="button"
          onClick={modes[0].onSelect}
          aria-pressed="true"
          aria-label={`${fallbackLabel} color theme; switch to Bright`}
          title={`${fallbackLabel}; switch to Bright`}
          className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Palette className="size-3.5" />
        </button>
      )}
      {modes.map(({ id, label, icon: Icon, active, onSelect }) => (
        <button
          key={id}
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={label}
          title={label}
          className={cn(
            'flex size-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
