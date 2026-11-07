import { useEffect, useMemo, useState } from 'react';
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
import { useBaoMarketCategories } from '@/hooks/useBaoPredictionMarkets';
import { isSelectableMarketCategory } from '@/lib/marketCategories';
import { BAO_MARKET_KIND } from '@/lib/baoMarketParser';
import { baoMarketNetwork, baoMarketsRelay } from '@/lib/baoRelayMarkets';

interface CreateBaoMarketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the market event is published (e.g. to refetch the list). */
  onCreated?: () => void;
}

/**
 * Fallback only: these are the slugs `GET /v1/categories` currently serves, so
 * a market created from this list is always reachable through the markets
 * picker. The live catalogue wins whenever it answers.
 *
 * The old hardcoded twelve (`bitcoin`, `politics`, `sports`, `angor-markets`,
 * `climate-energy`, `tech-science`, ...) had no counterpart in the API
 * vocabulary, so a market tagged with one of them could never be selected back
 * — three of those slugs do not even exist in bao.markets' canonical taxonomy.
 */
export const FALLBACK_MARKET_CATEGORIES = [
  { value: 'crypto', label: 'crypto' },
  { value: 'btc-price', label: 'btc-price' },
  { value: 'politics-us', label: 'politics-us' },
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
  // Options come from the live catalogue — the same list the markets page
  // renders chips for. `fundraiser` (a query alias) and the ₿AO Fund silo are
  // filtered out by isSelectableMarketCategory.
  const { data: apiCategories = [] } = useBaoMarketCategories();
  const categoryOptions = useMemo(() => {
    const live = apiCategories
      .filter((c) => isSelectableMarketCategory(c.slug))
      .map((c) => ({ value: c.slug, label: c.label || c.slug }));
    return live.length > 0
      ? live
      : FALLBACK_MARKET_CATEGORIES.map((c) => ({ value: c.value as string, label: c.label as string }));
  }, [apiCategories]);
  const [category, setCategory] = useState(() => categoryOptions[0]?.value ?? '');
  const [outcomes, setOutcomes] = useState<string[]>(['yes', 'no']);
  const [endDays, setEndDays] = useState('30');

  // A selection that disappears from the catalogue (first render before it
  // loads, or a category that lost its last market) would submit a slug with no
  // picker chip — resync it instead of publishing an unreachable market.
  useEffect(() => {
    if (!categoryOptions.some((o) => o.value === category)) {
      setCategory(categoryOptions[0]?.value ?? '');
    }
  }, [categoryOptions, category]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory(categoryOptions[0]?.value ?? '');
    setOutcomes(['yes', 'no']);
    setEndDays('30');
  };

  const patchOutcome = (i: number, value: string) =>
    setOutcomes((prev) => prev.map((o, idx) => (idx === i ? value : o)));

  const validOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);

  const handleCreate = async () => {
    if (!user) {
      toast({ title: 'Log in first', description: 'Creating a market needs an identity to sign with.', variant: 'destructive' });
      return;
    }
    if (validOutcomes.length < 2) {
      toast({ title: 'Need at least two outcomes', variant: 'destructive' });
      return;
    }
    if (!category) {
      toast({ title: 'Pick a category', description: 'The catalogue has not loaded a category to file this market under yet.', variant: 'destructive' });
      return;
    }
    const days = parseInt(endDays, 10) || 30;
    const end = Math.floor(Date.now() / 1000) + days * 86_400;
    const id = `market-${crypto.randomUUID()}`;

    try {
      await publishEvent({
        kind: BAO_MARKET_KIND,
        content: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          outcomes: validOutcomes,
        }),
        tags: [
          ['d', id],
          ['title', title.trim()],
          ['c', category],
          ['n', baoMarketNetwork()],
          ['end', String(end)],
          ...validOutcomes.map((o) => ['outcome', o]),
          ['alt', 'Prediction market definition'],
        ],
        relay: baoMarketsRelay(),
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
                  {categoryOptions.map((option) => (
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
            disabled={isPending || !title.trim() || validOutcomes.length < 2}
            onClick={handleCreate}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Publish market'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
