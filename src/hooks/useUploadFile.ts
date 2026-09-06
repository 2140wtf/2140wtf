import { useMutation } from "@tanstack/react-query";
import { BlossomUploader } from '@nostrify/nostrify/uploaders';
import { N64 } from '@nostrify/nostrify/utils';

import type { NostrSigner } from '@nostrify/nostrify';

import { useCurrentUser } from "./useCurrentUser";
import { useAppContext } from "./useAppContext";
import { getEffectiveBlossomServers } from "@/lib/appBlossom";
import { stripFileMetadata } from "@/lib/stripMetadata";
import { baoError, ErrorCodes } from "@/lib/errorCodes";
import { describeUploadRejection, validateUploadFile } from "@/lib/fileValidation";

export function useUploadFile() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();

  return useMutation({
    mutationFn: async (file: File) => {
      // Fail fast on empty/oversized selections before any file read or
      // network I/O — see lib/fileValidation for why the client bounds these.
      const rejection = validateUploadFile(file);
      if (rejection) {
        throw baoError(
          rejection.reason === 'too-large' ? ErrorCodes.UPLOAD_TOO_LARGE : ErrorCodes.UPLOAD_EMPTY,
          describeUploadRejection(rejection),
        );
      }

      if (!user) {
        throw baoError(ErrorCodes.UPLOAD_NOT_LOGGED_IN);
      }

      const servers = getEffectiveBlossomServers(
        config.blossomServerMetadata,
        config.useAppBlossomServers,
      );
      if (servers.length === 0) {
        throw baoError(ErrorCodes.UPLOAD_NO_SERVERS);
      }

      // Strip EXIF/GPS/device metadata from images and videos before upload.
      // Unsupported formats or browsers fall back to the original file.
      const sanitized = await stripFileMetadata(file);

      const uploader = new BlossomUploader({
        servers,
        signer: user.signer,
        // Custom fetch with a 30-second per-server timeout.  Without this,
        // a hanging server blocks that promise indefinitely.  Promise.any()
        // still resolves as soon as any server succeeds, but the timeout
        // ensures all promises eventually settle so the AggregateError path
        // fires promptly when every server is slow or down.
        fetch: (input, init) => globalThis.fetch(input, {
          ...init,
          signal: AbortSignal.any([
            init?.signal ?? AbortSignal.timeout(30_000),
            AbortSignal.timeout(30_000),
          ]),
        }),
      });

      let tags: string[][];
      try {
        tags = await uploader.upload(sanitized);
      } catch (e) {
        // Map raw Blossom/fetch failures to a stable, documented code.
        const timedOut = e instanceof Error && /abort|timeout/i.test(e.message);
        throw baoError(timedOut ? ErrorCodes.UPLOAD_TIMEOUT : ErrorCodes.UPLOAD_FAILED);
      }

      // If the returned URL is missing a file extension, append one from the
      // sanitized file name. Blossom URLs are content-addressed (`/<sha256>`)
      // and may omit the extension. Adding it helps clients infer the media type.
      const ext = getFileExtension(sanitized.name);
      if (ext) {
        tags[0][1] = appendExtensionIfMissing(tags[0][1], ext);
      }

      const url = tags[0][1];

      // Mirror to all other servers in the background (fire-and-forget).
      // BlossomUploader uses Promise.any(), so only one server has the blob.
      // We mirror to the rest for redundancy (BUD-04).
      const uploadedServer = servers.find((s) => url.startsWith(s));
      const mirrorServers = servers.filter((s) => s !== uploadedServer);

      if (mirrorServers.length > 0) {
        mirrorToServers(url, mirrorServers, user.signer).catch(() => {
          // Mirroring is best-effort — don't fail the upload if it fails.
        });
      }

      return tags;
    },
  });
}

/** Extract the file extension (with leading dot) from a filename, or empty string if none. */
function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return filename.slice(dotIndex).toLowerCase();
}

/** Append a file extension to a URL if its path doesn't already have one. */
function appendExtensionIfMissing(urlString: string, ext: string): string {
  const url = new URL(urlString);
  const lastSegment = url.pathname.split('/').pop() ?? '';
  // Check if the last path segment already contains a dot (has an extension)
  if (lastSegment.includes('.')) return urlString;
  url.pathname = url.pathname + ext;
  return url.toString();
}

/** Mirror a blob to additional Blossom servers (BUD-04). */
async function mirrorToServers(
  sourceUrl: string,
  servers: string[],
  signer: NostrSigner,
): Promise<void> {
  const now = Date.now();

  const event = await signer.signEvent({
    kind: 24242,
    content: 'Mirror blob',
    created_at: Math.floor(now / 1000),
    tags: [
      ['t', 'mirror'],
      ['expiration', Math.floor((now + 60_000) / 1000).toString()],
    ],
  });

  const authorization = `Nostr ${N64.encodeEvent(event)}`;

  await Promise.allSettled(
    servers.map((server) =>
      fetch(new URL('/mirror', server), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
        },
        body: JSON.stringify({ url: sourceUrl }),
      }),
    ),
  );
}
