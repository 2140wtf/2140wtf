// src/pets/three-d/hooks/useUploadSVGAsset.ts

import { useMutation } from '@tanstack/react-query';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { useUploadFile } from '@/hooks/useUploadFile';
import { toast } from '@/hooks/useToast';
import { sanitizeSvg } from '@/lib/sanitizeSvg';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

export interface UploadSVGAssetMetadata {
  title?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
}

/** Maximum SVG file size (1 MB). */
const MAX_SVG_SIZE = 1 * 1024 * 1024;

function assertSVGFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.svg')) {
    throw new Error('Only .svg files are supported');
  }
  if (file.size === 0) {
    throw new Error('File is empty');
  }
  if (file.size > MAX_SVG_SIZE) {
    throw new Error('SVG files must be 1 MB or smaller');
  }
}

function getUrlTag(tags: string[][]): string | undefined {
  return tags.find(([name]) => name === 'url')?.[1];
}

function getHashTag(tags: string[][]): string | undefined {
  return tags.find(([name]) => name === 'x')?.[1];
}

/**
 * Upload an SVG file to Blossom and return a validated `Asset3DEntry`.
 *
 * The SVG is sanitized before upload to strip scripts, event handlers, and
 * unsupported elements. The sha256 is computed from the sanitized bytes so it
 * matches the Blossom blob.
 */
export function useUploadSVGAsset() {
  const { mutateAsync: uploadFile, isPending } = useUploadFile();

  const mutation = useMutation({
    mutationFn: async ({
      file,
      metadata,
    }: {
      file: File;
      metadata?: UploadSVGAssetMetadata;
    }): Promise<Asset3DEntry> => {
      assertSVGFile(file);

      const rawText = await file.text();
      const sanitized = sanitizeSvg(rawText);
      if (!sanitized || sanitized.trim().length === 0) {
        throw new Error('SVG was rejected by the sanitizer');
      }

      const sanitizedFile = new File([sanitized], file.name, {
        type: 'image/svg+xml',
      });
      const hash = bytesToHex(sha256(new Uint8Array(await sanitizedFile.arrayBuffer())));

      const tags = await uploadFile(sanitizedFile);
      const url = getUrlTag(tags);
      const serverHash = getHashTag(tags);

      if (!url) {
        throw new Error('Upload did not return a Blossom URL');
      }

      return {
        url,
        sha256: serverHash && /^[0-9a-fA-F]{64}$/.test(serverHash)
          ? serverHash.toLowerCase()
          : hash,
        mime: 'image/svg+xml',
        ...(metadata?.title ? { title: metadata.title } : undefined),
        ...(metadata?.author ? { author: metadata.author } : undefined),
        ...(metadata?.license ? { license: metadata.license } : undefined),
        ...(metadata?.sourceUrl ? { sourceUrl: metadata.sourceUrl } : undefined),
      };
    },
    onError: (error: Error) => {
      toast({
        title: 'SVG upload failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    upload: mutation.mutateAsync,
    isPending: isPending || mutation.isPending,
    error: mutation.error,
  };
}
