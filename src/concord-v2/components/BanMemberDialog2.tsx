import { Ban, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BanPhase } from "@/concord-v2/hooks/useModeration2";
import { useAuthor } from "@/hooks/useAuthor";
import { useScopedDisplayName } from "@/hooks/useScopedDisplayName";

interface BanMemberDialogProps {
  /** The pubkey queued for banning; null keeps the dialog closed. */
  target: string | null;
  /** Whether this ban will also rotate the community keys (Private mode). */
  willRotate: boolean;
  onClose: () => void;
  /** Runs the full ban; reports each step as it starts. Throws on failure. */
  onConfirm: (target: string, onPhase: (phase: BanPhase) => void) => Promise<void>;
}

const PHASE_ORDER: Record<BanPhase, number> = { silence: 0, roles: 1, rekey: 2 };

/**
 * Ban confirmation + progress. The ban is several sequential publishes (banlist,
 * grant strip, and in a Private community a whole Refounding, which can take
 * seconds), so the dialog stays up and walks its step list until everything
 * lands — closing mid-flight would read as "banned" while the severance is
 * still in the air.
 */
export function BanMemberDialog({ target, willRotate, onClose, onConfirm }: BanMemberDialogProps) {
  const [phase, setPhase] = useState<BanPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Signer calls (a bunker blob-wrap) carry no timeout of their own; a dead
  // signer would otherwise wedge the dialog un-dismissable. After a grace
  // period, re-enable Cancel so the user is never trapped (the operation, if
  // it ever lands, is idempotent and self-heals via the read-cut retry).
  const [stuck, setStuck] = useState(false);
  const author = useAuthor(target ?? undefined);
  const name = useScopedDisplayName(target ?? undefined, author.data?.metadata);
  const busy = phase !== null;

  // A fresh target is a fresh flow.
  useEffect(() => {
    setPhase(null);
    setError(null);
    setStuck(false);
  }, [target]);

  // Grace timer: while busy, arm a fallback that lets the user bail out.
  useEffect(() => {
    if (!busy) {
      setStuck(false);
      return;
    }
    const t = setTimeout(() => setStuck(true), 30_000);
    return () => clearTimeout(t);
  }, [busy]);

  const steps: Array<{ key: BanPhase; label: string }> = [
    { key: "silence", label: "Blocking member" },
    { key: "roles", label: "Removing their roles" },
    ...(willRotate ? [{ key: "rekey" as BanPhase, label: "Rotating community keys" }] : []),
  ];

  const run = async () => {
    if (!target) return;
    setError(null);
    setPhase("silence");
    try {
      await onConfirm(target, setPhase);
      setPhase(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't ban this member.");
      setPhase(null);
    }
  };

  const close = () => {
    if (busy && !stuck) return;
    setPhase(null);
    setError(null);
    setStuck(false);
    onClose();
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ban {name || "member"}?</DialogTitle>
          <DialogDescription>
            They will be removed and silenced for everyone in this community.
          </DialogDescription>
        </DialogHeader>

        {busy && (
          <ul className="space-y-1.5 text-sm" aria-live="polite">
            {steps.map((step) => {
              const state =
                PHASE_ORDER[phase] > PHASE_ORDER[step.key]
                  ? "done"
                  : phase === step.key
                    ? "active"
                    : "pending";
              return (
                <li key={step.key} className="flex items-center gap-2">
                  {state === "done" ? (
                    <Check className="size-4 text-success" />
                  ) : state === "active" ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="size-4 rounded-full border border-muted-foreground/40" />
                  )}
                  <span className={state === "pending" ? "text-muted-foreground" : undefined}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {stuck && busy && (
          <p className="text-sm text-muted-foreground">
            This is taking longer than expected. Your signer may be slow or offline. You can close this
            and try again; anything already sent will finish on its own.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy && !stuck}>
            {busy && stuck ? "Close" : "Cancel"}
          </Button>
          <Button type="button" variant="destructive" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
            {busy ? "Banning" : "Ban member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
