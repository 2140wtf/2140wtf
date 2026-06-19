import { useCallback, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, X, Package, Truck } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { NIP99_CLASSIFIED_KIND, type DeliveryMethod, type ListingFormat } from '@/lib/nip99';
import { RelayPicker } from '@/components/RelayPicker';
import { ShippingOptionForm } from '@/components/marketplace/ShippingOptionForm';
import { useSellerShippingOptions } from '@/hooks/useShippingOptions';
import { formatShippingOption, formatShippingService, shippingOptionAddress, type ShippingOption } from '@/lib/shippingOption';

const PRODUCT_KIND = NIP99_CLASSIFIED_KIND;
const BAO_RELAY = 'wss://relay.bao.network';

interface UploadedImage {
  url: string;
  alt?: string;
}

interface ProductListingComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * Compose dialog for general NIP-99 product listings (kind 30402).
 *
 * Supports Blossom image uploads, price in sats, stock, physical/digital format,
 * simple delivery tags, kind-30406 shipping-option references, and targeted
 * publishing to a selectable relay set.
 */
export function ProductListingComposeDialog({ open, onOpenChange, onSuccess }: ProductListingComposeDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [format, setFormat] = useState<ListingFormat>('physical');
  const [delivery, setDelivery] = useState<DeliveryMethod>('post');
  const [location, setLocation] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [relays, setRelays] = useState<string[]>([BAO_RELAY]);
  const [showAdvancedShipping, setShowAdvancedShipping] = useState(false);
  const [selectedShippingAddresses, setSelectedShippingAddresses] = useState<string[]>([]);
  const [localShippingOptions, setLocalShippingOptions] = useState<ShippingOption[]>([]);

  const { data: existingShippingOptions = [] } = useSellerShippingOptions(user?.pubkey);
  const allShippingOptions = useMemo(
    () => [...existingShippingOptions, ...localShippingOptions],
    [existingShippingOptions, localShippingOptions],
  );

  const resetForm = useCallback(() => {
    setTitle('');
    setSummary('');
    setContent('');
    setPrice('');
    setStock('');
    setFormat('physical');
    setDelivery('post');
    setLocation('');
    setImages([]);
    setTagInput('');
    setRelays([BAO_RELAY]);
    setShowAdvancedShipping(false);
    setSelectedShippingAddresses([]);
    setLocalShippingOptions([]);
  }, []);

  const canPublish =
    !!user &&
    title.trim().length > 0 &&
    images.length > 0 &&
    relays.length > 0 &&
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

  const toggleShippingOption = (address: string) => {
    setSelectedShippingAddresses((prev) =>
      prev.includes(address) ? prev.filter((a) => a !== address) : [...prev, address]
    );
  };

  const handleSubmit = async () => {
    if (!canPublish || !user) return;

    const priceValue = price.trim();
    if (!priceValue || isNaN(Number(priceValue)) || Number(priceValue) < 0) {
      toast({ title: 'Invalid price', description: 'Price must be a non-negative number in sats.', variant: 'destructive' });
      return;
    }

    const stockValue = stock.trim();
    if (stockValue && (isNaN(Number(stockValue)) || Number(stockValue) < 0 || !Number.isInteger(Number(stockValue)))) {
      toast({ title: 'Invalid stock', description: 'Stock must be a non-negative whole number.', variant: 'destructive' });
      return;
    }

    const tags: string[][] = [];
    const now = Math.floor(Date.now() / 1000);

    tags.push(['d', `${user.pubkey}:${now}`]);
    tags.push(['title', title.trim()]);
    if (summary.trim()) tags.push(['summary', summary.trim()]);
    if (location.trim()) tags.push(['location', location.trim()]);
    tags.push(['status', 'active']);
    tags.push(['price', priceValue, 'SATS']);
    if (stockValue) tags.push(['stock', String(Number(stockValue))]);

    tags.push(['type', 'simple']);
    tags.push(['format', format]);
    tags.push(['delivery', delivery]);

    for (const img of images) {
      tags.push(['image', img.url]);
    }

    const hashtags = parseTags(tagInput);
    for (const t of new Set(['product', ...hashtags])) {
      tags.push(['t', t]);
    }

    if (selectedShippingAddresses.length > 0) {
      for (const address of selectedShippingAddresses) {
        tags.push(['shipping_option', address]);
      }
    }

    tags.push(['published_at', String(now)]);
    tags.push(['alt', `Product listing: ${title.trim()}`]);

    try {
      await createEvent({
        kind: PRODUCT_KIND,
        content: content.trim(),
        tags,
        relays,
      });

      queryClient.invalidateQueries({ queryKey: ['nip99-listings'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['event'] });

      toast({ title: 'Product listed!', description: 'Your product is now live on the selected relays.' });
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to publish product listing.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-0 gap-0 border-border [&>button]:hidden">
        <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-border/50">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="size-4" />
            List a product
          </DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="product-title">Title</Label>
            <Input
              id="product-title"
              placeholder="e.g. Signed Bitcoin poster"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-summary">Summary</Label>
            <Textarea
              id="product-summary"
              placeholder="Short description for the card"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-content">Description (markdown)</Label>
            <Textarea
              id="product-content"
              placeholder="Full product description, specs, condition, etc."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="product-price">Price (SATS)</Label>
              <Input
                id="product-price"
                type="number"
                min="0"
                step="1"
                placeholder="21000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-stock">Stock</Label>
              <Input
                id="product-stock"
                type="number"
                min="0"
                step="1"
                placeholder="1"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="product-location">Location (optional)</Label>
              <Input
                id="product-location"
                placeholder="London"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Product type</Label>
              <RadioGroup
                value={format}
                onValueChange={(v) => setFormat(v as ListingFormat)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="physical" id="format-physical" />
                  <Label htmlFor="format-physical" className="font-normal">Physical</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="digital" id="format-digital" />
                  <Label htmlFor="format-digital" className="font-normal">Digital</Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Truck className="size-4" />
              Delivery method
            </div>
            <RadioGroup
              value={delivery}
              onValueChange={(v) => setDelivery(v as DeliveryMethod)}
              className="grid grid-cols-3 gap-2"
            >
              {(['post', 'collect-in-person', 'digital'] as DeliveryMethod[]).map((m) => (
                <div key={m} className="flex items-center space-x-2">
                  <RadioGroupItem value={m} id={`delivery-${m}`} />
                  <Label htmlFor={`delivery-${m}`} className="font-normal text-sm capitalize">
                    {m.replace(/-/g, ' ')}
                  </Label>
                </div>
              ))}
            </RadioGroup>

            <div className="pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => setShowAdvancedShipping((v) => !v)}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                {showAdvancedShipping ? 'Hide advanced shipping options' : 'Add advanced shipping options'}
              </button>

              {showAdvancedShipping && (
                <div className="mt-3 space-y-3">
                  {allShippingOptions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Saved shipping options</div>
                      {allShippingOptions.map((option) => {
                        const address = shippingOptionAddress(option.pubkey, option.dTag);
                        const checked = selectedShippingAddresses.includes(address);
                        return (
                          <div key={address} className="flex items-start gap-2">
                            <Checkbox
                              id={`shipping-${address}`}
                              checked={checked}
                              onCheckedChange={() => toggleShippingOption(address)}
                            />
                            <Label htmlFor={`shipping-${address}`} className="text-sm font-normal cursor-pointer leading-tight">
                              {formatShippingOption(option)}
                              <span className="block text-xs text-muted-foreground">
                                {formatShippingService(option.service)}
                              </span>
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <ShippingOptionForm
                    relays={relays}
                    onCreated={(option) => {
                      setLocalShippingOptions((prev) => [...prev, option]);
                      setSelectedShippingAddresses((prev) => [...prev, shippingOptionAddress(option.pubkey, option.dTag)]);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-tags">Tags (comma or space separated)</Label>
            <Input
              id="product-tags"
              placeholder="bitcoin, poster, merch"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">#product is added automatically.</p>
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

          <RelayPicker selected={relays} onChange={setRelays} />
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
