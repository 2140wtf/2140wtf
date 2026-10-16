/**
 * Strip privacy-sensitive metadata (EXIF, GPS, device info, etc.) from image
 * and video files before upload. The content is re-encoded so only pixel/frame
 * data remains; all container metadata is discarded.
 *
 * This is a best-effort helper: unsupported formats or browsers fall back to
 * the original file so uploads don't break.
 */

const VIDEO_STRIP_SECONDS_THRESHOLD = 60;

/** Strip metadata from an image by re-drawing it to a canvas. */
async function stripImageMetadata(file: File): Promise<File> {
  // Canvas re-encoding would destroy GIF animation and SVG structure.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D canvas context');
    }

    ctx.drawImage(bitmap, 0, 0);

    // Preserve PNG for transparency; everything else becomes JPEG.
    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = outputType === 'image/jpeg' ? 0.92 : undefined;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, quality),
    );
    if (!blob) {
      throw new Error('Canvas toBlob returned null');
    }

    const ext = outputType === 'image/png' ? '.png' : '.jpg';
    const name = file.name.replace(/\.[^.]+$/, '') + ext;
    return new File([blob], name, { type: outputType, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

/** Strip metadata from a video by re-encoding it through MediaRecorder. */
async function stripVideoMetadata(file: File): Promise<File> {
  if (
    !('captureStream' in HTMLVideoElement.prototype) ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new Error('Video metadata stripping is not supported in this browser');
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';

  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video for metadata stripping'));
    });

    // Re-encoding long videos in real time is too slow for typical uploads.
    if (video.duration > VIDEO_STRIP_SECONDS_THRESHOLD) {
      throw new Error(
        `Video is longer than ${VIDEO_STRIP_SECONDS_THRESHOLD}s; skipping metadata strip to avoid long processing`,
      );
    }

    await video.play();

    const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    const mimeType = MediaRecorder.isTypeSupported(file.type) ? file.type : 'video/webm';
    const chunks: BlobPart[] = [];

    const recorded = new Promise<File>((resolve, reject) => {
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType === 'video/webm' ? '.webm' : getFileExtension(file.name);
        const name = file.name.replace(/\.[^.]+$/, '') + ext;
        resolve(new File([blob], name, { type: mimeType, lastModified: Date.now() }));
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        reject(new Error('MediaRecorder failed while stripping video metadata'));
      };

      video.onended = () => recorder.stop();
      recorder.start();
    });

    return await recorded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Return the lower-case extension (with dot) from a filename, or empty string. */
function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return filename.slice(dotIndex).toLowerCase();
}

/**
 * Probe a media file for a video track by loading its metadata. Returns `true`
 * when it has a real video track (dimensions > 0), `false` when it is
 * audio-only, and `true` on any failure (assume video so behaviour is
 * unchanged when probing isn't possible).
 */
async function mediaHasVideoTrack(file: File): Promise<boolean> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = () => resolve();
      video.onloadedmetadata = done;
      video.onerror = () => reject(new Error('load failed'));
      // Some containers report dimensions only after the first frame.
      window.setTimeout(done, 4000);
    });
    return video.videoWidth > 0 && video.videoHeight > 0;
  } catch {
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Pick an audio MIME type for a file whose bytes are an audio-only media
 * container. The container family is taken from the reported type first
 * (a `video/mp4` container that carries only audio is still an MP4), then from
 * the filename extension.
 */
function audioTypeFor(file: File): string {
  const t = file.type.toLowerCase();
  if (t === 'video/webm') return 'audio/webm';
  if (t === 'video/ogg') return 'audio/ogg';
  if (t.startsWith('video/')) return 'audio/mp4';
  switch (getFileExtension(file.name)) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg':
    case '.oga': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.m4a':
    case '.m4b':
    case '.mp4': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.opus': return 'audio/opus';
    default: return 'audio/mp4';
  }
}

/**
 * Strip metadata from an image or video file when possible.
 * Falls back to the original file for unsupported formats/browsers.
 */
export async function stripFileMetadata(file: File): Promise<File> {
  try {
    if (file.type.startsWith('image/')) {
      return await stripImageMetadata(file);
    }
    if (file.type.startsWith('video/')) {
      // Audio-only files are frequently reported as `video/mp4` by the OS /
      // browser (any `.mp4` / `.m4a` container). Probe for a video track: when
      // there is none, retype it as audio so the app uploads and renders it as
      // audio (waveform) instead of a blank video player — and so it is never
      // re-encoded by the video metadata stripper.
      if (!(await mediaHasVideoTrack(file))) {
        return new File([file], file.name, { type: audioTypeFor(file), lastModified: file.lastModified });
      }
      return await stripVideoMetadata(file);
    }
  } catch (err) {
    console.warn(`Metadata stripping failed for ${file.name}, uploading original.`, err);
  }
  return file;
}
