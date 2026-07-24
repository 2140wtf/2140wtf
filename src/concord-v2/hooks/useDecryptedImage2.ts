import { useEffect, useState } from "react";

import { decryptImagePointer } from "@/concord-v2/lib/image";
import type { ImagePointer } from "@/concord-v2/lib/types";

/**
 * Resolve an encrypted V2 {@link ImagePointer} (icon / banner) to a
 * displayable object URL. Same discipline as V1's hook: decrypt-once cache per
 * (url, key, nonce), synchronous seeding from the resolved cache so a remount
 * paints on the first frame, object URLs never revoked (bounded cache).
 */

const MAX_CACHED = 128;
const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

function cacheKey(image: ImagePointer): string {
  return `${image.url}\n${image.key}\n${image.nonce}`;
}

/** Returns the decrypted object URL, or null while loading / on failure. */
export function useDecryptedImage2(image: ImagePointer | undefined): string | null {
  const url = image?.url;
  const key = image?.key;
  const nonce = image?.nonce;
  const [src, setSrc] = useState<string | null>(() =>
    image ? resolved.get(cacheKey(image)) ?? null : null,
  );

  useEffect(() => {
    if (!image || !url || !key || !nonce) {
      setSrc(null);
      return;
    }
    const ck = cacheKey(image);
    const ready = resolved.get(ck);
    if (ready) {
      setSrc(ready);
      return;
    }

    let cancelled = false;
    let promise = cache.get(ck);
    if (!promise) {
      promise = decryptImagePointer(image);
      cache.set(ck, promise);
      promise
        .then((u) => {
          resolved.set(ck, u);
          if (resolved.size > MAX_CACHED) {
            const oldest = resolved.keys().next().value;
            if (oldest !== undefined && oldest !== ck) resolved.delete(oldest);
          }
        })
        .catch(() => {
          if (cache.get(ck) === promise) cache.delete(ck);
        });
      if (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined && oldest !== ck) cache.delete(oldest);
      }
    }
    setSrc(null);
    promise
      .then((u) => {
        if (!cancelled) setSrc(u);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, nonce]);

  return src;
}
