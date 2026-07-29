import { useState } from 'react';
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
  const [category, setCategory] = useState('bao-fund');
  const [outcomes, setOutcomes] = useState<string[]>(['yes', 'no']);
  const [endDays, setEndDays] = useState('30');

  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory('bao-fund');
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
          ['c', category.trim() || 'bao-fund'],
          ['n', BAO_MARKET_NETWORK],
          ['end', String(end)],
          ...validOutcomes.map((o) => ['outcome', o]),
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
              <Input
                id="mkt-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="bao-fund"
              />
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
