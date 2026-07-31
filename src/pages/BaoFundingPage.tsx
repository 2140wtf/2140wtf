import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronUp, CircleDollarSign, HandCoins, Loader2, Plus, Sparkles, User, Users, Waves } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { AttestationPanel } from '@/components/bao-fund/AttestationPanel';
import { ComputeCreditsTab } from '@/components/bao-fund/ComputeCreditsTab';
import { CreateCampaignDialog } from '@/components/bao-fund/CreateCampaignDialog';
import { MilestoneMarketWidget } from '@/components/bao-fund/MilestoneMarketWidget';
import { StreamBar } from '@/components/bao-fund/StreamBar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  BAO_MARKETS_URL,
  BAO_RAILS,
  BAO_RAIL_LABELS,
  baoApiBase,
  claimStream,
  contributeToFundraiser,
  DEFAULT_VERIFICATION_MODEL,
  fetchFundraiser,
  fetchFundraisers,
  fetchVerificationModels,
  fetchVerificationStats,
  isBaoRailLive,
  releaseMilestone,
  scoreMilestone,
  type BaoFundraiser,
  type BaoMilestone,
  type BaoRail,
} from '@/lib/baoFundraising';
import { BAO_CATEGORIES } from '@/lib/baoCategories';
import { openUrl } from '@/lib/downloadFile';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** Short display name from a model id (`moonshotai/kimi-k3` → `kimi-k3`). */
function shortModelName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId;
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

const CATEGORY_FILTERS = [
  { id: 'all', label: 'All' },
  ...BAO_CATEGORIES,
] as const;

/**
 * ₿AO Fund (DEMO) — milestone prediction markets + time-lock treasury
 * streams over the bao.markets API, plus a REAL Routstr compute-credits tab
 * for agents without money.
 *
 * DEMO mode (Campaigns tab): contributions are recorded but no real payment
 * is verified or settled. Compute credits: real mainnet Cashu tokens.
 */
