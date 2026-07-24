import { useNostr } from "@nostrify/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrPublish } from "@/hooks/useNostrPublish";
import { cn } from "@/lib/utils";

import type { NostrEvent } from "@nostrify/nostrify";

/** NIP-88 poll vote kind. */
const KIND_POLL_VOTE = 1018;

interface PollOption {
  id: string;
  label: string;
}

/** Parse a kind 1068 poll event into its options and settings. */
function parsePoll(event: NostrEvent) {
  const options: PollOption[] = [];
  let pollType: "singlechoice" | "multiplechoice" = "singlechoice";
  let endsAt: number | undefined;

  for (const tag of event.tags) {
    if (tag[0] === "option" && tag[1] && tag[2]) {
      options.push({ id: tag[1], label: tag[2] });
    } else if (tag[0] === "polltype" && tag[1] === "multiplechoice") {
      pollType = "multiplechoice";
    } else if (tag[0] === "endsAt" && tag[1]) {
      const parsed = Number.parseInt(tag[1], 10);
      if (Number.isFinite(parsed)) endsAt = parsed;
    }
  }

  return { options, pollType, endsAt };
}

interface PollCardProps {
  /** The kind 1068 poll event. */
  event: NostrEvent;
  /** The group's host relay (votes are published and queried there). */
  relayUrl: string;
  /** The NIP-29 group id, added as an `h` tag on votes. */
  groupId: string;
  /** Whether the current user may vote (group membership). */
  canVote: boolean;
}

/** Renders a NIP-88 poll (kind 1068) with live tallies and voting. */
export function PollCard({ event, relayUrl, groupId, canVote }: PollCardProps) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { options, pollType, endsAt } = useMemo(() => parsePoll(event), [event]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isEnded = endsAt !== undefined && endsAt < Math.floor(Date.now() / 1000);

  const votesQuery = useQuery({
    queryKey: ["poll-votes", relayUrl, event.id],
    queryFn: async ({ signal }) => {
      return await nostr.relay(relayUrl).query(
        [{ kinds: [KIND_POLL_VOTE], "#e": [event.id], limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Latest vote per pubkey wins; votes after endsAt are ignored.
  const { counts, totalVoters, myVote } = useMemo(() => {
    const latest = new Map<string, NostrEvent>();
    for (const vote of votesQuery.data ?? []) {
      if (endsAt !== undefined && vote.created_at > endsAt) continue;
      const existing = latest.get(vote.pubkey);
      if (!existing || vote.created_at > existing.created_at) {
        latest.set(vote.pubkey, vote);
      }
    }

    const counts = new Map<string, number>();
    const validIds = new Set(options.map((o) => o.id));
    for (const vote of latest.values()) {
      const responses = new Set(
        vote.tags.filter(([n, v]) => n === "response" && v && validIds.has(v)).map(([, v]) => v),
      );
      for (const optionId of responses) {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
      }
    }

    const mine = user ? latest.get(user.pubkey) : undefined;
    const myVote = mine
      ? new Set(mine.tags.filter(([n, v]) => n === "response" && v).map(([, v]) => v))
      : undefined;

    return { counts, totalVoters: latest.size, myVote };
  }, [votesQuery.data, options, endsAt, user]);

  const hasVoted = !!myVote && myVote.size > 0;
  const showResults = hasVoted || isEnded || !canVote;

  const vote = useMutation({
    mutationFn: async (optionIds: string[]) => {
      await createEvent({
        kind: KIND_POLL_VOTE,
        content: "",
        tags: [
          ["e", event.id],
          ["h", groupId],
          ...optionIds.map((id) => ["response", id]),
        ],
        relay: relayUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["poll-votes", relayUrl, event.id] });
      setSelected(new Set());
    },
  });

  const toggleSelect = (optionId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pollType === "singlechoice") {
        next.clear();
        next.add(optionId);
      } else if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  };

  return (
    <div className="max-w-md rounded-xl border border-border bg-secondary/20 px-3 py-2.5 my-1.5 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BarChart3 className="size-3.5" />
        <span>Poll{pollType === "multiplechoice" ? " · multiple choice" : ""}</span>
        {endsAt !== undefined && (
          <span className="ml-auto">{isEnded ? "Ended" : `Ends ${formatEndsAt(endsAt)}`}</span>
        )}
      </div>

      <div className="space-y-1.5">
        {options.map((option) => {
          const count = counts.get(option.id) ?? 0;
          const pct = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
          const isMine = myVote?.has(option.id);
          const isSelected = selected.has(option.id);

          if (showResults) {
            return (
              <div key={option.id} className="relative rounded-lg overflow-hidden border border-border/60">
                <div
                  className={cn("absolute inset-y-0 left-0", isMine ? "bg-primary/25" : "bg-secondary/80")}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="truncate flex-1">{option.label}</span>
                  {isMine && <Check className="size-3.5 text-primary shrink-0" />}
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">{pct}%</span>
                </div>
              </div>
            );
          }

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleSelect(option.id)}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 hover:border-foreground/30 hover:bg-secondary/40",
              )}
            >
              <span
                className={cn(
                  "size-3.5 shrink-0 border flex items-center justify-center",
                  pollType === "singlechoice" ? "rounded-full" : "rounded-sm",
                  isSelected ? "border-primary bg-primary" : "border-muted-foreground/50",
                )}
              >
                {isSelected && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {totalVoters} {totalVoters === 1 ? "vote" : "votes"}
        </span>
        {!showResults && (
          <Button
            size="sm"
            className="h-7 rounded-full px-4 text-xs"
            disabled={selected.size === 0 || vote.isPending || !user}
            onClick={() => vote.mutate([...selected])}
          >
            {vote.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Vote"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Format an endsAt timestamp as a short relative string. */
function formatEndsAt(endsAt: number): string {
  const diff = endsAt - Math.floor(Date.now() / 1000);
  if (diff < 3600) return `in ${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}
