import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileCheck2, Flag, Loader2, Timer, Vote, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useAttestation } from '@/hooks/useAttestation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  ATTESTATION_QUORUM_PCT,
  canUserVote,
  castBallot,
  formatTimeLeft,
  openRound,
  quorumPct,
  resolutionKind,
  snapshotWeight,
  submitObjection,
  submitProof,
  tallyPct,
  timeLeft,
  voterBallot,
  type AttestationRound,
} from '@/lib/baoAttestation';
import { baoApiDate, fetchContributions, type BaoFundraiser, type BaoMilestone } from '@/lib/baoFundraising';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** Re-render tick for countdown labels (30s — windows run hours to days). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * v3 donor-attestation panel for one fundraiser milestone (DEMO).
 *
 * Layered resolution (spec docs/BAO_FUND_RESOLUTION.md): the owner posts
 * proof-of-work → donors get an objection window → a donor objection IS an
 * early NO vote that opens a sats-weighted attestation round of the donor
 * ring (quorum 50% of ring weight; YES at ≥½ of cast, ties resolve YES; NO at
 * ≥⅔ pays a 2% sabotage tax to the runner; no quorum → one extension →
 * refund). Settlement is lazy server-side — it resolves shortly after the
 * window closes, on the next fundraiser fetch.
 *
 * Non-donors always see the tally read-only: only ring donors vote.
 */
