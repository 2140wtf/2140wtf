import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, CircleDollarSign, HandCoins, Loader2, Lock, Plus, Sparkles, Trash2, Unlock, User, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  BAO_RAILS,
  BAO_RAIL_LABELS,
  baoApiBase,
  contributeToFundraiser,
  createFundraiser,
  fetchFundraiser,
  fetchFundraisers,
  releaseMilestone,
  type BaoFundraiser,
  type BaoMilestone,
  type BaoRail,
} from '@/lib/baoFundraising';
import { cn } from '@/lib/utils';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

function RunnerBadge({ type }: { type: BaoFundraiser['runner_type'] }) {
  if (type === 'agent') {
    return <Badge variant="secondary" className="gap-1"><Bot className="size-3" /> Agent</Badge>;
  }
  if (type === 'agent_human') {
    return <Badge variant="secondary" className="gap-1"><Users className="size-3" /> Agent + Human</Badge>;
  }
  return <Badge variant="secondary" className="gap-1"><User className="size-3" /> Human</Badge>;
}

function MilestoneIcon({ status }: { status: BaoMilestone['status'] }) {
  if (status === 'released') return <CheckCircle2 className="size-4 text-green-500" />;
  if (status === 'unlocked') return <Unlock className="size-4 text-amber-500" />;
  return <Lock className="size-4 text-muted-foreground" />;
}

/**
 * ₿AO Funding (TEST) — fundraising mockups over the bao.markets API.
 *
 * Agents and human projects raise sats over any rail (L1 → Lightning →
 * Cashu/Spark/Ark/Liquid/NWC/Fedimint); raised funds unlock in milestones.
 * TEST mode: no real payment is verified or settled.
 */
