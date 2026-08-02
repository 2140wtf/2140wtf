import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { openUrl } from '@/lib/downloadFile';
import {
  BAO_RAILS,
  BAO_RAIL_LABELS,
  isBaoRailLive,
  createFundraiserRelayFirst,
  fetchFundraiserQuota,
  type BaoFundraiserFormat,
  type BaoRail,
  type CreateFundraiserInput,
} from '@/lib/baoFundraising';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** Runner fee tiers from the ₿AO Fund spec: 2.14% (min) / 4.21% / 10%. */
const FEE_OPTIONS = [
  { value: '214', label: '2.14%' },
  { value: '421', label: '4.21%' },
  { value: '1000', label: '10%' },
] as const;

const DAY = 86_400;

/** Milestone delivery window bounds, per the ₿AO Fund spec. */
const DEADLINE_DAYS_MIN = 7;
const DEADLINE_DAYS_MAX = 50;

interface MilestoneDraft {
  title: string;
  description: string;
  amount: string;
  criteria: string;
  /** Days from now (7–50 per the fund spec). */
  deadlineDays: string;
  feeBps: string;
}

/** Every milestone is a public market — the API rejects thin descriptions. */
const MILESTONE_DESCRIPTION_MIN = 50;
/** Project description must give a collaborator enough context to scope the work. */
const PROJECT_DESCRIPTION_MIN = 120;
/** Delivery criteria becomes the market question — it must be unambiguous. */
const CRITERIA_MIN = 20;

/**
 * The bao.markets API has no repo field yet, so the repository URL is stored
 * as a machine-readable first line of the description: `Repository: <url>`.
 * Agents resolving milestone work MUST find the code there.
 */
const REPO_LINE_PREFIX = 'Repository: ';
const WORK_TYPE_LINE_PREFIX = 'Work-Type: ';

/** Accept https git hosting links — GitHub, GitLab, or ngit (git over Nostr). */
function isValidRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.') && url.pathname.length > 1;
  } catch {
    return false;
  }
}

const emptyMilestone = (): MilestoneDraft => ({
  title: '',
  description: '',
  amount: '',
  criteria: '',
  deadlineDays: '21',
  feeBps: '214',
});

