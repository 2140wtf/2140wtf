import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useResolvedMediaSrc } from "@/hooks/useResolvedMediaSrc";
import { cn } from "@/lib/utils";

import type { ImetaEncryption } from "@/lib/imeta";

interface VideoPlayerProps {
  src: string;
  /** Poster image URL (from the imeta `image` field). */
  poster?: string;
  /** Pixel dimensions from the imeta `dim` field, e.g. "1280x720". */
  dim?: string;
  /** MIME type of the video (used as the decrypted Blob's type). */
  mime?: string;
  /** AES-GCM decryption params for client-encrypted (Concord/Vector) blobs. */
  encryption?: ImetaEncryption;
  className?: string;
}

/**
 * Inline chat video player. Uses native controls but reserves the correct
 * aspect ratio from imeta `dim` to prevent layout shifts. Encrypted
 * (Concord/Vector) attachments are AES-GCM ciphertext on Blossom, so the src
 * is fetched + decrypted to an object URL before it reaches the <video>.
 */
export function VideoPlayer({ src, poster, dim, mime, encryption, className }: VideoPlayerProps) {
  const [failed, setFailed] = useState(false);
  const resolved = useResolvedMediaSrc({ url: src, encryption, mime });

  const aspectRatio = useMemo(() => {
    const match = dim?.match(/^(\d+)x(\d+)$/);
    if (match) {
      const w = Number.parseInt(match[1], 10);
      const h = Number.parseInt(match[2], 10);
      if (w > 0 && h > 0) return `${w} / ${h}`;
    }
    return "16 / 9";
  }, [dim]);

  if (failed || resolved.status === "error") {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {src}
      </a>
    );
  }

  return (
    <div
      className={cn("my-1.5 max-w-md rounded-xl overflow-hidden border border-border bg-black", className)}
      style={{ aspectRatio }}
      onClick={(e) => e.stopPropagation()}
    >
      {resolved.status === "ready" ? (
        <video
          src={resolved.src}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
