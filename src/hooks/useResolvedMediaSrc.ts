import { useEffect, useState } from "react";

import { decryptAttachmentToObjectURL } from "@/lib/encryptedMedia";

import type { ImetaEncryption } from "@/lib/imeta";

/** A possibly-encrypted media reference resolved for display. */
export interface EncryptedRef {
  url: string;
  encryption?: ImetaEncryption;
  mime?: string;
  /** NIP-94 `dim` hint ("WxH") — sizes placeholders before load (display only). */
  dim?: string;
  /** NIP-94 `blurhash` hint — blur-up placeholder before load (display only). */
  blurhash?: string;
}

type State =
  | { status: "ready"; src: string }
  | { status: "loading" }
  | { status: "error" };

/**
 * Resolve a media URL to a displayable `src`. For plain URLs this is the URL
 * itself; for client-encrypted Blossom attachments (Vector/0xChat `imeta`
 * with `decryption-key`/`decryption-nonce`) it fetches and AES-GCM-decrypts
 * the blob into an object URL.
 *
 * Returns `status: "loading"` while decrypting, `"ready" with the `src`, or
 * `"error"` on failure (so callers can fall back to a plain link).
 *
 * (Armada's original also resolved Buzz-hosted blobs with a signed GET; the
 * Buzz plane is not part of the ₿AO build, so that branch is dropped.)
 */
export function useResolvedMediaSrc(ref: EncryptedRef | string): State {
  const url = typeof ref === "string" ? ref : ref.url;
  const encryption = typeof ref === "string" ? undefined : ref.encryption;
  const mime = typeof ref === "string" ? undefined : ref.mime;

  // Key the effect on primitive identity only. Callers commonly pass a fresh
  // `EncryptedRef`/`encryption` object every render (tokens are rebuilt on each
  // ChatContent render), so depending on the object identity would re-run the
  // effect — and thus setState — on every render, causing a render loop.
  const encKey = encryption?.key;
  const encNonce = encryption?.nonce;
  const encAlgo = encryption?.algorithm;

  const encrypted = Boolean(encKey && encNonce && encAlgo);

  const [state, setState] = useState<State>(
    encrypted ? { status: "loading" } : { status: "ready", src: url },
  );

  useEffect(() => {
    if (!encKey || !encNonce || !encAlgo) {
      setState({ status: "ready", src: url });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading" });
    decryptAttachmentToObjectURL(url, { algorithm: encAlgo, key: encKey, nonce: encNonce }, mime, controller.signal)
      .then((src) => {
        if (!cancelled) setState({ status: "ready", src });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Re-resolve only when the blob URL or its crypto params actually change.
  }, [url, encKey, encNonce, encAlgo, mime]);

  return state;
}
