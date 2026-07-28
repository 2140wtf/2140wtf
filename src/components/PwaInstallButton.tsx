import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, Share } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { cn } from '@/lib/utils';

interface PwaInstallButtonProps {
  /** Extra classes forwarded to the `<button>` (defaults to drawer-item styling). */
  className?: string;
  /** Called after the install flow starts (e.g. close the drawer). */
  onAction?: () => void;
}

/**
 * "Install app" button — lets mobile users add 2140.wtf to their home
 * screen as a PWA, no app store or APK needed.
 *
 * Chrome/Android: triggers the native install prompt. iOS Safari: opens a
 * dialog explaining Share → Add to Home Screen. Renders nothing when the
 * app is already installed or running inside the native (Capacitor) shell.
 */
export function PwaInstallButton({ className, onAction }: PwaInstallButtonProps) {
  const { canInstall, isIos, promptInstall } = usePwaInstall();
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  if (Capacitor.isNativePlatform() || !canInstall) return null;

  const handleClick = async () => {
    onAction?.();
    const outcome = await promptInstall();
    if (outcome === 'instructions') setInstructionsOpen(true);
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={cn(
          'flex items-center gap-4 w-full px-4 py-2.5 text-sm font-normal text-muted-foreground hover:bg-secondary/60 transition-colors',
          className,
        )}
      >
        <Download className="size-5 shrink-0" />
        <span>Install app</span>
      </button>

      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Install 2140.wtf</DialogTitle>
            <DialogDescription>
              Add the app to your home screen — no app store needed.
            </DialogDescription>
          </DialogHeader>
          {isIos ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">
                Tap the <Share className="size-4 shrink-0" /> Share button in Safari.
              </li>
              <li>Scroll down and tap <span className="font-medium text-foreground">Add to Home Screen</span>.</li>
              <li>Tap <span className="font-medium text-foreground">Add</span> — done, the app is on your home screen.</li>
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Open your browser menu and choose{' '}
              <span className="font-medium text-foreground">Install app</span> or{' '}
              <span className="font-medium text-foreground">Add to Home screen</span>.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
