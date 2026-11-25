import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppContext } from './useAppContext';
import { getEffectiveBlossomServers } from '@/lib/appBlossom';

/** SHA-256 hash at the start of a Blossom content-addressed path (`/<sha256>` or `/<sha256>.mp4`). */
const BLOSSOM_PATH_REGEX = /^\/([a-f0-9]{64})(\.[a-z0-9]+)?/i;

/**
 * Mirror URLs to try after the original Blossom blob URL fails.
 *
 * Order:
 * 1. Same origin, extension stripped — some servers 404 on `/<sha256>.mp4`
 *    even though BUD-01 says they MUST ignore a suffix.
 * 2. Each other configured server, with the original path, then without the
 *    suffix when the original had one.
 *
 * The original URL itself is not included; the hook serves that first.
 */
export function blossomFallbackUrls(originalUrl: string, servers: string[]): string[] {
  try {
    const parsed = new URL(originalUrl);
    const match = BLOSSOM_PATH_REGEX.exec(parsed.pathname);
    if (!match) return [];

    const hash = match[1].toLowerCase();
    const ext = match[2] ?? '';
    const rest = parsed.pathname.slice(match[0].length);
    const search = parsed.search;
    const origin = parsed.origin;

    const seen = new Set<string>([originalUrl]);
    const out: string[] = [];
    const add = (url: string) => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push(url);
    };

    if (ext) add(`${origin}/${hash}${rest}${search}`);

    for (const server of servers) {
      let serverOrigin: string;
      try {
        serverOrigin = new URL(server).origin;
      } catch {
        continue;
      }
      if (serverOrigin === origin) continue;
      add(`${serverOrigin}/${hash}${ext}${rest}${search}`);
      if (ext) add(`${serverOrigin}/${hash}${rest}${search}`);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Given a media URL, provides fallback URLs from other configured Blossom servers.
 *
 * If the URL points to a Blossom server (path matches `/<sha256>...`), and the
 * primary URL fails to load, calling `onError()` swaps to the next candidate
 * (mirrors, then the same blob without a fake file extension).
 *
 * Returns `{ src, onError }` — wire these onto `<img>` or `<video>` elements.
 * `onError` returns `true` when it switched to another URL so the caller can
 * retry; `false` means every candidate has failed.
 */
export function useBlossomFallback(originalUrl: string) {
  const { config } = useAppContext();
  const [fallbackIndex, setFallbackIndex] = useState(-1);
  const failedRef = useRef(false);

  const servers = getEffectiveBlossomServers(
    config.blossomServerMetadata,
    config.useAppBlossomServers,
  );

  const alternatives = useMemo(
    () => blossomFallbackUrls(originalUrl, servers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [originalUrl, config.blossomServerMetadata, config.useAppBlossomServers],
  );

  useEffect(() => {
    setFallbackIndex(-1);
    failedRef.current = false;
  }, [originalUrl]);

  const src = fallbackIndex < 0 ? originalUrl : (alternatives[fallbackIndex] ?? originalUrl);

  const onError = useCallback((): boolean => {
    const next = fallbackIndex + 1;
    if (next < alternatives.length) {
      setFallbackIndex(next);
      return true;
    }
    failedRef.current = true;
    return false;
  }, [alternatives, fallbackIndex]);

  // All candidate URLs (the original plus every mirror / extensionless variant),
  // used by callers that want to probe mirrors concurrently instead of stepping
  // through them serially via onError. Memoized so components can depend on it.
  const candidates = useMemo(
    () => [originalUrl, ...alternatives],
    [originalUrl, alternatives],
  );

  return {
    src,
    onError,
    failed: failedRef.current && fallbackIndex >= alternatives.length - 1,
    candidates,
  };
}