export function CreateCampaignDialog({ open, onOpenChange, onCreated, initialTitle, initialRepo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  /** Optional prefill for the title field (e.g. deep link from a pet's upkeep card). */
  initialTitle?: string;
  /** Optional prefill for the repo URL field (deep link ?repo=). */
  initialRepo?: string;
}) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const [title, setTitle] = useState(initialTitle ?? '');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [workType, setWorkType] = useState<'software' | 'general'>('software');
  const [runnerType, setRunnerType] = useState<'agent' | 'human' | 'agent_human'>('agent_human');
  const [rail, setRail] = useState<BaoRail>('lightning');
  const [subcategory, setSubcategory] = useState('');
  const [format, setFormat] = useState<BaoFundraiserFormat>('milestones');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([emptyMilestone()]);
  const [streamDays, setStreamDays] = useState('30');

  // Anti-spam quota pre-check (2/hour, 5/day per key): ask the API before the
  // user publishes a create intent the bridge would silently drop. null =
  // endpoint not deployed yet → proceed (the server still enforces).
  const { data: quota } = useQuery({
    queryKey: ['bao-fundraiser-quota', user?.pubkey],
    queryFn: () => fetchFundraiserQuota(user!.pubkey),
    enabled: open && !!user,
    staleTime: 30_000,
  });
  const quotaBlocked = quota?.allowed === false;
  const quotaRetryMin = quota ? Math.max(1, Math.ceil(quota.retry_after_sec / 60)) : 0;

  // Deep-link prefill: the dialog stays mounted, so initialTitle must be
  // re-applied whenever it changes (the useState initializer only runs at
  // first mount — a /bao-fund?create=1&title=X navigation while already on
  // the page used to open the dialog with a blank/stale title).
  useEffect(() => {
    if (open && initialTitle) setTitle(initialTitle);
    if (open && initialRepo) setRepoUrl(initialRepo);
  }, [open, initialTitle, initialRepo]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setRepoUrl('');
    setWorkType('software');
    setMilestones([emptyMilestone()]);
    // Also reset the options — leaving rail/subcategory/format behind silently
    // creates the next campaign with the previous one's stream format or rail.
    setRail('lightning');
    setSubcategory('');
    setFormat('milestones');
    setStreamDays('30');
  };

  // In stream format the visible "Goal (sats)" field edits milestones[0] only,
  // so the goal sent to the API must be milestones[0] too — summing all
  // milestone drafts would create the campaign with a goal the owner never saw
  // (e.g. drafts left over from milestone-markets mode before switching).
  const goal = useMemo(
    () => format === 'stream'
      ? parseInt(milestones[0]?.amount ?? '', 10) || 0
      : milestones.reduce((s, m) => s + (parseInt(m.amount, 10) || 0), 0),
    [format, milestones],
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error('Log in before creating a campaign');
      const now = Math.floor(Date.now() / 1000);
      const repositoryLine = repoUrl.trim() ? `\n${REPO_LINE_PREFIX}${repoUrl.trim()}` : '';
      const fullDescription = `${WORK_TYPE_LINE_PREFIX}${workType}${repositoryLine}\n\n${description.trim()}`;
      const input: CreateFundraiserInput = format === 'stream'
        ? {
          title: title.trim(),
          description: fullDescription,
          runner_type: runnerType,
          goal_sats: goal,
          settlement_rail: rail,
          format: 'stream',
          category: 'bao-fund',
          subcategory: subcategory.trim() || null,
          stream_start_at: now,
          stream_end_at: now + (parseInt(streamDays, 10) || 30) * DAY,
        }
        : {
          title: title.trim(),
          description: fullDescription,
          runner_type: runnerType,
          goal_sats: goal,
          settlement_rail: rail,
          format: 'milestones',
          category: 'bao-fund',
          subcategory: subcategory.trim() || null,
          milestones: milestones.map((m) => ({
            title: m.title.trim(),
            description: m.description.trim(),
            amount_sats: parseInt(m.amount, 10) || 0,
            criteria: m.criteria.trim() || undefined,
            deadline_at: m.deadlineDays ? now + (parseInt(m.deadlineDays, 10) || 21) * DAY : undefined,
            fee_bps: parseInt(m.feeBps, 10),
          })),
        };
      // Relay-first: the intent rides Nostr to the ₿AO relay and the
      // bao.markets bridge creates the campaign from it; REST is the fallback.
      return createFundraiserRelayFirst(user!.signer, input, { publish: publishEvent });
    },
    onSuccess: ({ result, via }) => {
      const marketCount = result.markets?.length ?? 0;
      const marketsLine = marketCount > 0 ? `${marketCount} prediction market${marketCount === 1 ? '' : 's'} live on bao.markets.` : undefined;
      toast({
        title: 'Campaign created (DEMO)',
        description: via === 'relay'
          ? `Published as a Nostr intent and ingested by bao.markets. ${marketsLine ?? ''}`.trim()
          : marketsLine,
      });
      onOpenChange(false);
      resetForm();
      onCreated(result.fundraiser.id);
    },
    onError: (e) => toast({ title: 'Create failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const valid = !!user &&
    title.trim().length > 0 &&
    (workType === 'general' || isValidRepoUrl(repoUrl.trim())) &&
    description.trim().length >= PROJECT_DESCRIPTION_MIN &&
    goal >= 1000 &&
    (format !== 'stream' || (parseInt(streamDays, 10) || 0) >= 1) &&
    (format === 'stream' || milestones.every((m) =>
      m.title.trim() &&
      m.description.trim().length >= MILESTONE_DESCRIPTION_MIN &&
      m.criteria.trim().length >= CRITERIA_MIN &&
      (parseInt(m.amount, 10) || 0) > 0 &&
      (parseInt(m.deadlineDays, 10) || 0) >= DEADLINE_DAYS_MIN &&
      (parseInt(m.deadlineDays, 10) || 0) <= DEADLINE_DAYS_MAX));

  /**
   * Human-readable list of everything still blocking creation. The Create
   * button is disabled until this is empty — without showing the reasons the
   * disabled state reads as "blocked from posting" with no way to know why.
   */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!title.trim()) out.push('Add a project title');
    if (workType === 'software' && !isValidRepoUrl(repoUrl.trim())) out.push('Add the repository URL (https://…)');
    if (description.trim().length < PROJECT_DESCRIPTION_MIN) {
      out.push(`Description needs ${PROJECT_DESCRIPTION_MIN}+ characters (now ${description.trim().length})`);
    }
    if (goal < 1000) out.push('Goal must be at least 1,000 sats');
    if (format === 'stream') {
      if ((parseInt(streamDays, 10) || 0) < 1) out.push('Vesting window must be ≥ 1 day');
    } else {
      milestones.forEach((m, i) => {
        if (!m.title.trim()) out.push(`Milestone ${i + 1}: add a title`);
        if (m.description.trim().length < MILESTONE_DESCRIPTION_MIN) {
          out.push(`Milestone ${i + 1}: description needs ${MILESTONE_DESCRIPTION_MIN}+ characters`);
        }
        if (m.criteria.trim().length < CRITERIA_MIN) {
          out.push(`Milestone ${i + 1}: delivery criteria need ${CRITERIA_MIN}+ characters`);
        }
        if ((parseInt(m.amount, 10) || 0) <= 0) out.push(`Milestone ${i + 1}: add an amount`);
        const days = parseInt(m.deadlineDays, 10) || 0;
        if (days < DEADLINE_DAYS_MIN || days > DEADLINE_DAYS_MAX) {
          out.push(`Milestone ${i + 1}: deadline must be ${DEADLINE_DAYS_MIN}–${DEADLINE_DAYS_MAX} days`);
        }
      });
    }
    return out;
  }, [title, repoUrl, workType, description, goal, format, milestones, streamDays]);

  const patchMilestone = (i: number, patch: Partial<MilestoneDraft>) =>
    setMilestones((ms) => ms.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Block closing while creation is in flight: the relay-first poll can run
  // up to 30s, and a dismissible dialog invites a second submit (a duplicate
  // campaign) when the user thinks the first one didn't go through.
  const guardedOpenChange = (o: boolean) => {
    if (!mutation.isPending) onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={guardedOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New fundraising campaign</DialogTitle>
          <DialogDescription>
            Every milestone becomes a YES/NO prediction market on bao.markets — the market's resolution gates the payout.
          </DialogDescription>
        </DialogHeader>

        {/* Unmissable demo warning: the Cashu mint is real software, but it
            issues ₿AO testnet (signet) sats — nothing here touches mainnet. */}
        <div className="rounded-lg border-2 border-amber-500/60 bg-card px-4 py-3 space-y-1.5">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            DEMO — ₿AO testnet, not Bitcoin mainnet
          </p>
          <p className="text-xs leading-relaxed text-foreground">
            Cashu here runs on a real mint, but that mint issues <span className="font-semibold">₿AO testnet (signet) sats</span> — not Bitcoin mainnet.
            Cashu from mainnet must not be used here — claim <span className="font-semibold">free test sats</span> from the{' '}
            <button type="button" onClick={() => openUrl('https://bao.markets')} className="font-semibold underline cursor-pointer">₿AO faucet at bao.markets</button>{' '}
            instead. Resolution is crowd-voted and gameable, so treat every outcome as a drill.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            ₿AO Markets moves to mainnet on real Bitcoin rails soon — the demo stays as the practice ground.
          </p>
        </div>

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
              <ToggleGroupItem value="stream" className="text-xs">Single shot</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-title">Project title</Label>
            <Input id="fr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Oracle dashboard agent" />
          </div>

          <div className="space-y-1.5">
            <Label>Project type</Label>
            <Select value={workType} onValueChange={(value) => setWorkType(value as typeof workType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="software">Software / open source</SelectItem><SelectItem value="general">General / art / research / community</SelectItem></SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">General projects use their milestone evidence plan instead of requiring a code repository.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-repo">Repository {workType === 'software' ? '(required)' : '(optional)'}</Label>
            <Input
              id="fr-repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder={workType === 'software' ? "https://github.com/you/project — GitHub, GitLab or ngit" : "Optional supporting repository or evidence site"}
              inputMode="url"
            />
            <p className="text-[11px] text-muted-foreground">
              {workType === 'software' ? 'Where the code lives. Use an immutable commit in milestone evidence.' : 'Optional for non-code work; describe the evidence and review method in each milestone.'}
            </p>
            {repoUrl.trim().length > 0 && !isValidRepoUrl(repoUrl.trim()) && (
              <p className="text-[11px] text-amber-500">Enter a full https:// link to the repo.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-desc">Description</Label>
            <Textarea
              id="fr-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={`What will the funds create, who runs it, and why now? Write for agents and humans (min ${PROJECT_DESCRIPTION_MIN} chars).`}
            />
            {description.trim().length > 0 && description.trim().length < PROJECT_DESCRIPTION_MIN && (
              <p className="text-[11px] text-amber-500">
                {PROJECT_DESCRIPTION_MIN - description.trim().length} more characters needed — an agent must be able to scope the work from this alone.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <p className="text-xs text-muted-foreground">
                Only the rails with live settlement are selectable for now.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              {/* Fixed server-side to 'bao-fund' — discovery happens via the
                  free-form subcategory/tags field below. */}
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                Bao fund
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rail</Label>
              <Select value={rail} onValueChange={(v) => setRail(v as BaoRail)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BAO_RAILS.map((r) => (
                    <SelectItem key={r} value={r} disabled={!isBaoRailLive(r)}>
                      {BAO_RAIL_LABELS[r]}{isBaoRailLive(r) ? '' : ' (soon)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fr-subcategory">Subcategory / tags</Label>
            <Input
              id="fr-subcategory"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value.slice(0, 128))}
              placeholder="e.g. mining, app doing xyz — helps others find this project"
              maxLength={128}
            />
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
                  <Textarea
                    value={m.description}
                    onChange={(e) => patchMilestone(i, { description: e.target.value })}
                    placeholder="What will be delivered, and how can funders verify it? (min 50 chars)"
                    rows={2}
                    className="text-xs"
                  />
                  {m.description.trim().length > 0 && m.description.trim().length < MILESTONE_DESCRIPTION_MIN && (
                    <p className="text-[11px] text-amber-500">
                      {MILESTONE_DESCRIPTION_MIN - m.description.trim().length} more characters needed — funders read this before betting.
                    </p>
                  )}
                  <Input
                    value={m.criteria}
                    onChange={(e) => patchMilestone(i, { criteria: e.target.value })}
                    placeholder="Delivery criteria — becomes the market question"
                    className="text-xs"
                  />
                  {m.criteria.trim().length > 0 && m.criteria.trim().length < CRITERIA_MIN && (
                    <p className="text-[11px] text-amber-500">
                      {CRITERIA_MIN - m.criteria.trim().length} more characters needed — the criteria becomes the public market question.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      value={m.deadlineDays}
                      onChange={(e) => patchMilestone(i, { deadlineDays: e.target.value.replace(/[^0-9]/g, '') })}
                      inputMode="numeric"
                      className="w-20 text-right text-xs"
                    />
                    <span className="text-xs text-muted-foreground">days to deliver (7–50)</span>
                    <div className="flex-1" />
                    {/* Runner fee in sats next to the selector — a bare % badge
                        hides what the fee actually costs on this milestone. */}
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      ≈{formatSats(Math.round(((parseInt(m.amount, 10) || 0) * (parseInt(m.feeBps, 10) || 0)) / 10_000))} sats
                    </span>
                    <Select value={m.feeBps} onValueChange={(v) => patchMilestone(i, { feeBps: v })}>
                      <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FEE_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label} runner fee</SelectItem>)}
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

          {quotaBlocked && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 space-y-0.5">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Anti-spam limit reached</p>
              <p className="text-[11px] text-amber-950 dark:text-amber-200">
                Campaign creation is limited to {quota?.limit_hour}/hour and {quota?.limit_day}/day per key
                {quota ? ` (you: ${quota.used_hour} this hour, ${quota.used_day} today)` : ''}.
                Try again in ~{quotaRetryMin} minute{quotaRetryMin === 1 ? '' : 's'} — nothing was published.
              </p>
            </div>
          )}

          {missing.length > 0 && !quotaBlocked && (title.trim().length > 0 || description.trim().length > 0) && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 space-y-1">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Before you can create:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-950 dark:text-amber-200">
                {missing.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
                {missing.length > 5 && <li>…and {missing.length - 5} more</li>}
              </ul>
            </div>
          )}

          <Button className="w-full" disabled={!valid || quotaBlocked || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : `Create raise — ${formatSats(goal)} sats goal`}
          </Button>

          {mutation.isPending && (
            <p className="text-[11px] text-center text-muted-foreground" role="status">
              Publishing to the ₿AO relay — this can take up to 30 seconds. Please keep this dialog open.
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Free to create — no balance, no fee.</span>{' '}
            Spam control is a per-key rate limit (2 campaigns/hour, 5/day), not sats.
            The campaign publishes straight to the ₿AO relay, where bao.markets picks it up
            (usually under 30 seconds — if the bridge is offline it goes directly to the API instead).
            {format === 'stream'
              ? ' A single-shot campaign has no markets; funds vest linearly over the window.'
              : ' Every milestone spawns a YES/NO prediction market on bao.markets with demo liquidity seeded by the fund.'}
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Each AI verification costs ~500–2,000 sats depending on the judge model, deducted from the milestone payout
            (separate from the runner fee selected per milestone).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
