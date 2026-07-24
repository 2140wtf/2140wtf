import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  BAO_RAILS,
  BAO_RAIL_LABELS,
  createFundraiser,
  type BaoFundraiserFormat,
  type BaoRail,
} from '@/lib/baoFundraising';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** Runner fee tiers from the ₿AO Fund spec: 1.0% / 2.14% / 4.21%. */
const FEE_OPTIONS = [
  { value: '100', label: '1.0%' },
  { value: '214', label: '2.14%' },
  { value: '421', label: '4.21%' },
] as const;

const DAY = 86_400;

interface MilestoneDraft {
  title: string;
  amount: string;
  criteria: string;
  /** Days from now (7–50 per the fund spec). */
  deadlineDays: string;
  feeBps: string;
}

const emptyMilestone = (): MilestoneDraft => ({
  title: '',
  amount: '',
  criteria: '',
  deadlineDays: '21',
  feeBps: '214',
});

export function CreateCampaignDialog({ open, onOpenChange, onCreated, initialTitle }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  /** Optional prefill for the title field (e.g. deep link from a pet's upkeep card). */
  initialTitle?: string;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [title, setTitle] = useState(initialTitle ?? '');
  const [description, setDescription] = useState('');
  const [runnerType, setRunnerType] = useState<'agent' | 'human' | 'agent_human'>('agent_human');
  const [rail, setRail] = useState<BaoRail>('lightning');
  const [category, setCategory] = useState('tools');
  const [format, setFormat] = useState<BaoFundraiserFormat>('milestones');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([emptyMilestone()]);
  const [streamDays, setStreamDays] = useState('30');

  const goal = useMemo(
    () => milestones.reduce((s, m) => s + (parseInt(m.amount, 10) || 0), 0),
    [milestones],
  );

  const mutation = useMutation({
    mutationFn: () => {
      const now = Math.floor(Date.now() / 1000);
      if (format === 'stream') {
        const days = parseInt(streamDays, 10) || 30;
        return createFundraiser(user!.signer, {
          title: title.trim(),
          description: description.trim() || undefined,
          runner_type: runnerType,
          goal_sats: goal,
          settlement_rail: rail,
          format: 'stream',
          category,
          stream_start_at: now,
          stream_end_at: now + days * DAY,
        });
      }
      return createFundraiser(user!.signer, {
        title: title.trim(),
        description: description.trim() || undefined,
        runner_type: runnerType,
        goal_sats: goal,
        settlement_rail: rail,
        format: 'milestones',
        category,
        milestones: milestones.map((m) => ({
          title: m.title.trim(),
          amount_sats: parseInt(m.amount, 10) || 0,
          criteria: m.criteria.trim() || undefined,
          deadline_at: m.deadlineDays ? now + (parseInt(m.deadlineDays, 10) || 21) * DAY : undefined,
          fee_bps: parseInt(m.feeBps, 10),
        })),
      });
    },
    onSuccess: (data) => {
      const marketCount = data.markets?.length ?? 0;
      toast({
        title: 'Campaign created (DEMO)',
        description: marketCount > 0 ? `${marketCount} prediction market${marketCount === 1 ? '' : 's'} live on bao.markets.` : undefined,
      });
      onOpenChange(false);
      setTitle(''); setDescription(''); setMilestones([emptyMilestone()]);
      onCreated(data.fundraiser.id);
    },
    onError: (e) => toast({ title: 'Create failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const valid =
    title.trim().length > 0 &&
    goal >= 1000 &&
    (format === 'stream' || milestones.every((m) => m.title.trim() && (parseInt(m.amount, 10) || 0) > 0));

  const patchMilestone = (i: number, patch: Partial<MilestoneDraft>) =>
    setMilestones((ms) => ms.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New fundraising campaign (DEMO)</DialogTitle>
          <DialogDescription>
            Every milestone becomes a YES/NO prediction market on bao.markets — the market's resolution gates the payout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Payout format</Label>
            <ToggleGroup
              type="single"
              value={format}
              onValueChange={(v) => v && setFormat(v as BaoFundraiserFormat)}
              className="justify-start"
            >
              <ToggleGroupItem value="milestones" className="text-xs">Milestone markets</ToggleGroupItem>
              <ToggleGroupItem value="stream" className="text-xs">Time-lock stream</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-title">Project title</Label>
            <Input id="fr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Oracle dashboard agent" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-desc">Description</Label>
            <Textarea id="fr-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What will the funds build?" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Run by</Label>
              <Select value={runnerType} onValueChange={(v) => setRunnerType(v as typeof runnerType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent_human">Agent + Human</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="infra">Infra</SelectItem>
                  <SelectItem value="tools">Tools</SelectItem>
                  <SelectItem value="baos">₿AOs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rail</Label>
              <Select value={rail} onValueChange={(v) => setRail(v as BaoRail)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BAO_RAILS.map((r) => <SelectItem key={r} value={r}>{BAO_RAIL_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {format === 'stream' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fr-goal">Goal (sats)</Label>
                <Input
                  id="fr-goal"
                  value={milestones[0]?.amount ?? ''}
                  onChange={(e) => patchMilestone(0, { amount: e.target.value.replace(/[^0-9]/g, '') })}
                  inputMode="numeric"
                  placeholder="100000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fr-stream-days">Vesting window (days)</Label>
                <Input
                  id="fr-stream-days"
                  value={streamDays}
                  onChange={(e) => setStreamDays(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                />
                <p className="text-[11px] text-muted-foreground">Starts now; vests linearly to the owner.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Milestones — each one is a prediction market</Label>
                <span className="text-xs text-muted-foreground tabular-nums">Goal: {formatSats(goal)} sats</span>
              </div>
              {milestones.map((m, i) => (
                <div key={i} className="rounded-md border p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={m.title}
                      onChange={(e) => patchMilestone(i, { title: e.target.value })}
                      placeholder={`Milestone ${i + 1}`}
                      className="flex-1"
                    />
                    <Input
                      value={m.amount}
                      onChange={(e) => patchMilestone(i, { amount: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="sats"
                      inputMode="numeric"
                      className="w-24 text-right"
                    />
                    <Button
                      variant="ghost" size="icon" className="shrink-0"
                      disabled={milestones.length <= 1}
                      onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                  <Input
                    value={m.criteria}
                    onChange={(e) => patchMilestone(i, { criteria: e.target.value })}
                    placeholder="Delivery criteria — becomes the market question"
                    className="text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={m.deadlineDays}
                      onChange={(e) => patchMilestone(i, { deadlineDays: e.target.value.replace(/[^0-9]/g, '') })}
                      inputMode="numeric"
                      className="w-20 text-right text-xs"
                    />
                    <span className="text-xs text-muted-foreground">days to deliver (7–50)</span>
                    <div className="flex-1" />
                    <Select value={m.feeBps} onValueChange={(v) => patchMilestone(i, { feeBps: v })}>
                      <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FEE_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label} fee</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              <Button
                variant="outline" size="sm" className="gap-1"
                disabled={milestones.length >= 11}
                onClick={() => setMilestones((ms) => [...ms, emptyMilestone()])}
              >
                <Plus className="size-3.5" /> Add milestone{milestones.length >= 11 ? ' (max 11)' : ''}
              </Button>
            </div>
          )}

          <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Create raise — ${formatSats(goal)} sats goal`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
