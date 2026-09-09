import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { BAO_MARKET_KIND } from '@/lib/baoMarketParser';
import { BAO_MARKETS_RELAY, BAO_MARKET_NETWORK } from '@/lib/baoRelayMarkets';

interface CreateBaoMarketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the market event is published (e.g. to refetch the list). */
  onCreated?: () => void;
}

export const MARKET_CATEGORIES = [
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'politics', label: 'Politics' },
  { value: 'sports', label: 'Sports' },
  { value: 'nostr', label: 'Nostr' },
  { value: 'angor-markets', label: 'Angor Markets' },
  { value: 'culture', label: 'Culture' },
  { value: 'events', label: 'Events' },
  { value: 'climate-energy', label: 'Climate & Energy' },
  { value: 'economics', label: 'Economics' },
  { value: 'tech-science', label: 'Tech & Science' },
  { value: 'bao', label: 'BAO' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * Create a prediction market nostr-natively: publishes a kind-38000 market
 * definition straight to the ₿AO relay, where every relay-first client
 * (this app, and any reader of NIP.md's kind-38000 spec) discovers it — no
 * bao.markets API session needed. Categories land on the markets page; the
 * default `bao-fund` groups community-driven markets together.
 */
export function CreateBaoMarketDialog({ open, onOpenChange, onCreated }: CreateBaoMarketDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending } = useNostrPublish();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('bitcoin');
  const [outcomes, setOutcomes] = useState<string[]>(['yes', 'no']);
  const [endDays, setEndDays] = useState('30');

  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory('bitcoin');
    setOutcomes(['yes', 'no']);
    setEndDays('30');
  };

  const patchOutcome = (i: number, value: string) =>
    setOutcomes((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const validOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);

  // Round 35: dedupe outcomes (duplicate labels poison the 1/N probability
  // math and the outcome-tag buttons), and bounds for publishing noise.
  const outcomeKey = validOutcomes.join('\u0000');
  const uniqueOutcomes = useMemo(
    () => Array.from(new Set(outcomeKey.split('\u0000'))),
    [outcomeKey],
  );
  const canPublish = useMemo(() => {
    const trimmedTitle = title.trim();
    const days = parseInt(endDays, 10) || 0;
    return (
      uniqueOutcomes.length >= 2 &&
      uniqueOutcomes.length <= 20 &&
      uniqueOutcomes.every((o) => o.length <= 100) &&
      trimmedTitle.length > 0 &&
      trimmedTitle.length <= 200 &&
      description.trim().length <= 5000 &&
      days >= 1 &&
      days <= 1825
    );
  }, [title, description, uniqueOutcomes, endDays]);

  const handleCreate = async () => {
    if (!user) {
      toast({ title: 'Log in first', description: 'Creating a market needs an identity to sign with.', variant: 'destructive' });
      return;
    }
    if (uniqueOutcomes.length < 2 || uniqueOutcomes.length > 20) {
      toast({ title: 'Outcome count must be between 2 and 20', variant: 'destructive' });
      return;
    }
    if (!title.trim() || title.trim().length > 200) {
      toast({ title: 'Question must be 1–200 characters', variant: 'destructive' });
      return;
    }
    if (description.trim().length > 5000) {
      toast({ title: 'Description must be ≤ 5000 characters', variant: 'destructive' });
      return;
    }
    const days = parseInt(endDays, 10) || 0;
    if (days < 1 || days > 1825) {
      toast({ title: 'Expiry must be 1 day to 5 years out', variant: 'destructive' });
      return;
    }
    const end = Math.floor(Date.now() / 1000) + days * 86_400;
    const id = `market-${crypto.randomUUID()}`;

    try {
      await publishEvent({
        kind: BAO_MARKET_KIND,
        content: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          outcomes: uniqueOutcomes,
        }),
        tags: [
          ['d', id],
          ['title', title.trim()],
          ['c', category],
          ['n', BAO_MARKET_NETWORK],
          ['end', String(end)],
          ...uniqueOutcomes.map((o) => ['outcome', o]),
          ['alt', 'Prediction market definition'],
        ],
        relay: BAO_MARKETS_RELAY,
      });
      toast({ title: 'Market published', description: 'Live on the ₿AO relay — relay-first clients see it within seconds.' });
      onOpenChange(false);
      reset();
      onCreated?.();
    } catch (e) {
      toast({
        title: 'Publish failed',
        description: e instanceof Error ? e.message : 'Could not publish the market.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create prediction market</DialogTitle>
          <DialogDescription>
            Published as a kind-38000 event to the ₿AO relay — any Nostr client
            reading market definitions sees it. Trading settles via bao.markets
            (signet demo).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mkt-title">Question</Label>
            <Input
              id="mkt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Will Bitcoin reach 214k by 2027?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mkt-desc">Description (optional)</Label>
            <Textarea
              id="mkt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Resolution criteria, sources, details…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mkt-cat">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="mkt-cat" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKET_CATEGORIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mkt-days">Ends in (days)</Label>
              <Input
                id="mkt-days"
                value={endDays}
                onChange={(e) => setEndDays(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Outcomes</Label>
            {outcomes.map((outcome, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={outcome}
                  onChange={(e) => patchOutcome(i, e.target.value)}
                  placeholder={`Outcome ${i + 1}`}
                />
                {outcomes.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove outcome"
                    onClick={() => setOutcomes((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {outcomes.length < 6 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOutcomes((prev) => [...prev, ''])}
              >
                <Plus className="size-3.5 mr-1" /> Add outcome
              </Button>
            )}
          </div>

          <Button
            className="w-full"
            disabled={isPending || !canPublish}
            onClick={handleCreate}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Publish market'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
