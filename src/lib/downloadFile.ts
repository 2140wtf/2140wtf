import { Capacitor } from '@capacitor/core';

/**
 * Download a text file to the user's device.
 *
 * On the web this uses the classic `<a download>` trick.
 * On native (Android & iOS) the file is saved to the app's Documents
 * directory, which is visible in the iOS Files app and Android's
 * app-scoped documents. No permissions are required.
 */
export async function downloadTextFile(filename: string, content: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');

    // Write straight to Documents — visible in the iOS Files app and
    // Android's app-scoped documents. No storage permissions needed.
    // NOTE: encoding is required — without it Capacitor expects base64 data
    // and will throw for plain-text strings.
    await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
  } else {
    // Web: use the anchor-click download pattern
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url = globalThis.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    globalThis.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

/** Save a base64 data URL as a binary file on web or Capacitor native. */
export async function downloadDataUrlFile(filename: string, dataUrl: string): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename) || filename.includes('..')) {
    throw new Error('Invalid download filename');
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid base64 data URL');

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: filename,
      data: match[2],
      directory: Directory.Documents,
    });
    return;
  }

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Open a URL in a new browser tab, or present the native share sheet on Capacitor.
 *
 * The programmatic `<a target="_blank">` click pattern doesn't work inside
 * WKWebView on iOS. On native platforms this presents the share sheet instead,
 * letting the user open, save, or share the resource.
 */
export async function openUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