export function BaoFundingPage() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [contributeTarget, setContributeTarget] = useState<BaoFundraiser | null>(null);

  const listQuery = useQuery({
    queryKey: ['bao-fundraisers'],
    queryFn: () => fetchFundraisers(),
    refetchInterval: 15_000,
    retry: 1,
  });

  const detailQuery = useQuery({
    queryKey: ['bao-fundraiser', selectedId],
    queryFn: () => fetchFundraiser(selectedId!),
    enabled: !!selectedId,
    refetchInterval: 10_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bao-fundraisers'] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ['bao-fundraiser', selectedId] });
  };

  const releaseMutation = useMutation({
    mutationFn: ({ fundraiserId, milestoneId }: { fundraiserId: string; milestoneId: string }) =>
      releaseMilestone(user!.signer, fundraiserId, milestoneId),
    onSuccess: () => {
      toast({ title: 'Milestone released (TEST)' });
      invalidate();
    },
    onError: (e) => toast({ title: 'Release failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const fundraisers = listQuery.data ?? [];
  const detail = detailQuery.data;
  const isOwner = !!user && !!detail && detail.fundraiser.owner_pubkey === user.pubkey;

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HandCoins className="size-6 text-primary" /> ₿AO Funding
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fund agent &amp; human projects over any rail — L1, Lightning, Cashu, Spark, Ark, Liquid, NWC — unlocked in milestones.
          </p>
        </div>
        {user && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
            <Plus className="size-4" /> New raise
          </Button>
        )}
      </div>

      {/* TEST banner — always visible */}
      <div className="rounded-lg border-2 border-dashed border-amber-500/70 bg-amber-500/10 px-4 py-3 text-sm">
        <p className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <Sparkles className="size-4" /> TEST MOCKUP — no real money moves
        </p>
        <p className="text-muted-foreground mt-0.5">
          Contributions are recorded by the bao.markets API (<code className="text-xs">{baoApiBase()}</code>) but no payment is verified or settled. Milestone unlocks are simulated.
        </p>
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : listQuery.isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Can't reach the bao.markets API at <code className="text-xs">{baoApiBase()}</code>.
            Start it locally (packages/api, port 3462) or set <code className="text-xs">VITE_BAO_FUNDRAISING_API_URL</code>.
          </CardContent>
        </Card>
      ) : fundraisers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No fundraising campaigns yet.{user ? ' Start the first one!' : ' Log in to start one.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {fundraisers.map((f) => {
            const pct = Math.min(100, Math.round((Number(f.raised_sats) / Number(f.goal_sats)) * 100));
            const selected = selectedId === f.id;
            return (
              <Card
                key={f.id}
                className={cn('cursor-pointer transition-colors hover:border-primary/50', selected && 'border-primary')}
                onClick={() => setSelectedId(selected ? null : f.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{f.title}</CardTitle>
                      <CardDescription className="mt-1 flex items-center gap-2 flex-wrap">
                        <RunnerBadge type={f.runner_type} />
                        <Badge variant={f.status === 'open' ? 'outline' : 'default'} className="capitalize">{f.status}</Badge>
                        <span className="text-xs">settles via {f.settlement_rail}</span>
                      </CardDescription>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">{formatSats(Number(f.raised_sats))} / {formatSats(Number(f.goal_sats))} sats</div>
                      <div className="text-xs text-muted-foreground">{pct}% funded</div>
                    </div>
                  </div>
                  <Progress value={pct} className="h-2 mt-2" />
                </CardHeader>

                {selected && (
                  <CardContent className="pt-0 space-y-4" onClick={(e) => e.stopPropagation()}>
                    {f.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.description}</p>}

                    <Separator />

                    {detailQuery.isLoading ? (
                      <Skeleton className="h-24 w-full" />
                    ) : detail ? (
                      <>
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold">Milestones</h3>
                          {detail.milestones.map((m) => (
                            <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <MilestoneIcon status={m.status} />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{m.idx + 1}. {m.title}</div>
                                  {m.description && <div className="text-xs text-muted-foreground truncate">{m.description}</div>}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs tabular-nums text-muted-foreground">{formatSats(Number(m.amount_sats))} sats</span>
                                {m.status === 'unlocked' && isOwner && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={releaseMutation.isPending}
                                    onClick={() => releaseMutation.mutate({ fundraiserId: f.id, milestoneId: m.id })}
                                  >
                                    {releaseMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Release'}
                                  </Button>
                                )}
                                {m.status === 'released' && <Badge variant="outline" className="text-green-500 border-green-500/40">paid (test)</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>

                        {f.status === 'open' && (
                          user ? (
                            <Button className="w-full gap-1.5" onClick={() => setContributeTarget(f)}>
                              <CircleDollarSign className="size-4" /> Fund this project (test)
                            </Button>
                          ) : (
                            <p className="text-xs text-center text-muted-foreground">Log in to contribute.</p>
                          )
                        )}
                      </>
                    ) : null}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CreateFundraiserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => { invalidate(); setSelectedId(id); }}
      />
      <ContributeDialog
        fundraiser={contributeTarget}
        onOpenChange={(open) => !open && setContributeTarget(null)}
        onContributed={() => invalidate()}
      />
    </div>
  );
}

// ── Create dialog ────────────────────────────────────────────────────────────

function CreateFundraiserDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [runnerType, setRunnerType] = useState<'agent' | 'human' | 'agent_human'>('agent_human');
  const [rail, setRail] = useState<BaoRail>('lightning');
  const [milestones, setMilestones] = useState<{ title: string; amount: string }[]>([{ title: '', amount: '' }]);

  const goal = useMemo(
    () => milestones.reduce((s, m) => s + (parseInt(m.amount, 10) || 0), 0),
    [milestones],
  );

  const mutation = useMutation({
    mutationFn: () => createFundraiser(user!.signer, {
      title: title.trim(),
      description: description.trim() || undefined,
      runner_type: runnerType,
      goal_sats: goal,
      settlement_rail: rail,
      milestones: milestones.map((m) => ({ title: m.title.trim(), amount_sats: parseInt(m.amount, 10) || 0 })),
    }),
    onSuccess: (data) => {
      toast({ title: 'Fundraiser created (TEST)' });
      onOpenChange(false);
      setTitle(''); setDescription(''); setMilestones([{ title: '', amount: '' }]);
      onCreated(data.fundraiser.id);
    },
    onError: (e) => toast({ title: 'Create failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const valid = title.trim().length > 0 && goal >= 1000 && milestones.every((m) => m.title.trim() && (parseInt(m.amount, 10) || 0) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New fundraising campaign (TEST)</DialogTitle>
          <DialogDescription>
            The goal is the sum of milestone amounts. Funds unlock milestone by milestone as the raise progresses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fr-title">Project title</Label>
            <Input id="fr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Oracle dashboard agent" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-desc">Description</Label>
            <Textarea id="fr-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What will the funds build?" />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              <Label>Settlement rail</Label>
              <Select value={rail} onValueChange={(v) => setRail(v as BaoRail)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BAO_RAILS.map((r) => <SelectItem key={r} value={r}>{BAO_RAIL_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Milestones</Label>
              <span className="text-xs text-muted-foreground tabular-nums">Goal: {formatSats(goal)} sats</span>
            </div>
            {milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={m.title}
                  onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                  placeholder={`Milestone ${i + 1}`}
                  className="flex-1"
                />
                <Input
                  value={m.amount}
                  onChange={(e) => setMilestones((ms) => ms.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^0-9]/g, '') } : x))}
                  placeholder="sats"
                  inputMode="numeric"
                  className="w-28 text-right"
                />
                <Button
                  variant="ghost" size="icon" className="shrink-0"
                  disabled={milestones.length <= 1}
                  onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setMilestones((ms) => [...ms, { title: '', amount: '' }])}>
              <Plus className="size-3.5" /> Add milestone
            </Button>
          </div>

          <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Create raise — ${formatSats(goal)} sats goal`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Contribute dialog ────────────────────────────────────────────────────────

function ContributeDialog({ fundraiser, onOpenChange, onContributed }: {
  fundraiser: BaoFundraiser | null;
  onOpenChange: (open: boolean) => void;
  onContributed: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [amount, setAmount] = useState('1000');
  const [rail, setRail] = useState<BaoRail>('lightning');
  const [instructions, setInstructions] = useState<Record<string, unknown> | null>(null);

  const mutation = useMutation({
    mutationFn: () => contributeToFundraiser(user!.signer, fundraiser!.id, {
      amount_sats: parseInt(amount, 10) || 0,
      rail,
    }),
    onSuccess: (data) => {
      setInstructions(data.payment_instructions as Record<string, unknown>);
      toast({ title: 'Contribution recorded (TEST)' });
      onContributed();
    },
    onError: (e) => toast({ title: 'Contribution failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const close = (open: boolean) => {
    if (!open) { setInstructions(null); setAmount('1000'); }
    onOpenChange(open);
  };

  const remaining = fundraiser ? Number(fundraiser.goal_sats) - Number(fundraiser.raised_sats) : 0;

  return (
    <Dialog open={!!fundraiser} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fund: {fundraiser?.title}</DialogTitle>
          <DialogDescription>
            TEST — the contribution is recorded by the API but no real payment is made.
            {fundraiser && ` ${formatSats(remaining)} sats to goal.`}
          </DialogDescription>
        </DialogHeader>

        {instructions ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs space-y-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400">Mock payment instructions ({String(instructions.kind)})</p>
              {Object.entries(instructions).map(([k, v]) => (
                <p key={k} className="break-all"><span className="text-muted-foreground">{k}:</span> {String(v)}</p>
              ))}
            </div>
            <Button className="w-full" onClick={() => close(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fr-amount">Amount (sats)</Label>
              <Input id="fr-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
            </div>

            <div className="space-y-1.5">
              <Label>Pay via</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {BAO_RAILS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRail(r)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      rail === r ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {BAO_RAIL_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!(parseInt(amount, 10) > 0) || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Contribute ${formatSats(parseInt(amount, 10) || 0)} sats (test)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Re-export for the router's named-import lazy() pattern.
export default BaoFundingPage;
