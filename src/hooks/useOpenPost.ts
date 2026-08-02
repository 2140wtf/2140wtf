import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';

/**
 * Returns onClick and onAuxClick handlers for navigating to a post URL.
 * - Left click: navigate in the same tab
 * - Middle click: open in a new tab (web only — native WebView has no tabs)
 */
export function useOpenPost(path: string) {
  const navigate = useNavigate();

  const onClick = () => navigate(path);

  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    // No tabs exist inside a Capacitor WebView; window.open on native either
    // no-ops or resolves to a broken capacitor://localhost/… URL.
    if (Capacitor.isNativePlatform()) return;
    window.open(path, '_blank');
  };

  return { onClick, onAuxClick };
}
