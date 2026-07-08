import { useAppContext } from '@/hooks/useAppContext';
import { cn } from '@/lib/utils';

interface AppLogoProps {
  className?: string;
  size?: number;
}

/** The app logo — 2140 branding used in the sidebar, top bar, and loading screens. */
export function AppLogo({ className, size = 40 }: AppLogoProps) {
  const { config } = useAppContext();

  return (
    <img
      src="/logo.jpg"
      alt={config.appName}
      width={size}
      height={size}
      className={cn('block object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
