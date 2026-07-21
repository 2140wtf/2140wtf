/**
 * Pets3DAssetUploader — Let the user upload custom GLB pet/room assets.
 *
 * Assets are hosted on Blossom and persisted in the owner's kind 11125
 * Nostr pet profile under `assets_3d`. When no custom asset is configured,
 * the renderer falls back to the bundled default pet model and procedural room.
 *
 * Credit metadata (title, author, license, source URL) is stored next to the
 * asset reference in the profile content so authors can be attributed even
 * though the Blossom blob itself is just the raw GLB bytes.
 */

import { useMemo, useRef, useState } from 'react';
import { Loader2, Trash2, Upload, Box, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
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

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.glb$/i, '');
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

function AssetCredits({ asset }: { asset: Asset3DEntry }) {
  const lines: string[] = [];
  if (asset.title) lines.push(asset.title);
  if (asset.author) lines.push(`by ${asset.author}`);
  if (asset.license) lines.push(asset.license);
  if (lines.length === 0) return null;

  return (
    <div className='flex flex-col gap-0.5 text-[10px] text-muted-foreground'>
      {lines.map((line, i) => (
        <span key={i} className='truncate'>
          {line}
        </span>
      ))}
      {asset.sourceUrl && (
        <a
          href={asset.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-0.5 text-primary hover:underline truncate'
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className='size-3 shrink-0' />
          Source
        </a>
      )}
    </div>
  );
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
    <div className='space-y-2 rounded-lg border bg-card/40 p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Label className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
            {label}
          </Label>
          <p className='text-[10px] text-muted-foreground truncate'>
            {hasAsset ? truncateUrl(asset.url) : 'Using default'}
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          {hasAsset && (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-8'
              disabled={isBusy}
              onClick={onClear}
              title='Clear custom asset and use default'
            >
              <Trash2 className='size-4 text-destructive' />
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {isBusy ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Upload className='size-4 mr-1.5' />
            )}
            {isBusy ? 'Uploading…' : 'Upload GLB'}
          </Button>
        </div>
      </div>

      {hasAsset && (
        <>
          <div className='flex items-start gap-2 text-[10px] text-muted-foreground'>
            <Box className='size-3.5 mt-0.5 shrink-0' />
            <span className='break-all'>
              {asset.sha256.slice(0, 12)}…{asset.sha256.slice(-12)}
            </span>
          </div>
          <AssetCredits asset={asset} />
        </>
      )}

      <input
        ref={inputRef}
        type='file'
        accept='.glb'
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) onFileSelected(file);
        }}
      />
    </div>
  );
}

interface PendingUpload {
  file: File;
  slot: 'pet' | 'room';
}

export function Pets3DAssetUploader() {
  const { profile } = useNostrPetProfile();
  const { upload, isPending: isUploading } = useUploadGLBAsset();
  const { mutate: persist, isPending: isSaving } = usePersistAssets3D();

  const assets = useMemo(() => parseAssets3DContent(profile?.content), [profile?.content]);

  const petInputRef = useRef<HTMLInputElement>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  const handleFileSelected = (file: File, slot: 'pet' | 'room') => {
    setPending({ file, slot });
    setTitle(fileNameWithoutExtension(file.name));
    setAuthor('');
    setLicense('');
    setSourceUrl('');
  };

  const handleClear = (slot: 'pet' | 'room') => {
    persist({ [slot]: null });
  };

  const handleCancel = () => {
    setPending(null);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    const entry = await upload({
      file: pending.file,
      metadata: {
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        license: license.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      },
    });
    persist({ [pending.slot]: entry });
    setPending(null);
  };

  const isBusy = isUploading || isSaving;
  const dialogOpen = pending !== null;

  return (
    <div className='space-y-4 rounded-xl border p-4'>
      <div className='space-y-1'>
        <h3 className='text-sm font-semibold'>3D assets</h3>
        <p className='text-xs text-muted-foreground'>
          Upload custom GLB models for your adult pet and its room. Leave empty
          to use the bundled default pet model and procedural room.
        </p>
      </div>

      <AssetSlot
        label='Pet model'
        asset={assets?.pet}
        isBusy={isBusy}
        inputRef={petInputRef}
        onFileSelected={(file) => handleFileSelected(file, 'pet')}
        onClear={() => handleClear('pet')}
      />

      <AssetSlot
        label='Room model'
        asset={assets?.room}
        isBusy={isBusy}
        inputRef={roomInputRef}
        onFileSelected={(file) => handleFileSelected(file, 'room')}
        onClear={() => handleClear('room')}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asset credits &amp; license</DialogTitle>
            <DialogDescription>
              Add attribution for the GLB model. This is stored in your
              Nostr pet profile next to the asset reference, not inside the
              GLB file itself.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='asset-title' className='text-xs'>
                Title
              </Label>
              <Input
                id='asset-title'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. Honey Badger'
                maxLength={120}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='asset-author' className='text-xs'>
                Author / creator
              </Label>
              <Input
                id='asset-author'
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder='e.g. Model by PixelPup on Sketchfab'
                maxLength={200}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='asset-license' className='text-xs'>
                License
              </Label>
              <Input
                id='asset-license'
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder='e.g. CC-BY-4.0'
                maxLength={120}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='asset-source' className='text-xs'>
                Source URL
              </Label>
              <Input
                id='asset-source'
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder='https://sketchfab.com/...'
                maxLength={2000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={handleCancel} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className='size-4 animate-spin mr-1.5' />
              ) : (
                <Upload className='size-4 mr-1.5' />
              )}
              {isBusy ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
