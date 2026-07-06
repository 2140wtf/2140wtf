import { useEffect, useState } from 'react';

import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';

/**
 * Detect WebGL support without throwing.
 */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (
      typeof window !== 'undefined' &&
      !!window.WebGLRenderingContext &&
      (canvas.getContext('webgl') !== null ||
        canvas.getContext('experimental-webgl') !== null)
    );
  } catch {
    return false;
  }
}

/**
 * Whether the user has enabled 3D pet/room rendering and the device can render it.
 *
 * Honors:
 *   - encrypted setting `pets3dEnabled` (default false)
 *   - WebGL availability
 *   - prefers-reduced-motion (falls back to SVG / 2D)
 */
export function usePets3DEnabled(): boolean {
  const { settings } = useEncryptedSettings();
  const [webglAvailable, setWebglAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setWebglAvailable(hasWebGL());

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);

    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  if (!settings?.pets3dEnabled) return false;
  if (reducedMotion) return false;
  return webglAvailable;
}
