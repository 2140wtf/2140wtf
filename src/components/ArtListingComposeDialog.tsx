import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { cn } from '@/lib/utils';

const ART_KIND = 30402;

interface UploadedImage {
  url: string;
  alt?: string;
}

interface ArtListingComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Compose dialog for NIP-99 classified art listings (kind 30402).
 *
 * Builds an event with title/summary/image/price/location/status tags and
 * publishes it to the user's write relays. The listing is automatically
 * tagged `t: art` so it appears in the /art feed.
 */
export function ArtListingComposeDialog({ open, onOpenChange, onSuccess }: ArtListingComposeDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('BTC');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('active');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [tagInput, setTagInput] = useState('');

  const resetForm = useCallback(() => {
    setTitle('');
    setSummary('');
    setContent('');
    setPrice('');
    setCurrency('BTC');
    setLocation('');
    setStatus('active');
    setImages([]);
    setTagInput('');
  }, []);

  const canPublish =
    !!user &&
    title.trim().length > 0 &&
    images.length > 0 &&
    !isUploading &&
    !isPublishing;

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Invalid file', description: `${file.name} is not an image.`, variant: 'destructive' });
        continue;
      }
      try {
        const tags = await uploadFile(file);
        const url = tags.find(([k]) => k === 'url')?.[1];
        if (!url) throw new Error('Upload returned no URL');
        setImages((prev) => [...prev, { url, alt: file.name }]);
      } catch {
        toast({ title: 'Upload failed', description: `Could not upload ${file.name}.`, variant: 'destructive' });
      }
    }
  }, [uploadFile, toast]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const parseTags = useCallback((input: string): string[] => {
    return input
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').trim().toLowerCase())
      .filter(Boolean);
  }, []);

  const handleSubmit = async () => {
    if (!canPublish || !user) return;
    if (!isEnabled('marketplace')) {
      toast({
        title: 'Marketplace publishing disabled',
        description: 'Turn on “Marketplace listings” in Settings → Privacy & Publishing to publish art listings.',
      });
      return;
    }

    const priceValue = price.trim();
    if (priceValue && isNaN(Number(priceValue))) {
      toast({ title: 'Invalid price', description: 'Price must be a number.', variant: 'destructive' });
      return;
    }

    const tags: string[][] = [];
    const now = Math.floor(Date.now() / 1000);

    tags.push(['d', `${user.pubkey}:${now}`]);
    tags.push(['title', title.trim()]);
    if (summary.trim()) tags.push(['summary', summary.trim()]);
    if (location.trim()) tags.push(['location', location.trim()]);
    tags.push(['status', status]);
    if (priceValue) tags.push(['price', priceValue, currency.trim().toUpperCase()]);

    for (const img of images) {
      tags.push(['image', img.url]);
    }

    const hashtags = parseTags(tagInput);
    for (const t of new Set(['art', ...hashtags])) {
      tags.push(['t', t]);
    }

    tags.push(['published_at', String(now)]);
    tags.push(['alt', `Art listing: ${title.trim()}`]);

    try {
      await createEvent({
        kind: ART_KIND,
        content: content.trim(),
        tags,
      });

      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['event'] });

      toast({ title: 'Art listing published!', description: 'Your listing is now on Nostr.' });
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to publish art listing.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-0 gap-0 border-border [&>button]:hidden">
        <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-border/50">
          <DialogTitle className="text-base font-semibold">List art</DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="art-title">Title</Label>
            <Input
              id="art-title"
              placeholder="e.g. Final Halving — 1/21 screen print"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="art-summary">Summary</Label>
            <Textarea
              id="art-summary"
              placeholder="Short description that appears in the feed card"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="art-content">Description (markdown)</Label>
            <Textarea
              id="art-content"
              placeholder="Full description, edition details, shipping, etc."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="art-price">Price</Label>
              <Input
                id="art-price"
                type="number"
                min="0"
                step="any"
                placeholder="0.021"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="art-currency">Currency</Label>
              <Input
                id="art-currency"
                placeholder="BTC"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="art-location">Location (optional)</Label>
              <Input
                id="art-location"
                placeholder="London"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="art-status">Status</Label>
              <select
                id="art-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
              >
                <option value="active">Active</option>
                <option value="sold">Sold</option>
                <option value="reserved">Reserved</option>
                <option value="out-of-stock">Out of stock</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="art-tags">Tags (comma or space separated)</Label>
            <Input
              id="art-tags"
              placeholder="bitcoin, print, limited"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">#art is added automatically.</p>
          </div>

          <div className="space-y-2">
            <Label>Images</Label>
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-lg border border-border overflow-hidden group">
                    <img src={img.url} alt={img.alt ?? ''} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 transition-colors',
                isUploading
                  ? 'border-primary/30 bg-primary/5 cursor-wait'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer',
              )}
            >
              {isUploading ? (
                <Loader2 className="size-5 animate-spin text-primary" />
              ) : (
                <ImagePlus className="size-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">{isUploading ? 'Uploading...' : 'Add images'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/50">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPublishing || isUploading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canPublish || isPublishing || isUploading}>
            {isPublishing && <Loader2 className="mr-2 size-4 animate-spin" />}
            Publish listing
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
