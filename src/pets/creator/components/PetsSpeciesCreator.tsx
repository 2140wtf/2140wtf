/**
 * PetsSpeciesCreator — Settings UI for creating a reusable custom species.
 *
 * Flow:
 *   1. Name the species (auto-slug id).
 *   2. Upload a base SVG (required) and optional sleeping SVG.
 *   3. Optionally upload a GLB model + scale override and credit metadata.
 *   4. Preview the species as an adult (SVG) and optionally as a 3D model.
 *   5. Save: merges the form into the owner's kind 11125 `custom_forms`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  Save,
  Upload,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { Pets3DVisual } from '@/pets/three-d/components/Pets3DVisual';
import { useUploadSVGAsset } from '@/pets/three-d/hooks/useUploadSVGAsset';
import { useUploadGLBAsset } from '@/pets/three-d/hooks/useUploadGLBAsset';
import { usePersistCustomForms } from '@/pets/three-d/hooks/usePersistCustomForms';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

const MIN_SCALE = 0.001;
const MAX_SCALE = 2;
const DEFAULT_SCALE = 0.011;
const DEFAULT_ROOM_SCALE = 1;
const SCALE_STEP = 0.001;
const ROOM_SCALE_STEP = 0.05;

function slugifyId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'custom-species';
}

function isValidId(id: string): boolean {
  return /^[a-z0-9_-]{1,64}$/.test(id);
}

interface PendingFile {
  file: File;
  slot: 'baseSvg' | 'sleepingSvg' | 'glb' | 'roomGlb';
}

interface PetsSpeciesCreatorProps {
  /** A companion to use as the preview host. Must be adult for 3D preview. */
  baseCompanion: PetsCompanion;
}

