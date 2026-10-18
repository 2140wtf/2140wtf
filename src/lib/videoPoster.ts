/**
 * Client-side video poster capture.
 *
 * NIP-92 media posts describe a video's poster in the imeta `image` field.
 * Videos uploaded from this app never set it, so every surface (our feed, the
 * media collage, other clients) fell back to a black box. Capturing a frame at
 * upload time fixes the post for everyone.
 *
 * The capture runs against a local `blob:` URL, so the canvas is same-origin
 * and never tainted by the host's CORS policy.
 */

export interface VideoPoster {
  /** JPEG-encoded frame, ready to upload as its own Blossom blob. */
  blob: Blob;
  /** Frame dimensions in pixels (same as the video's display size). */
  width: number;
  height: number;
}

/** Seek a little past t=0: many videos start on a black fade-in frame. */
const SEEK_SECONDS = 0.1;
/** Posters are shown at feed/card size — 720px wide is plenty. */
const MAX_POSTER_WIDTH = 720;
const CAPTURE_TIMEOUT_MS = 10_000;
const JPEG_QUALITY = 0.82;

/** True when the file should get a poster frame. */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|m4v|webm|mov|qt|av1|mkv)$/i.test(file.name);
}

/** Resolve when the element emits `event`, reject on timeout or media error. */
function waitFor(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onEvent);
      el.removeEventListener('error', onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video could not be decoded'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    el.addEventListener(event, onEvent, { once: true });
    el.addEventListener('error', onError, { once: true });
  });
}

/**
 * Capture a poster frame from a local video file.
 *
 * Resolves `null` (never rejects) when the browser cannot decode the video, the
 * seek stalls, or the canvas is unavailable — a missing poster must never break
 * an upload.
 */
export async function captureVideoPoster(file: Blob): Promise<VideoPoster | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  // Detached element: enough for decoding, and never laid out on screen.
  video.src = objectUrl;

  try {
    await waitFor(video, 'loadedmetadata', CAPTURE_TIMEOUT_MS);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = duration > 0 ? Math.min(SEEK_SECONDS, duration / 2) : SEEK_SECONDS;
    if (target > 0) {
      video.currentTime = target;
      // A seek that never completes (some fragmented MP4s) falls back to
      // whatever frame the element already holds.
      await waitFor(video, 'seeked', CAPTURE_TIMEOUT_MS).catch(() => undefined);
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;

    const scale = Math.min(1, MAX_POSTER_WIDTH / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob || blob.size === 0) return null;

    return { blob, width, height };
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
