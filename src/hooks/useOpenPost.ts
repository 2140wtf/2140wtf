import { useNavigate } from 'react-router-dom';

import { openUrl } from '@/lib/downloadFile';

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
    // openUrl bridges web (new tab) and native (share sheet) so middle-click
    // works everywhere instead of no-oping inside the Capacitor WebView.
    void openUrl(path).catch(() => {});
  };

  return { onClick, onAuxClick };
}
