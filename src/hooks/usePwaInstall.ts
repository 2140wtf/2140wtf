import { useCallback, useEffect, useRef, useState } from 'react';

/** Chrome/Edge `beforeinstallprompt` event (not in standard TS DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectInstalled(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari sets window.navigator.standalone when launched from the
    // home screen.
    if ((navigator as { standalone?: boolean }).standalone === true) return true;
  } catch {
    // matchMedia unavailable — treat as not installed.
  }
  return false;
}

/**
 * PWA install state.
 *
 * Chrome/Android fires `beforeinstallprompt` (deferrable native prompt);
 * iOS Safari never does — there the user must Share → Add to Home Screen,
 * so `promptInstall` returns `'instructions'` and the caller shows a
 * how-to dialog instead.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(detectInstalled);
  const initializedFromGlobal = useRef(false);

  useEffect(() => {
    // If the prompt fired before React mounted, main.tsx stashed it here.
    if (!initializedFromGlobal.current && window.__deferredInstallPrompt) {
      initializedFromGlobal.current = true;
      setDeferred(window.__deferredInstallPrompt);
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      const e = event as BeforeInstallPromptEvent;
      window.__deferredInstallPrompt = e;
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      window.__deferredInstallPrompt = undefined;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isMobile = isIos || isAndroid;
  // Show the install entry point on any mobile browser. Chrome/Edge only fire
  // `beforeinstallprompt` when the site passes all installability checks; on
  // Android browsers that haven't fired it yet (or never will, e.g. in-app
  // browsers) we still want users to see the option and get instructions for
  // the browser menu's "Add to Home screen" path.
  const canInstall = !installed && (deferred !== null || isMobile);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'instructions'> => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      // The deferred event is single-use regardless of outcome.
      setDeferred(null);
      window.__deferredInstallPrompt = undefined;
      return choice.outcome;
    }
    return 'instructions';
  }, [deferred]);

  return { canInstall, installed, isIos, isAndroid, isMobile, promptInstall };
}