export function AttestationPanel({ fundraiser, milestone, isOwner }: {
  fundraiser: BaoFundraiser;
  milestone: BaoMilestone;
  isOwner: boolean;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const now = useNow();
  const [proofOpen, setProofOpen] = useState(false);
  const [objectOpen, setObjectOpen] = useState(false);

  const attQuery = useAttestation(fundraiser.id, milestone.id);
  const att = attQuery.data;

  // Donor check (client-side hint only — the backend enforces ring membership
  // from the frozen snapshot). Any recorded contributor counts as a donor here.
  const contributionsQuery = useQuery({
    queryKey: ['bao-contributions', fundraiser.id],
    queryFn: () => fetchContributions(fundraiser.id),
    enabled: !!user,
    staleTime: 30_000,
  });
  const isDonor = !!user && (contributionsQuery.data ?? []).some((c) => c.contributor_pubkey === user.pubkey);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bao-attestation', fundraiser.id, milestone.id] });
    queryClient.invalidateQueries({ queryKey: ['bao-fundraiser', fundraiser.id] });
  };

  const proofMutation = useMutation({
    mutationFn: (input: { deliverableUrl: string; notes: string }) =>
      submitProof(user!.signer, fundraiser.id, milestone.id, { marketId: milestone.market_id!, ...input }),
    onSuccess: () => {
      toast({ title: 'Proof submitted (DEMO)', description: 'The donor objection window is now open.' });
      setProofOpen(false);
      invalidate();
    },
    onError: (e) => toast({ title: 'Proof failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const objectMutation = useMutation({
    mutationFn: (input: { proofEventId: string | null; reason: string }) =>
      submitObjection(user!.signer, fundraiser.id, milestone.id, { marketId: milestone.market_id!, ...input }),
    onSuccess: () => {
      toast({ title: 'Objection recorded (DEMO)', description: 'An objection is an early NO vote — the donor attestation round is open.' });
      setObjectOpen(false);
      invalidate();
    },
    onError: (e) => toast({ title: 'Objection failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  const ballotMutation = useMutation({
    mutationFn: ({ round, vote }: { round: AttestationRound; vote: 'yes' | 'no' }) =>
      castBallot(user!.signer, round.id, {
        marketId: milestone.market_id!,
        roundNo: round.round_no,
        triggerEventId: round.trigger_event_id!,
        vote,
      }),
    onSuccess: (_d, vars) => {
      toast({ title: `Voted ${vars.vote.toUpperCase()} (DEMO)`, description: 'You can change your vote until the window closes.' });
      invalidate();
    },
    onError: (e) => toast({ title: 'Vote failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });

  // Older backends without the attestation surface 404 here — stay silent
  // rather than breaking the campaign card.
  if (attQuery.isError || !att) return null;

  const round = openRound(att);
  const resolved = resolutionKind(att);
  const windowClose = att.milestone.objection_window_close;
  const windowMsLeft = timeLeft(windowClose, now);
  const deadlinePassed = (() => {
    const d = baoApiDate(milestone.deadline_at);
    return !!d && d.getTime() <= now;
  })();

  // Don't hang an empty "Donor attestation" box on every milestone — render
  // only when there's attestation activity or an action this user can take.
  const canSubmitProof = isOwner && milestone.status === 'unlocked' && !!milestone.market_id && !att.milestone.proof_event_id;
  const canTimeoutObject = deadlinePassed && !isOwner && isDonor && !!milestone.market_id && !att.milestone.proof_event_id;
  const hasActivity = !!resolved || !!round || !!att.milestone.proof_event_id;
  if (!hasActivity && !canSubmitProof && !canTimeoutObject) return null;

  return (
    <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Vote className="size-3.5 text-amber-600 dark:text-amber-400" />
          Donor attestation
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 text-amber-600 border-amber-500/50 dark:text-amber-400">DEMO</Badge>
      </div>

      {/* ── Resolved ── */}
      {resolved === 'yes' && (
        <p className="text-xs flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <CheckCircle2 className="size-3.5 shrink-0" /> Delivered — donor attestation
        </p>
      )}
      {resolved === 'no' && (
        <div className="text-xs flex items-center gap-1.5 text-destructive">
          <XCircle className="size-3.5 shrink-0" />
          <span>
            Rejected — refund recorded
            {(att.rounds.at(-1)?.sabotage_tax_sats ?? 0) > 0 && ' (2% to runner)'}
          </span>
        </div>
      )}
      {resolved === 'default' && (
        <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0" /> Resolved by default (no objection)
        </p>
      )}

      {/* ── Live attestation round ── */}
      {!resolved && round && (
        <RoundView
          round={round}
          now={now}
          userPubkey={user?.pubkey}
          votePending={ballotMutation.isPending}
          onVote={(vote) => ballotMutation.mutate({ round, vote })}
        />
      )}

      {/* ── Proof submitted, objection window running ── */}
      {!resolved && !round && att.milestone.proof_event_id && windowClose && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Timer className="size-3.5 shrink-0" />
            {windowMsLeft > 0 ? (
              <>Proof submitted — objection window closes in <span className="font-medium text-foreground">{formatTimeLeft(windowMsLeft)}</span>. No objection resolves YES.</>
            ) : (
              <>Objection window closed — resolves shortly after the window closes.</>
            )}
          </p>
          {windowMsLeft > 0 && isDonor && !isOwner && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setObjectOpen(true)}>
                <Flag className="size-3" /> Object
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── No proof yet ── */}
      {!resolved && !round && !att.milestone.proof_event_id && (canSubmitProof || canTimeoutObject) && (
        <div className="space-y-1.5">
          {canSubmitProof && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Delivered? Submit proof to open donor review.</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => setProofOpen(true)}>
                <FileCheck2 className="size-3" /> Submit proof
              </Button>
            </div>
          )}
          {canTimeoutObject && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Deadline passed with no proof submitted.</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => setObjectOpen(true)}>
                <Flag className="size-3" /> Object
              </Button>
            </div>
          )}
        </div>
      )}

      <ProofDialog
        open={proofOpen}
        onOpenChange={setProofOpen}
        milestone={milestone}
        pending={proofMutation.isPending}
        onSubmit={(deliverableUrl, notes) => proofMutation.mutate({ deliverableUrl, notes })}
      />
      <ObjectionDialog
        open={objectOpen}
        onOpenChange={setObjectOpen}
        milestone={milestone}
        proofEventId={att.milestone.proof_event_id}
        pending={objectMutation.isPending}
        onSubmit={(reason) => objectMutation.mutate({ proofEventId: att.milestone.proof_event_id, reason })}
      />
    </div>
  );
}

// ── Live round view ──────────────────────────────────────────────────────────

function RoundView({ round, now, userPubkey, votePending, onVote }: {
  round: AttestationRound;
  now: number;
  userPubkey: string | undefined;
  votePending: boolean;
  onVote: (vote: 'yes' | 'no') => void;
}) {
  const { yes, no } = tallyPct(round.tally.yes_sats, round.tally.no_sats);
  const quorum = quorumPct(round.tally.cast_sats, round.tally.ring_total_sats);
  const msLeft = timeLeft(round.window_close, now);
  // Ballots must e-tag the round's trigger event — without one there is
  // nothing valid to vote on, so fall back to the read-only tally.
  const eligible = !!round.trigger_event_id && canUserVote(round.snapshot, userPubkey);
  const weight = snapshotWeight(round.snapshot, userPubkey ?? '');
  const mine = voterBallot(round, userPubkey);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Round {round.round_no} — donor vote{round.extended ? ' (extended)' : ''}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Timer className="size-3" />
          {msLeft > 0 ? (
            <>closes in <span className="font-medium text-foreground">{formatTimeLeft(msLeft)}</span></>
          ) : (
            'window closed'
          )}
        </span>
      </div>

      {/* Tally bar */}
      <div className="space-y-1">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="bg-green-500 transition-all" style={{ width: `${yes}%` }} />
          <div className="bg-destructive/70 transition-all" style={{ width: `${no}%` }} />
        </div>
        <div className="flex justify-between text-[11px] tabular-nums">
          <span className="text-green-600 dark:text-green-400">YES {formatSats(round.tally.yes_sats)} sats</span>
          <span className="text-destructive">NO {formatSats(round.tally.no_sats)} sats</span>
        </div>
      </div>

      {/* Quorum meter */}
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>
            Quorum: {formatSats(round.tally.cast_sats)} / {formatSats(round.tally.ring_total_sats)} sats voted
          </span>
          <span className={round.tally.quorum_reached ? 'text-green-600 dark:text-green-400' : undefined}>
            {Math.round(quorum)}% {round.tally.quorum_reached ? `— quorum reached` : `(needs ${ATTESTATION_QUORUM_PCT}%)`}
          </span>
        </div>
        <Progress value={Math.min(100, quorum)} className="h-1.5" />
      </div>

      {msLeft > 0 ? (
        eligible ? (
          <div className="space-y-1">
            <div className="flex items-center justify-end gap-1.5">
              {mine && (
                <span className="text-[11px] text-muted-foreground mr-auto">
                  Your vote: <span className="font-medium text-foreground">{mine.vote.toUpperCase()}</span>
                  {weight !== null && weight > 0 && ` (${formatSats(weight)} sats weight)`} — latest ballot counts
                </span>
              )}
              <Button
                size="sm"
                variant={mine?.vote === 'yes' ? 'default' : 'outline'}
                className="h-7 text-xs"
                disabled={votePending}
                onClick={() => onVote('yes')}
              >
                {votePending ? <Loader2 className="size-3 animate-spin" /> : 'Attest YES'}
              </Button>
              <Button
                size="sm"
                variant={mine?.vote === 'no' ? 'destructive' : 'outline'}
                className="h-7 text-xs"
                disabled={votePending}
                onClick={() => onVote('no')}
              >
                Attest NO
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Only donors to this milestone vote — your read-only view shows the live tally. Weight = sats donated, frozen at the objection.
          </p>
        )
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Voting closed — the milestone resolves shortly after the window closes.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Majority of cast sats decides (ties resolve YES); NO at over half refunds the milestone, and NO at ≥⅔ also routes a 2% sabotage tax to the runner. Below {ATTESTATION_QUORUM_PCT}% quorum the window extends once, then refunds.
      </p>
    </div>
  );
}

// ── Submit-proof dialog ──────────────────────────────────────────────────────

function ProofDialog({ open, onOpenChange, milestone, pending, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestone: BaoMilestone;
  pending: boolean;
  onSubmit: (deliverableUrl: string, notes: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit proof — {milestone.title}</DialogTitle>
          <DialogDescription>
            DEMO — publishes a signed proof-of-work event and opens the donor objection window. No objection resolves YES.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proof-url">Deliverable URL</Label>
            <Input
              id="proof-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… (repo, build, post, invoice)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proof-notes">Notes for donors</Label>
            <Textarea
              id="proof-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What shipped, how to verify it against the milestone criteria…"
              rows={4}
            />
          </div>
          <Button className="w-full" disabled={pending || (!url.trim() && !notes.trim())} onClick={() => onSubmit(url, notes)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : 'Submit proof (demo)'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Objection dialog ─────────────────────────────────────────────────────────

function ObjectionDialog({ open, onOpenChange, milestone, proofEventId, pending, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestone: BaoMilestone;
  proofEventId: string | null;
  pending: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Object — {milestone.title}</DialogTitle>
          <DialogDescription>
            DEMO — an objection IS an early NO vote from you as a donor. It opens a sats-weighted attestation round of the whole donor ring.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!proofEventId && (
            <p className="text-xs rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
              No proof was submitted before the deadline — this is a timeout objection.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="objection-reason">Reason (optional)</Label>
            <Textarea
              id="objection-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why doesn't the delivery meet the milestone criteria?"
              rows={3}
            />
          </div>
          <Button className="w-full" variant="destructive" disabled={pending} onClick={() => onSubmit(reason)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : 'Object and vote NO (demo)'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