export function BaoFundingPage() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [contributeTarget, setContributeTarget] = useState<BaoFundraiser | null>(null);
  const [scoreTarget, setScoreTarget] = useState<{ fundraiser: BaoFundraiser; milestone: BaoMilestone; model: string } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchParams] = useSearchParams();

  // Deep links (e.g. from a pet's upkeep card):
  //   /bao-fund?campaign=<id>      → preselect/expand that campaign
  //   /bao-fund?create=1&title=…   → open the create dialog, prefilled
  useEffect(() => {
    const campaign = searchParams.get('campaign');
    if (campaign) setSelectedId(campaign);
    if (searchParams.get('create') === '1' && user) setCreateOpen(true);
  }, [searchParams, user]);

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
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: ['bao-fundraiser', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['bao-verification', selectedId] });
    }
  };

  const releaseMutation = useMutation({
    mutationFn: ({ fundraiserId, milestoneId }: { fundraiserId: string; milestoneId: string }) =>
      releaseMilestone(user!.signer, fundraiserId, milestoneId),
    onSuccess: () => {
      toast({ title: 'Milestone released (DEMO)' });
      invalidate();
    },
    onError: (e) => toast({ title: 'Release failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const claimMutation = useMutation({
    mutationFn: (fundraiserId: string) => claimStream(user!.signer, fundraiserId),
    onSuccess: (data) => {
      toast({ title: 'Stream claimed (DEMO)', description: `${formatSats(data.claimable_sats)} sats recorded.` });
      invalidate();
    },
    onError: (e) => toast({ title: 'Claim failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const allFundraisers = listQuery.data ?? [];
  const fundraisers = categoryFilter === 'all'
    ? allFundraisers
    : allFundraisers.filter((f) => (f.category === 'daos' ? 'baos' : (f.category ?? 'tools')) === categoryFilter);
  const detail = detailQuery.data;
  const isOwner = !!user && !!detail && detail.fundraiser.owner_pubkey === user.pubkey;

  // Itemized fee breakdown of the most recent release, shown under the
  // milestone it belongs to (the API returns it on the release response).
  const releaseInfo = releaseMutation.data && releaseMutation.variables
    ? { milestoneId: releaseMutation.variables.milestoneId, ...releaseMutation.data }
    : null;

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HandCoins className="size-6 text-primary" /> ₿AO Fund
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Milestones are prediction markets. Funds unlock when the crowd says the work landed — or stream to the treasury over time.
          </p>
        </div>
        {user && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
            <Plus className="size-4" /> New raise
          </Button>
        )}
      </div>

      <Tabs defaultValue="campaigns">
        <TabsList className="w-full">
          <TabsTrigger value="campaigns" className="flex-1">Campaigns</TabsTrigger>
          <TabsTrigger value="compute" className="flex-1 gap-1.5">
            Compute credits
            <Badge variant="outline" className="text-[10px] px-1 py-0 text-green-500 border-green-500/40">REAL</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4 mt-4">
          {/* DEMO banner — scoped to the Campaigns tab */}
          <div className="rounded-lg border-2 border-dashed border-amber-500/70 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <Sparkles className="size-4" /> DEMO — signet, no real money
            </p>
            <p className="text-muted-foreground mt-0.5">
              Campaigns and markets run on the bao.markets demo API (<code className="text-xs">{baoApiBase()}</code>) — contributions are recorded, not settled. The Compute credits tab uses real sats.
            </p>
            <p className="text-muted-foreground mt-1">
              <span className="text-amber-600 dark:text-amber-400 font-medium">Experimental:</span> demo sats are free, so market odds mean nothing — anyone can shift any vote to either side at will. Milestone resolution by crowd vote is a gameable mechanism; treat every outcome as a drill, not a signal.
            </p>
            <div className="mt-2 rounded-md bg-background/60 px-3 py-2">
              <p className="font-medium text-amber-600 dark:text-amber-400">How to get demo sats for testing</p>
              <ol className="list-decimal pl-4 mt-1 space-y-0.5 text-muted-foreground text-xs">
                <li>Creating a campaign or market is <span className="text-foreground font-medium">free</span> — no sats needed (anti-spam is rate limits, not fees).</li>
                <li>
                  To contribute or trade, claim <span className="text-foreground font-medium">21,400 free demo sats per rail every 24h</span> on{' '}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => openUrl(BAO_MARKETS_URL)}>
                    bao.markets
                  </button>
                  {' '}— open Wallet, pick a rail (Lightning, Cashu, or On-chain), tap Claim. Guest Nostr login, no signup.
                </li>
                <li>Come back here and contribute on the same rail — the demo ledger records it instantly.</li>
              </ol>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {CATEGORY_FILTERS.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={categoryFilter === c.id ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.label}
              </Button>
            ))}
          </div>

          {listQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
            </div>
          ) : listQuery.isError ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Can't reach the bao.markets API at <code className="text-xs">{baoApiBase()}</code>.
                Check your connection, or set <code className="text-xs">VITE_BAO_FUNDRAISING_API_URL</code> to override the endpoint.
              </CardContent>
            </Card>
          ) : fundraisers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {allFundraisers.length === 0
                  ? `No fundraising campaigns yet.${user ? ' Start the first one!' : ' Log in to start one.'}`
                  : 'No campaigns in this category.'}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {fundraisers.map((f) => (
                <CampaignCard
                  key={f.id}
                  fundraiser={f}
                  expanded={selectedId === f.id}
                  onToggle={() => setSelectedId(selectedId === f.id ? null : f.id)}
                  detail={selectedId === f.id ? detail : undefined}
                  detailLoading={selectedId === f.id && detailQuery.isLoading}
                  isOwner={selectedId === f.id && isOwner}
                  isLoggedIn={!!user}
                  onContribute={() => setContributeTarget(f)}
                  onRelease={(milestoneId) => releaseMutation.mutate({ fundraiserId: f.id, milestoneId })}
                  releasePending={releaseMutation.isPending}
                  releaseInfo={releaseInfo}
                  onScore={(milestone, model) => detail && setScoreTarget({ fundraiser: detail.fundraiser, milestone, model })}
                  onClaim={() => claimMutation.mutate(f.id)}
                  claimPending={claimMutation.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="compute" className="mt-4">
          <ComputeCreditsTab />
        </TabsContent>
      </Tabs>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => { invalidate(); setSelectedId(id); }}
        initialTitle={searchParams.get('title') ?? undefined}
        initialRepo={searchParams.get('repo') ?? undefined}
      />
      <ContributeDialog
        fundraiser={contributeTarget}
        onOpenChange={(open) => !open && setContributeTarget(null)}
        onContributed={() => invalidate()}
      />
      <ScoreMilestoneDialog
        target={scoreTarget}
        onOpenChange={(open) => !open && setScoreTarget(null)}
        onScored={() => invalidate()}
      />
    </div>
  );
}

// ── Campaign card ────────────────────────────────────────────────────────────

function CampaignCard({ fundraiser: f, expanded, onToggle, detail, detailLoading, isOwner, isLoggedIn, onContribute, onRelease, releasePending, releaseInfo, onScore, onClaim, claimPending }: {
  fundraiser: BaoFundraiser;
  expanded: boolean;
  onToggle: () => void;
  detail?: { fundraiser: BaoFundraiser; milestones: BaoMilestone[] };
  detailLoading: boolean;
  isOwner: boolean;
  isLoggedIn: boolean;
  onContribute: () => void;
  onRelease: (milestoneId: string) => void;
  releasePending: boolean;
  /** Fee breakdown of the just-released milestone, if any. */
  releaseInfo: { milestoneId: string; milestone_amount_sats?: number; verification_fee_msats?: number; released_sats?: number } | null;
  onScore: (milestone: BaoMilestone, model: string) => void;
  onClaim: () => void;
  claimPending: boolean;
}) {
  const author = useAuthor(f.owner_pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(f.owner_pubkey);
  const pct = Math.min(100, Math.round((Number(f.raised_sats) / Number(f.goal_sats)) * 100));
  const format = f.format ?? 'milestones';

  // AI verification stats (scores, fees, balance) — public endpoint. Tolerate
  // failure: older API deployments don't have it, and the market widget is
  // still fully usable without scores.
  const verificationQuery = useQuery({
    queryKey: ['bao-verification', f.id],
    queryFn: () => fetchVerificationStats(f.id),
    enabled: expanded,
    retry: false,
    refetchInterval: 15_000,
  });
  const verifications = verificationQuery.data?.verifications ?? [];
  // Verifications arrive ordered (created_at ASC, attempt ASC) — last is latest.
  const latestVerificationFor = (milestoneId: string) => {
    const list = verifications.filter((v) => v.milestone_id === milestoneId);
    return list.length > 0 ? list[list.length - 1] : null;
  };
  // Effective judge model: the model of the latest score if one exists,
  // otherwise the registry default (Kimi K3).
  const judgeModelId = verifications.length > 0 ? verifications[verifications.length - 1].model : null;

  return (
    <Card
      className={cn('cursor-pointer transition-colors hover:border-primary/50', expanded && 'border-primary')}
      onClick={onToggle}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{f.title}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs">
                <Avatar className="size-4">
                  <AvatarImage src={metadata?.picture} alt={displayName} />
                  <AvatarFallback className="text-[8px]">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                {displayName}
              </span>
              <RunnerBadge type={f.runner_type} />
              {format === 'stream' && (
                <Badge variant="secondary" className="gap-1"><Waves className="size-3" /> Stream</Badge>
              )}
              <Badge variant={f.status === 'open' ? 'outline' : 'default'} className="capitalize">{f.status}</Badge>
              {f.category && <Badge variant="outline" className="capitalize">{f.category === 'daos' || f.category === 'baos' ? '₿AOs' : f.category}</Badge>}
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums">{formatSats(Number(f.raised_sats))} / {formatSats(Number(f.goal_sats))} sats</div>
            <div className="text-xs text-muted-foreground">{pct}% funded</div>
          </div>
        </div>
        {f.description && !expanded && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-2">{f.description}</p>
        )}
        <Progress value={pct} className="h-2 mt-2" />
        <div className="flex items-center justify-center gap-1 pt-1.5 text-[11px] text-muted-foreground">
          {expanded ? (<>Show less <ChevronUp className="size-3.5" /></>) : (<>Read more <ChevronDown className="size-3.5" /></>)}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4" onClick={(e) => e.stopPropagation()}>
          {f.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.description}</p>}

          <Separator />

          {detailLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : detail ? (
            <>
              {format === 'stream' ? (
                <StreamBar
                  fundraiser={detail.fundraiser}
                  isOwner={isOwner}
                  onClaim={onClaim}
                  isClaiming={claimPending}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold">Milestones — each one a market</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {judgeModelId
                        ? `Judge: ${shortModelName(judgeModelId)} (latest score)`
                        : 'Judge: Kimi K3 (default)'}
                    </span>
                  </div>
                  {detail.milestones.map((m) => {
                    const verification = latestVerificationFor(m.id);
                    return (
                      <div key={m.id} className="space-y-1.5">
                        <MilestoneMarketWidget milestone={m} fundraiser={detail.fundraiser} verification={verification} />
                        <AttestationPanel fundraiser={detail.fundraiser} milestone={m} isOwner={isOwner} />
                        {releaseInfo && releaseInfo.milestoneId === m.id && releaseInfo.released_sats !== undefined && (
                          <div className="rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-xs space-y-0.5">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Milestone amount</span>
                              <span className="tabular-nums">{formatSats(releaseInfo.milestone_amount_sats ?? Number(m.amount_sats))} sats</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">AI verification fee</span>
                              <span className="tabular-nums">−{formatSats(Math.ceil((releaseInfo.verification_fee_msats ?? 0) / 1000))} sats</span>
                            </div>
                            <div className="flex justify-between font-medium">
                              <span>You receive</span>
                              <span className="tabular-nums">{formatSats(releaseInfo.released_sats)} sats</span>
                            </div>
                          </div>
                        )}
                        {m.status === 'unlocked' && isOwner && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onScore(m, judgeModelId ?? DEFAULT_VERIFICATION_MODEL)}
                            >
                              Score milestone
                            </Button>
                            {(m.market_resolution === 'yes' || !m.market_id) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={releasePending}
                                onClick={() => onRelease(m.id)}
                              >
                                {releasePending ? <Loader2 className="size-3.5 animate-spin" /> : `Release ${formatSats(Number(m.amount_sats))} sats`}
                              </Button>
                            )}
                          </div>
                        )}
                        {m.status === 'unlocked' && m.market_id && m.market_resolution !== 'yes' && (
                          <p className="text-[11px] text-muted-foreground text-right">
                            Funded — waiting for the market to resolve YES.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {f.status === 'open' && (
                isLoggedIn ? (
                  <Button className="w-full gap-1.5" onClick={onContribute}>
                    <CircleDollarSign className="size-4" /> Fund this project (demo)
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
}

// ── Score milestone dialog ──────────────────────────────────────────────────

/**
 * Owner confirmation for submitting milestone evidence to the AI verifier.
 * The API enqueues a scoring job (202) and the worker publishes a public,
 * signed score event; the fee is deducted from the milestone payout.
 */
function ScoreMilestoneDialog({ target, onOpenChange, onScored }: {
  target: { fundraiser: BaoFundraiser; milestone: BaoMilestone; model: string } | null;
  onOpenChange: (open: boolean) => void;
  onScored: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [evidence, setEvidence] = useState('');

  // Reset the evidence draft whenever a different milestone is targeted.
  const targetId = target?.milestone.id ?? null;
  useEffect(() => {
    setEvidence('');
  }, [targetId]);

  const mutation = useMutation({
    mutationFn: () => scoreMilestone(user!.signer, target!.fundraiser.id, target!.milestone.id, evidence.trim()),
    onSuccess: (data) => {
      toast({
        title: 'AI scoring queued (DEMO)',
        description: `Job #${data.job_id} — est. fee ${formatSats(Math.ceil(data.estimated_fee_msats / 1000))} sats, judged by ${shortModelName(data.model)}.`,
      });
      onOpenChange(false);
      onScored();
    },
    onError: (e) => toast({ title: 'Scoring failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const close = (open: boolean) => {
    if (!open) setEvidence('');
    onOpenChange(open);
  };

  return (
    <Dialog open={!!target} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Score milestone{target ? `: ${target.milestone.title}` : ''}</DialogTitle>
          <DialogDescription>
            Judge: {target ? shortModelName(target.model) : ''} · estimated cost ~500 sats (min), deducted from the payout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            This publishes a public, signed score event. Fee is deducted from the payout.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="score-evidence">Evidence</Label>
            <Textarea
              id="score-evidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={6}
              placeholder="Links, commit hashes, screenshots descriptions — what proves the deliverable matches the criteria?"
            />
          </div>
          <Button
            className="w-full"
            disabled={!evidence.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Submit for AI scoring (demo)'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Contribute dialog ────────────────────────────────────────────────────────

// Exported for regression tests (idempotency key + stale instructions races).
export function ContributeDialog({ fundraiser, onOpenChange, onContributed }: {
  fundraiser: BaoFundraiser | null;
  onOpenChange: (open: boolean) => void;
  onContributed: () => void;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [amount, setAmount] = useState('1000');
  const [rail, setRail] = useState<BaoRail>('lightning');
  const [judgeModel, setJudgeModel] = useState<string>(DEFAULT_VERIFICATION_MODEL);
  const [instructions, setInstructions] = useState<Record<string, unknown> | null>(null);
  // Stable idempotency key per campaign: a retry after a network timeout (or
  // an accidental double submit) replays server-side instead of recording the
  // contribution twice. Rotated only after a COMPLETED contribution — never
  // on dialog close, because the natural retry flow after an ambiguous
  // failure is close → reopen → Contribute again, and minting a fresh key
  // there would double-record the contribution.
  const idemKeyRef = useRef<{ fundraiserId: string; key: string } | null>(null);

  // The dialog stays mounted across opens/closes and campaign switches.
  // Track which campaign is currently open and which one the in-flight
  // mutation targeted, so a response landing after the user closed the dialog
  // (or opened a different campaign) can't paint its payment instructions
  // under the wrong title.
  const openFundraiserIdRef = useRef<string | null>(null);
  openFundraiserIdRef.current = fundraiser?.id ?? null;
  const mutationTargetIdRef = useRef<string | null>(null);

  // Reset the instructions panel when the dialog is reopened, so a previous
  // session's instructions never leak into a new one.
  const fundraiserId = fundraiser?.id ?? null;
  useEffect(() => {
    setInstructions(null);
  }, [fundraiserId]);

  // Curated AI judge models for the Advanced picker. Failure-tolerant: fall
  // back to the registry default so the dialog still works on an older API.
  const modelsQuery = useQuery({
    queryKey: ['bao-verification-models'],
    queryFn: fetchVerificationModels,
    enabled: !!fundraiser,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const models = modelsQuery.data ?? [];
  const selectedModel = models.find((m) => m.id === judgeModel);

  const mutation = useMutation({
    mutationFn: () => {
      if (!idemKeyRef.current || idemKeyRef.current.fundraiserId !== fundraiser!.id) {
        idemKeyRef.current = { fundraiserId: fundraiser!.id, key: crypto.randomUUID() };
      }
      mutationTargetIdRef.current = fundraiser!.id;
      return contributeToFundraiser(user!.signer, fundraiser!.id, {
        amount_sats: parseInt(amount, 10) || 0,
        rail,
        idempotencyKey: `2140:${fundraiser!.id}:${rail}:${parseInt(amount, 10) || 0}:${idemKeyRef.current.key}`,
        preferredModel: judgeModel || undefined,
      });
    },
    onSuccess: (data) => {
      // Server confirmed the contribution — rotate the key so the NEXT
      // intentional contribution isn't mistaken for a retry of this one.
      idemKeyRef.current = null;
      if (data.replayed) {
        // Replay responses omit payment_instructions — setting them would
        // blank the dialog back to the funding form after a success toast.
        toast({ title: 'Contribution already recorded (DEMO)' });
        onContributed();
        return;
      }
      // Only show the instructions while the dialog is still open on the
      // campaign this request was for.
      if (openFundraiserIdRef.current !== null && openFundraiserIdRef.current === mutationTargetIdRef.current) {
        setInstructions(data.payment_instructions as Record<string, unknown>);
      }
      toast({ title: 'Contribution recorded (DEMO)' });
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
            DEMO — the contribution is recorded by the API but no real payment is made.
            {fundraiser && ` ${formatSats(remaining)} sats to goal.`}
          </DialogDescription>
        </DialogHeader>

        {instructions ? (
          <div className="space-y-3">
            <div className="rounded-md border-2 border-amber-500/70 bg-amber-500/10 p-3 text-xs space-y-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400">⚠️ DO NOT PAY — demo payment instructions ({String(instructions.kind)})</p>
              <p className="text-muted-foreground">
                This is what the settlement rail WILL return once it leaves demo. Real sats sent to it now are lost.
              </p>
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
                    disabled={!isBaoRailLive(r)}
                    onClick={() => setRail(r)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      rail === r ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                      !isBaoRailLive(r) && 'opacity-40 cursor-not-allowed hover:text-muted-foreground',
                    )}
                  >
                    {BAO_RAIL_LABELS[r]}
                    {!isBaoRailLive(r) && <span className="block text-[9px]">soon</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Need demo sats? Claim 21,400 free sats per rail every 24h on{' '}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => openUrl(BAO_MARKETS_URL)}>
                  bao.markets
                </button>
                {' '}(Wallet → Claim) — signet coins, no real value.
              </p>
            </div>

            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3.5" /> Advanced
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1.5">
                <Label>Judge model (optional)</Label>
                <Select value={judgeModel} onValueChange={setJudgeModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {models.length === 0 ? (
                      <SelectItem value={DEFAULT_VERIFICATION_MODEL}>Recommended: Kimi K3</SelectItem>
                    ) : (
                      models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id === DEFAULT_VERIFICATION_MODEL ? `Recommended: ${m.name}` : `${m.name} (${m.provider})`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {selectedModel && `${selectedModel.tier} tier${selectedModel.vision ? ' · vision support' : ''} · `}
                  ~500–2,000 sats per verification. Preferences count for donations ≥ 1,000 sats.
                </p>
              </CollapsibleContent>
            </Collapsible>

            <Button
              className="w-full"
              disabled={!(parseInt(amount, 10) > 0) || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Contribute ${formatSats(parseInt(amount, 10) || 0)} sats (demo)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Re-export for the router's named-import lazy() pattern.
export default BaoFundingPage;