export function PetsSpeciesCreator({ baseCompanion }: PetsSpeciesCreatorProps) {
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  const [baseSvgEntry, setBaseSvgEntry] = useState<Asset3DEntry | undefined>();
  const [sleepingSvgEntry, setSleepingSvgEntry] = useState<Asset3DEntry | undefined>();
  const [glbEntry, setGlbEntry] = useState<Asset3DEntry | undefined>();
  const [roomGlbEntry, setRoomGlbEntry] = useState<Asset3DEntry | undefined>();
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [roomScale, setRoomScale] = useState(DEFAULT_ROOM_SCALE);

  const [show3D, setShow3D] = useState(false);
  const [isUploadingSlot, setIsUploadingSlot] = useState<PendingFile['slot'] | null>(null);

  const { upload: uploadSvg, isPending: isSvgUploading } = useUploadSVGAsset();
  const { upload: uploadGlb, isPending: isGlbUploading } = useUploadGLBAsset();
  const { mutate: persist, isPending: isSaving } = usePersistCustomForms();

  const baseSvgInputRef = useRef<HTMLInputElement>(null);
  const sleepingSvgInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const roomGlbInputRef = useRef<HTMLInputElement>(null);

  const isBusy = isSvgUploading || isGlbUploading || isSaving || isUploadingSlot !== null;

  // Default the preview to 3D as soon as the user uploads a pet GLB.
  useEffect(() => {
    if (glbEntry) {
      setShow3D(true);
    }
  }, [glbEntry]);

  const handleLabelChange = (value: string) => {
    setLabel(value);
    if (!id || id === slugifyId(label)) {
      setId(slugifyId(value));
    }
  };

  const handleIdChange = (value: string) => {
    setId(slugifyId(value));
  };

  const handleFileSelected = async (file: File, slot: PendingFile['slot']) => {
    setIsUploadingSlot(slot);
    try {
      if (slot === 'baseSvg' || slot === 'sleepingSvg') {
        const entry = await uploadSvg({
          file,
          metadata: {
            title: file.name,
            author: author.trim() || undefined,
            license: license.trim() || undefined,
            sourceUrl: sourceUrl.trim() || undefined,
          },
        });
        if (slot === 'baseSvg') setBaseSvgEntry(entry);
        else setSleepingSvgEntry(entry);
      } else {
        const entry = await uploadGlb({
          file,
          metadata: {
            title: file.name,
            author: author.trim() || undefined,
            license: license.trim() || undefined,
            sourceUrl: sourceUrl.trim() || undefined,
          },
        });
        if (slot === 'glb') setGlbEntry(entry);
        else setRoomGlbEntry(entry);
      }
    } finally {
      setIsUploadingSlot(null);
    }
  };

  const handleClear = (slot: PendingFile['slot']) => {
    if (slot === 'baseSvg') setBaseSvgEntry(undefined);
    else if (slot === 'sleepingSvg') setSleepingSvgEntry(undefined);
    else if (slot === 'glb') setGlbEntry(undefined);
    else setRoomGlbEntry(undefined);
  };

  const draftForm: CustomPetForm | undefined = useMemo(() => {
    if (!isValidId(id) || !label.trim() || !baseSvgEntry) return undefined;
    const form: CustomPetForm = {
      id,
      label: label.trim(),
      category: 'custom',
      svgBase: baseSvgEntry,
      ...(sleepingSvgEntry ? { svgSleeping: sleepingSvgEntry } : undefined),
      ...(glbEntry ? { asset3d: { ...glbEntry, scale } } : undefined),
      ...(roomGlbEntry ? { roomAsset3d: { ...roomGlbEntry, scale: roomScale } } : undefined),
      ...(author.trim() ? { author: author.trim() } : undefined),
      ...(license.trim() ? { license: license.trim() } : undefined),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : undefined),
    };
    return form;
  }, [id, label, baseSvgEntry, sleepingSvgEntry, glbEntry, roomGlbEntry, scale, roomScale, author, license, sourceUrl]);

  // Preview can be shown as soon as we have enough to render something:
  // a name/id plus at least one uploaded asset (SVG or GLB).
  const previewId = useMemo(() => {
    if (isValidId(id)) return id;
    const fromLabel = slugifyId(label);
    if (isValidId(fromLabel)) return fromLabel;
    return 'custom-preview';
  }, [id, label]);

  const svgPreviewForm: CustomPetForm | undefined = useMemo(() => {
    if (!isValidId(previewId) || !baseSvgEntry) return undefined;
    const form: CustomPetForm = {
      id: previewId,
      label: label.trim() || previewId,
      category: 'custom',
      svgBase: baseSvgEntry,
      ...(sleepingSvgEntry ? { svgSleeping: sleepingSvgEntry } : undefined),
      ...(glbEntry ? { asset3d: { ...glbEntry, scale } } : undefined),
      ...(roomGlbEntry ? { roomAsset3d: { ...roomGlbEntry, scale: roomScale } } : undefined),
      ...(author.trim() ? { author: author.trim() } : undefined),
      ...(license.trim() ? { license: license.trim() } : undefined),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : undefined),
    };
    return form;
  }, [previewId, label, baseSvgEntry, sleepingSvgEntry, glbEntry, roomGlbEntry, scale, roomScale, author, license, sourceUrl]);

  const previewCustomForms = useMemo(() => {
    if (!svgPreviewForm) return {};
    return { [svgPreviewForm.id]: svgPreviewForm };
  }, [svgPreviewForm]);

  const previewCompanion: PetsCompanion = useMemo(
    () => ({
      ...baseCompanion,
      stage: 'adult',
      state: 'active',
      progressionState: 'none',
      breedCategory: 'custom',
      breedAsset: previewId,
      adultType: undefined,
      name: label.trim() || baseCompanion.name,
    }),
    [baseCompanion, previewId, label],
  );

  const glbPreviewAsset: Asset3DEntry | undefined = useMemo(() => {
    if (!glbEntry) return undefined;
    return { ...glbEntry, scale };
  }, [glbEntry, scale]);

  const roomPreviewAsset: Asset3DEntry | undefined = useMemo(() => {
    if (!roomGlbEntry) return undefined;
    return { ...roomGlbEntry, scale: roomScale };
  }, [roomGlbEntry, roomScale]);

  const canPreview = Boolean(baseSvgEntry || glbEntry || roomGlbEntry);

  const canSave = Boolean(draftForm) && !isBusy;

  const handleSave = () => {
    if (!draftForm) {
      toast({
        title: 'Cannot save species',
        description: 'Add a name and a base SVG before saving.',
        variant: 'destructive',
      });
      return;
    }
    persist(
      { id: draftForm.id, form: draftForm },
      {
        onSuccess: () => {
          setLabel('');
          setId('');
          setAuthor('');
          setLicense('');
          setSourceUrl('');
          setBaseSvgEntry(undefined);
          setSleepingSvgEntry(undefined);
          setGlbEntry(undefined);
          setRoomGlbEntry(undefined);
          setScale(DEFAULT_SCALE);
          setRoomScale(DEFAULT_ROOM_SCALE);
          setShow3D(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6 rounded-xl border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Create a species</h3>
        <p className="text-xs text-muted-foreground">
          Upload your own SVG and optional GLB to create a reusable custom species.
          Every new egg can then adopt this species under the Custom category.
        </p>
      </div>

      {/* Name / id */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="species-label" className="text-xs">
            Species name
          </Label>
          <Input
            id="species-label"
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="e.g. Honey Badger"
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="species-id" className="text-xs">
            Species id
          </Label>
          <Input
            id="species-id"
            value={id}
            onChange={(e) => handleIdChange(e.target.value)}
            placeholder="honey-badger"
            maxLength={64}
          />
          <p className="text-[10px] text-muted-foreground">
            URL-safe id used in pet events. Auto-generated from the name.
          </p>
        </div>
      </div>

      {/* SVG uploads */}
      <div className="space-y-3">
        <FileSlot
          label="Base SVG"
          accept=".svg"
          asset={baseSvgEntry}
          isBusy={isBusy}
          isUploading={isUploadingSlot === 'baseSvg'}
          inputRef={baseSvgInputRef}
          onFileSelected={(file) => handleFileSelected(file, 'baseSvg')}
          onClear={() => handleClear('baseSvg')}
          required
        />
        <FileSlot
          label="Sleeping SVG"
          accept=".svg"
          asset={sleepingSvgEntry}
          isBusy={isBusy}
          isUploading={isUploadingSlot === 'sleepingSvg'}
          inputRef={sleepingSvgInputRef}
          onFileSelected={(file) => handleFileSelected(file, 'sleepingSvg')}
          onClear={() => handleClear('sleepingSvg')}
        />
      </div>

      {/* GLB uploads */}
      <div className="space-y-3 rounded-lg border bg-card/40 p-3">
        <p className="text-xs text-muted-foreground">
          Optional 3D assets for this species. Leave empty to use the bundled
          default pet model and procedural room.
        </p>

        <FileSlot
          label="Pet GLB model"
          accept=".glb"
          asset={glbEntry}
          isBusy={isBusy}
          isUploading={isUploadingSlot === 'glb'}
          inputRef={glbInputRef}
          onFileSelected={(file) => handleFileSelected(file, 'glb')}
          onClear={() => handleClear('glb')}
        />

        {glbEntry && (
          <ScaleEditor
            label="Pet GLB scale"
            value={scale}
            step={SCALE_STEP}
            min={MIN_SCALE}
            max={MAX_SCALE}
            defaultValue={DEFAULT_SCALE}
            isBusy={isBusy}
            onChange={setScale}
          />
        )}

        <FileSlot
          label="Room GLB model"
          accept=".glb"
          asset={roomGlbEntry}
          isBusy={isBusy}
          isUploading={isUploadingSlot === 'roomGlb'}
          inputRef={roomGlbInputRef}
          onFileSelected={(file) => handleFileSelected(file, 'roomGlb')}
          onClear={() => handleClear('roomGlb')}
        />

        {roomGlbEntry && (
          <ScaleEditor
            label="Room GLB scale"
            value={roomScale}
            step={ROOM_SCALE_STEP}
            min={MIN_SCALE}
            max={MAX_SCALE}
            defaultValue={DEFAULT_ROOM_SCALE}
            isBusy={isBusy}
            onChange={setRoomScale}
          />
        )}
      </div>

      {/* Credits */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="species-author" className="text-xs">Author / creator</Label>
          <Input
            id="species-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="e.g. Model by PixelPup"
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="species-license" className="text-xs">License</Label>
          <Input
            id="species-license"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            placeholder="e.g. CC-BY-4.0"
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="species-source" className="text-xs">Source URL</Label>
          <Input
            id="species-source"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
            maxLength={2000}
          />
        </div>
      </div>

      {/* Preview */}
      {canPreview && (
        <div className="space-y-3 rounded-xl border bg-card/30 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Preview: {svgPreviewForm?.label || 'New species'}</p>
              <p className="text-xs text-muted-foreground">ID: {svgPreviewForm?.id || previewId}</p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="preview-3d" className="text-xs">3D preview</Label>
              <Switch
                id="preview-3d"
                checked={show3D}
                disabled={!glbPreviewAsset}
                onCheckedChange={setShow3D}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/40 p-6">
            {show3D && glbPreviewAsset ? (
              <div className="w-full h-64 rounded-xl overflow-hidden">
                <Pets3DVisual
                  asset={glbPreviewAsset}
                  roomAsset={roomPreviewAsset}
                  className="w-full h-full"
                />
              </div>
            ) : svgPreviewForm ? (
              <div className="size-48">
                <PetsStageVisual
                  companion={previewCompanion}
                  customForms={previewCustomForms}
                  size="lg"
                  animated={false}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                Upload a base SVG or pet GLB to render a preview.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Save */}
      <Button
        type="button"
        className="w-full"
        disabled={!canSave}
        onClick={handleSave}
      >
        {isSaving ? (
          <Loader2 className="size-4 animate-spin mr-1.5" />
        ) : (
          <Save className="size-4 mr-1.5" />
        )}
        {isSaving ? 'Saving species…' : 'Save species'}
      </Button>
    </div>
  );
}

// ─── Scale Editor Component ──────────────────────────────────────────────────

interface ScaleEditorProps {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  defaultValue: number;
  isBusy: boolean;
  onChange: (value: number) => void;
}

function ScaleEditor({
  label,
  value,
  step,
  min,
  max,
  defaultValue,
  isBusy,
  onChange,
}: ScaleEditorProps) {
  const decimals = useMemo(() => {
    const stepStr = step.toString();
    const dotIndex = stepStr.indexOf('.');
    return dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1;
  }, [step]);

  const adjust = (delta: number) => {
    onChange(Math.min(max, Math.max(min, Math.round((value + delta) / step) * step)));
  };

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs tabular-nums">{value.toFixed(decimals)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => adjust(-step)}
          disabled={isBusy}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => adjust(step)}
          disabled={isBusy}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => onChange(defaultValue)}
          disabled={isBusy}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

// ─── File Slot Component ─────────────────────────────────────────────────────

interface FileSlotProps {
  label: string;
  accept: string;
  asset: Asset3DEntry | undefined;
  isBusy: boolean;
  isUploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  required?: boolean;
}

function FileSlot({
  label,
  accept,
  asset,
  isBusy,
  isUploading,
  inputRef,
  onFileSelected,
  onClear,
  required,
}: FileSlotProps) {
  const hasAsset = asset !== undefined;

  return (
    <div className="space-y-2 rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
          <p className="text-[10px] text-muted-foreground truncate">
            {hasAsset ? truncateUrl(asset.url) : `No ${label.toLowerCase()} uploaded`}
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
              title="Clear upload"
            >
              <X className="size-4 text-destructive" />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <Loader2 className="size-4 animate-spin mr-1.5" />
            ) : (
              <Upload className="size-4 mr-1.5" />
            )}
            {isUploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </div>

      {hasAsset && (
        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span className="break-all">
            {asset.sha256.slice(0, 12)}…{asset.sha256.slice(-12)}
          </span>
          <AssetCredits asset={asset} />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
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

function AssetCredits({ asset }: { asset: Asset3DEntry }) {
  const lines: string[] = [];
  if (asset.title) lines.push(asset.title);
  if (asset.author) lines.push(`by ${asset.author}`);
  if (asset.license) lines.push(asset.license);
  if (lines.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-0.5')}>
      {lines.map((line, i) => (
        <span key={i} className="truncate">
          {line}
        </span>
      ))}
      {asset.sourceUrl && (
        <a
          href={asset.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline truncate"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3 shrink-0" />
          Source
        </a>
      )}
    </div>
  );
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
