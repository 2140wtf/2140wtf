import { useAppearanceModes } from '@/hooks/useAppearanceModes';
import { cn } from '@/lib/utils';

/** Top-bar color switch: segmented on desktop and one-button cycling on mobile. */
export function ThemeQuickSwitch({ compact = false }: { compact?: boolean }) {
  const modes = useAppearanceModes();

  if (compact) {
    const currentIndex = modes.findIndex((mode) => mode.active);
    const current = modes[currentIndex] ?? modes[0];
    const next = modes[(currentIndex + 1 + modes.length) % modes.length];
    const Icon = current.icon;

    return (
      <button
        type="button"
        onClick={next.onSelect}
        aria-label={`Color mode: ${current.label}; switch to ${next.label}`}
        title={`Color mode: ${current.label}; switch to ${next.label}`}
        className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      {modes.map(({ id, label, icon: Icon, active, onSelect }) => (
        <button
          key={id}
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={label}
          title={label}
          className={cn(
            'flex size-6 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
