// src/pets/three-d/hooks/useUploadGLBAsset.ts

import { useMutation } from '@tanstack/react-query';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { useUploadFile } from '@/hooks/useUploadFile';
import { toast } from '@/hooks/useToast';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

export interface UploadGLBAssetMetadata {
  title?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
}

/** Maximum GLB file size (25 MB). */
const MAX_GLB_SIZE = 25 * 1024 * 1024;

function assertGLBFile(file: File): void {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    throw new Error('Only .glb files are supported');
  }
  if (file.size === 0) {
    throw new Error('File is empty');
  }
  if (file.size > MAX_GLB_SIZE) {
    throw new Error('GLB files must be 25 MB or smaller');
  }
}

function inferGLBMime(file: File): string {
  // Browsers often report application/octet-stream for GLB; normalize to the
  // registered glTF-binary MIME type so the asset tag is self-describing.
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type;
  }
  return 'model/gltf-binary';
}

/**
 * Upload a GLB file to Blossom and return a validated `Asset3DEntry`.
 *
 * The sha256 is computed locally from the file bytes so it matches the blob
 * that Blossom content-addresses, even if the server returns no `x` tag.
 */
export function useUploadGLBAsset() {
  const { mutateAsync: uploadFile, isPending } = useUploadFile();

  const mutation = useMutation({
    mutationFn: async ({
      file,
      metadata,
    }: {
      file: File;
      metadata?: UploadGLBAssetMetadata;
    }): Promise<Asset3DEntry> => {
      assertGLBFile(file);

      const buffer = await file.arrayBuffer();
      const hash = bytesToHex(sha256(new Uint8Array(buffer)));

      const tags = await uploadFile(file);
      const urlTag = tags.find(([name]) => name === 'url');
      const url = urlTag?.[1];

      if (!url) {
        throw new Error('Upload did not return a Blossom URL');
      }

      return {
        url,
        sha256: hash,
        mime: inferGLBMime(file),
        size: file.size,
        ...(metadata?.title ? { title: metadata.title } : undefined),
        ...(metadata?.author ? { author: metadata.author } : undefined),
        ...(metadata?.license ? { license: metadata.license } : undefined),
        ...(metadata?.sourceUrl ? { sourceUrl: metadata.sourceUrl } : undefined),
      };
    },
    onError: (error: Error) => {
      toast({
        title: 'GLB upload failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    /** Upload a GLB file. Returns the Asset3DEntry on success. */
    upload: mutation.mutateAsync,
    /** True while the file is being hashed and uploaded. */
    isPending: isPending || mutation.isPending,
    /** Last error, if any. */
    error: mutation.error,
  };
}
