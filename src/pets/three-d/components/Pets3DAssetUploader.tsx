/**
 * Pets3DAssetUploader — Let the user upload custom GLB pet/room assets.
 *
 * Assets are hosted on Blossom and persisted in the owner's kind 11125
 * Blobbonaut profile under `assets_3d`. When no custom asset is configured,
 * the renderer falls back to the bundled default pet model and procedural room.
 */

import { useMemo, useRef } from 'react';
import { Loader2, Trash2, Upload, Box } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { usePersistAssets3D } from '@/pets/three-d/hooks/usePersistAssets3D';
import { useUploadGLBAsset } from '@/pets/three-d/hooks/useUploadGLBAsset';
import { parseAssets3DContent } from '@/pets/three-d/lib/three-d-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

interface AssetSlotProps {
  label: string;
  asset: Asset3DEntry | undefined;
  isBusy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelected: (file: File) => void;
  onClear: () => void;
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.length <= 32) return url;
    return `${u.origin}${path.slice(0, 12)}…${path.slice(-16)}`;
  } catch {
    return url.length > 48 ? `${url.slice(0, 24)}…${url.slice(-20)}` : url;
  }
}

function AssetSlot({
  label,
  asset,
  isBusy,
  inputRef,
  onFileSelected,
  onClear,
}: AssetSlotProps) {
  const hasAsset = asset !== undefined;

  return (
    <div className="space-y-2 rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </Label>
          <p className="text-[10px] text-muted-foreground truncate">
            {hasAsset ? truncateUrl(asset.url) : 'Using default'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasAsset && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={isBusy}
              onClick={onClear}
              title="Clear custom asset and use default"
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4 mr-1.5" />
            )}
            {isBusy ? 'Uploading…' : 'Upload GLB'}
          </Button>
        </div>
      </div>

      {hasAsset && (
        <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
          <Box className="size-3.5 mt-0.5 shrink-0" />
          <span className="break-all">
            {asset.sha256.slice(0, 12)}…{asset.sha256.slice(-12)}
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".glb"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}

export function Pets3DAssetUploader() {
  const { profile } = useBlobbonautProfile();
  const { upload, isPending: isUploading } = useUploadGLBAsset();
  const { mutate: persist, isPending: isSaving } = usePersistAssets3D();

  const assets = useMemo(() => parseAssets3DContent(profile?.content), [profile?.content]);

  const petInputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (file: File, slot: 'pet' | 'room') => {
    const entry = await upload(file);
    persist({ [slot]: entry });
  };

  const handleClear = (slot: 'pet' | 'room') => {
    persist({ [slot]: null });
  };

  const isBusy = isUploading || isSaving;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">3D assets</h3>
        <p className="text-xs text-muted-foreground">
          Upload custom GLB models for your adult pet and its room. Leave empty
          to use the bundled default pet model and procedural room.
        </p>
      </div>

      <AssetSlot
        label="Pet model"
        asset={assets?.pet}
        isBusy={isBusy}
        inputRef={petInputRef}
        onFileSelected={(file) => handleFileSelected(file, 'pet')}
        onClear={() => handleClear('pet')}
      />

      <AssetSlot
        label="Room model"
        asset={assets?.room}
        isBusy={isBusy}
        inputRef={roomInputRef}
        onFileSelected={(file) => handleFileSelected(file, 'room')}
        onClear={() => handleClear('room')}
      />
    </div>
  );
}
