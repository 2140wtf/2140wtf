import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { SHIPPING_OPTION_KIND, type ShippingOption, type ShippingOptionService } from '@/lib/shippingOption';

interface ShippingOptionFormProps {
  relays: string[];
  onCreated: (option: ShippingOption) => void;
}

export function ShippingOptionForm({ relays, onCreated }: ShippingOptionFormProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent, isPending: isPublishing } = useNostrPublish();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();

  const [title, setTitle] = useState('');
  const [service, setService] = useState<ShippingOptionService>('standard');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');

  const canSubmit =
    !!user &&
    title.trim().length > 0 &&
    relays.length > 0 &&
    !isPublishing;

  const handleSubmit = async () => {
    if (!canSubmit || !user) return;
    if (!isEnabled('marketplace')) {
      toast({
        title: 'Marketplace publishing disabled',
        description: 'Turn on “Marketplace listings” in Settings → Privacy & Publishing to publish shipping options.',
      });
      return;
    }

    const priceValue = price.trim();
    if (priceValue && isNaN(Number(priceValue))) {
      toast({ title: 'Invalid price', description: 'Shipping price must be a number.', variant: 'destructive' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const dTag = `${user.pubkey}:${now}`;

    const tags: string[][] = [
      ['d', dTag],
      ['title', title.trim()],
      ['service', service],
    ];

    if (priceValue) {
      tags.push(['price', priceValue, 'SATS']);
    }
    if (duration.trim()) {
      tags.push(['duration', duration.trim()]);
    }

    tags.push(['alt', `Shipping option: ${title.trim()}`]);

    try {
      const event = await createEvent({
        kind: SHIPPING_OPTION_KIND,
        content: '',
        tags,
        relays,
      });

      const option: ShippingOption = {
        id: `${user.pubkey}:${dTag}`,
        eventId: event.id,
        pubkey: user.pubkey,
        dTag,
        title: title.trim(),
        price: priceValue
          ? { value: Number(priceValue), currency: 'SATS' }
          : null,
        service,
        duration: duration.trim() || undefined,
        createdAt: event.created_at,
        event,
      };

      toast({ title: 'Shipping option added', description: `${title.trim()} is now saved.` });
      setTitle('');
      setPrice('');
      setDuration('');
      setService('standard');
      onCreated(option);
    } catch {
      toast({ title: 'Error', description: 'Failed to save shipping option.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="shipping-title">Option name</Label>
        <Input
          id="shipping-title"
          placeholder="e.g. UK tracked delivery"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="shipping-service">Service type</Label>
          <Select value={service} onValueChange={(v) => setService(v as ShippingOptionService)}>
            <SelectTrigger id="shipping-service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard post</SelectItem>
              <SelectItem value="pickup">Collect in person</SelectItem>
              <SelectItem value="digital">Digital delivery</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="shipping-price">Extra price (SATS, optional)</Label>
          <Input
            id="shipping-price"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="shipping-duration">Estimated duration (optional)</Label>
        <Input
          id="shipping-duration"
          placeholder="e.g. 3-5 days"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {isPublishing && <Loader2 className="mr-2 size-3 animate-spin" />}
        <Plus className="size-3.5 mr-1" />
        Add shipping option
      </Button>
    </div>
  );
}
