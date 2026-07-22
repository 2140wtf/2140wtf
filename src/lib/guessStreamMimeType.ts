const EXTENSION_TO_STREAM_MIME: Record<string, string> = {
  m3u8: 'application/x-mpegURL',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  weba: 'audio/webm',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

/**
 * Guess a stream MIME type from an explicit hint or the URL's file extension.
 * Used by the live stream player to decide whether a URL is an HLS manifest
 * or a plain progressive audio/video stream.
 */
export function guessStreamMimeType(url: string, typeTag?: string): string | undefined {
  if (typeTag) return typeTag;
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (ext && EXTENSION_TO_STREAM_MIME[ext]) return EXTENSION_TO_STREAM_MIME[ext];
  } catch {
    // ignore malformed URLs
  }
  return undefined;
}
