import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  CheckCircle2,
  Users,
  KeyRound,
  Vote,
  FileSignature,
  ScrollText,
  Beaker,
} from "lucide-react";
import { cn } from "@/lib/utils";

import type { BaoCourtDispute } from "@/hooks/useBaoCourtDisputes";
import { useJurorSession } from "@/hooks/useJurorSession";
import type { SelectedJuror, AppealPhase } from "@bao/frost-court";
import { useToast } from "@/hooks/useToast";

interface JurorSessionModalProps {
  dispute: BaoCourtDispute;
  selectedJurors: SelectedJuror[];
  myJurorIdx: number;
  demoMode: boolean;
  demoPace?: 'guided' | 'fast';
  seed?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PHASES: { id: AppealPhase; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "selection", label: "Selected", icon: Users },
  { id: "dkg", label: "DKG", icon: KeyRound },
  { id: "vote-commit", label: "Vote", icon: Vote },
  { id: "vote-reveal", label: "Reveal", icon: ScrollText },
  { id: "signing", label: "Sign", icon: FileSignature },
  { id: "attestation_published", label: "Result", icon: CheckCircle2 },
];

function phaseIndex(phase: AppealPhase): number {
  return PHASES.findIndex((p) => p.id === phase);
}

function phaseDescription(phase: AppealPhase): string {
  switch (phase) {
    case 'selection':
      return 'The jury is selected and each juror locks fake sats. Next, jurors run a distributed key generation (DKG) ceremony to create a shared public key.';
    case 'dkg':
      return 'DKG complete. The group public key is derived from every juror\'s contribution. No single device knows the full secret.';
    case 'vote-commit':
      return 'Each juror commits to their vote by hashing it with a secret salt. Commitments are published before reveals so no one can change their vote later.';
    case 'vote-reveal':
      return 'Votes are revealed and tallied. The majority outcome wins. In this demo all jurors vote the same way so the result is unanimous.';
    case 'signing':
      return 'Jurors combine their FROST partial signatures to produce one valid attestation under the group public key.';
    case 'attestation_published':
      return 'The attestation is published. The dispute override is now signed by the threshold jury.';
    default:
      return '';
  }
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

export function JurorSessionModal({
  dispute,
  selectedJurors,
  myJurorIdx,
  demoMode,
  demoPace = 'guided',
  seed,
  open,
  onOpenChange,
}: JurorSessionModalProps) {
  const { state, actions, isPending } = useJurorSession({
    dispute,
    selectedJurors,
    myJurorIdx,
    demoMode,
    seed,
  });
  const { toast } = useToast();

  const [selectedOutcome, setSelectedOutcome] = useState<string>(dispute.proposedOutcome);

  useEffect(() => {
    setSelectedOutcome(dispute.proposedOutcome);
  }, [dispute.disputeId, dispute.proposedOutcome]);

  useEffect(() => {
    if (open) {
      actions.advancePhase("selection");
    }
  }, [open, actions]);

  const progress = useMemo(() => {
    const idx = phaseIndex(state.phase);
    return Math.max(5, ((idx + 1) / PHASES.length) * 100);
  }, [state.phase]);

  const currentPhaseIdx = phaseIndex(state.phase);

  const runAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      toast({
        title: "Session action failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Fast-mode auto-advance: run the full ceremony with short delays.
  const actionsRef = useRef(actions);
  const phaseRef = useRef(state.phase);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
      return;
    }
    if (!demoMode || demoPace !== 'fast') return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    const STEP_DELAY_MS = 900;
    const waitFor = (target: AppealPhase) =>
      new Promise<void>((resolve) => {
        if (phaseRef.current === target) {
          resolve();
          return;
        }
        const interval = setInterval(() => {
          if (phaseRef.current === target) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });

    const run = async () => {
      try {
        await actionsRef.current.publishDkgCommitment();
        await waitFor('dkg');
        actionsRef.current.advancePhase('vote-commit');
        await waitFor('vote-commit');
        await actionsRef.current.publishVoteCommit(dispute.proposedOutcome);
        await waitFor('vote-reveal');
        await actionsRef.current.publishVoteReveal();
        await waitFor('signing');
        await actionsRef.current.publishFrostCommitment();
        await actionsRef.current.publishFrostReveal();
        await actionsRef.current.aggregateAndPublishAttestation();
      } catch (error) {
        toast({
          title: 'Fast demo failed',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    };

    const timer = setTimeout(() => void run(), STEP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, demoMode, demoPace, dispute.proposedOutcome, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle className="leading-snug">Juror session</DialogTitle>
            {demoMode && (
              <Badge variant="outline" className="shrink-0 gap-1 text-amber-600 border-amber-600">
                <Beaker className="size-3" />
                Demo
              </Badge>
            )}
          </div>
          <DialogDescription className="sr-only">
            FROST juror session for dispute {dispute.disputeId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{PHASES[currentPhaseIdx]?.label}</span>
              <span className="text-muted-foreground">
                Step {currentPhaseIdx + 1} of {PHASES.length}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <Tabs value={state.phase} className="w-full">
            <TabsList className="grid grid-cols-3 sm:grid-cols-6 h-auto">
              {PHASES.map((p, i) => {
                const Icon = p.icon;
                const done = i < currentPhaseIdx;
                return (
                  <TabsTrigger
                    key={p.id}
                    value={p.id}
                    disabled
                    className={cn(
                      "flex flex-col items-center gap-1 py-2 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
                      done && "text-green-600",
                    )}
                  >
                    {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
                    <span className="hidden sm:inline">{p.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {demoMode && demoPace === 'guided' && (
            <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              {phaseDescription(state.phase)}
            </div>
          )}

          {state.phase === "selection" && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <span className="text-sm text-muted-foreground">Proposed outcome</span>
                    <p className="font-medium">{dispute.proposedOutcome}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Original outcome</span>
                    <p className="font-medium">{dispute.originalOutcome || "—"}</p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Selected jurors</h3>
                <div className="grid gap-2">
                  {selectedJurors.map((j) => (
                    <div
                      key={j.idx}
                      className={cn(
                        "flex items-center justify-between rounded-md border p-3",
                        j.idx === myJurorIdx && "border-primary bg-primary/5",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{truncatePubkey(j.nostrPubkey)}</span>
                        {j.idx === myJurorIdx && <Badge variant="outline">You</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">Juror #{j.idx}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => runAction(actions.publishDkgCommitment)}
                disabled={isPending}
              >
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Start DKG ceremony
              </Button>
            </div>
          )}

          {state.phase === "dkg" && (
            <div className="space-y-4 text-center">
              <KeyRound className="size-12 mx-auto text-primary" />
              <h3 className="text-lg font-semibold">DKG complete</h3>
              <p className="text-sm text-muted-foreground">
                Group public key derived and commitments published.
              </p>
              {state.groupPubkeyXOnly && (
                <div className="font-mono text-xs break-all rounded-md bg-muted p-3">
                  {state.groupPubkeyXOnly}
                </div>
              )}
              <Button className="w-full" onClick={() => actions.advancePhase("vote-commit")}>
                Proceed to vote
              </Button>
            </div>
          )}

          {state.phase === "vote-commit" && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Choose an outcome</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[dispute.proposedOutcome, dispute.originalOutcome]
                  .filter((o): o is string => !!o)
                  .map((outcome) => (
                    <Button
                      key={outcome}
                      variant={selectedOutcome === outcome ? "default" : "outline"}
                      onClick={() => setSelectedOutcome(outcome)}
                      className="h-auto py-3 justify-start"
                    >
                      {outcome}
                    </Button>
                  ))}
              </div>
              <Button
                className="w-full"
                onClick={() => runAction(() => actions.publishVoteCommit(selectedOutcome))}
                disabled={isPending}
              >
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Commit vote
              </Button>
            </div>
          )}

          {state.phase === "vote-reveal" && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-4 text-center">
                <p className="text-sm text-muted-foreground">Your committed outcome</p>
                <p className="text-lg font-semibold">{state.myVoteReveal?.outcome}</p>
              </div>
              {state.tally && (
                <div className="rounded-md border p-4">
                  <p className="text-sm text-muted-foreground">Tallied winner</p>
                  <p className="text-lg font-semibold">{state.tally.outcome}</p>
                  <p className="text-xs text-muted-foreground">
                    {state.tally.supportingVotes.length} supporting vote(s)
                  </p>
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => runAction(actions.publishFrostCommitment)}
                disabled={isPending}
              >
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Commit FROST signing nonce
              </Button>
            </div>
          )}

          {state.phase === "signing" && (
            <div className="space-y-4 text-center">
              <FileSignature className="size-12 mx-auto text-primary" />
              <h3 className="text-lg font-semibold">Signing round</h3>
              <p className="text-sm text-muted-foreground">
                Reveal your partial signature so the group can aggregate the attestation.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  className="flex-1"
                  onClick={() => runAction(actions.publishFrostReveal)}
                  disabled={isPending}
                >
                  {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Reveal signature
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => runAction(actions.aggregateAndPublishAttestation)}
                  disabled={isPending}
                >
                  Aggregate attestation
                </Button>
              </div>
            </div>
          )}

          {state.phase === "attestation_published" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="size-12 mx-auto text-green-600" />
              <h3 className="text-lg font-semibold">Attestation published</h3>
              {state.attestation && (
                <div className="text-left space-y-2 rounded-md border p-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Outcome:</span>{" "}
                    <span className="font-medium">{state.attestation.outcome}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Group pubkey:</span>{" "}
                    <span className="font-mono text-xs break-all">
                      {state.attestation.groupPubkey}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Signature:</span>{" "}
                    <span className="font-mono text-xs break-all">
                      {state.attestation.signature}
                    </span>
                  </div>
                </div>
              )}
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                Close session
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
