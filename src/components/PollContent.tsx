import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CheckCircle2, Clock, X, ChevronRight, Zap } from 'lucide-react';
import { ZapDialog } from '@/components/ZapDialog';
import { getZapAmountSats, getZapSenderPubkey } from '@/lib/zapHelpers';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { usePollVotes } from '@/hooks/usePollVotes';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAuthor } from '@/hooks/useAuthor';
import { useAuthors } from '@/hooks/useAuthors';
import { NoteContent } from '@/components/NoteContent';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmojifiedText } from '@/components/CustomEmoji';
import { VerifiedNip05Text } from '@/components/Nip05Badge';
import { getAvatarShape } from '@/lib/avatarShape';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';
import type { NostrEvent } from '@nostrify/nostrify';

interface PollOption {
  id: string;
  label: string;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

function getOptions(tags: string[][]): PollOption[] {
  return tags
    .filter(([n]) => n === 'option')
    .map(([, id, label]) => ({ id, label }));
}

/** Deduplicate votes: keep one per pubkey (latest wins). */
function dedupeVotes(events: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>();
  for (const ev of events) {
    const existing = map.get(ev.pubkey);
    if (!existing || ev.created_at > existing.created_at) {
      map.set(ev.pubkey, ev);
    }
  }
  return Array.from(map.values());
}

/** Count votes per option ID from deduplicated vote events. */
function tallyVotes(
  votes: NostrEvent[],
  pollType: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    const responseTags = vote.tags.filter(([n]) => n === 'response');
    if (pollType === 'singlechoice') {
      // Only first response counts
      const optionId = responseTags[0]?.[1];
      if (optionId) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    } else {
      // Multiplechoice: first response per option ID
      const seen = new Set<string>();
      for (const [, optionId] of responseTags) {
        if (optionId && !seen.has(optionId)) {
          seen.add(optionId);
          counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/** Get voter events for a specific option ID. */
function getVotersForOption(
  votes: NostrEvent[],
  optionId: string,
  pollType: string,
): NostrEvent[] {
  return votes.filter((vote) => {
    const responseTags = vote.tags.filter(([n]) => n === 'response');
    if (pollType === 'singlechoice') {
      return responseTags[0]?.[1] === optionId;
    } else {
      return responseTags.some(([, id]) => id === optionId);
    }
  });
}

/** Clickable avatar stack + "N votes" label. */
function VoterAvatarsButton({
  votes,
  totalVotes,
  authorsMap,
  onClick,
  className,
}: {
  votes: NostrEvent[];
  totalVotes: number;
  authorsMap?: Map<string, { pubkey: string; metadata?: import('@nostrify/nostrify').NostrMetadata }>;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-1.5 group', className)}>
      <div className="flex -space-x-1.5">
        {votes.slice(0, 6).map((vote) => {
          const authorData = authorsMap?.get(vote.pubkey);
          const metadata = authorData?.metadata;
          const avatarShape = getAvatarShape(metadata);
          const name = metadata?.name || metadata?.display_name || 'Anonymous';
          return (
            <Avatar key={vote.pubkey} shape={avatarShape} className="size-5 ring-1 ring-background">
              <AvatarImage src={metadata?.picture} alt={name} />
              <AvatarFallback className="bg-primary/20 text-primary text-[8px]">
                {name[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
      </span>
    </button>
  );
}

export function PollContent({ event }: { event: NostrEvent }) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutate: publishEvent } = useNostrPublish();

  const options = useMemo(() => getOptions(event.tags), [event.tags]);
  const pollType = getTag(event.tags, 'polltype') ?? 'singlechoice';
  const endsAt = getTag(event.tags, 'endsAt');
  const isExpired = endsAt ? Number(endsAt) < Math.floor(Date.now() / 1000) : false;

  // Modal state
  const [votersModalOpen, setVotersModalOpen] = useState(false);
  const [votersModalOptionId, setVotersModalOptionId] = useState<string | null>(null);

  // Fetch vote events from default relays + poll hints + author relays.
  const { data: rawVotes } = usePollVotes(event, 1018);
  const votes = useMemo(() => dedupeVotes(rawVotes ?? []), [rawVotes]);

  const tally = useMemo(() => tallyVotes(votes ?? [], pollType), [votes, pollType]);
  const totalVotes = useMemo(() => {
    let sum = 0;
    for (const count of tally.values()) sum += count;
    return sum;
  }, [tally]);

  // Check if current user already voted
  const userVote = useMemo(() => {
    if (!user || !votes) return undefined;
    return votes.find((v) => v.pubkey === user.pubkey);
  }, [user, votes]);

  const hasVoted = !!userVote;
  const showResults = hasVoted || isExpired;

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedOption || !user || hasVoted || isExpired || isVoting) return;
    setIsVoting(true);
    publishEvent({
      kind: 1018,
      content: '',
      tags: [
        ['e', event.id],
        ['response', selectedOption],
      ],
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['poll-votes', event.id] });
      },
      onSettled: () => {
        setIsVoting(false);
      },
    });
  };

  // Collect all voter pubkeys for batch profile fetching
  const allVoterPubkeys = useMemo(() => {
    if (!votes) return [];
    return votes.map((v) => v.pubkey);
  }, [votes]);

  const { data: authorsMap } = useAuthors(allVoterPubkeys);

  // NIP-69 zap polls are rendered by a dedicated sub-component.
  if (event.kind === 6969) {
    return <ZapPollContent event={event} />;
  }

  const openVotersModal = (optionId: string | null) => {
    setVotersModalOptionId(optionId);
    setVotersModalOpen(true);
  };

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      {/* Question */}
      <div className="text-[15px] leading-relaxed font-medium break-words">
        <NoteContent event={event} />
      </div>

      {/* Poll type + expiry badges + voter avatars + vote count */}
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
          <BarChart3 className="size-3" />
          {pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}
        </span>
        {isExpired && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
            <Clock className="size-3" />
            Ended
          </span>
        )}

        {/* Voter avatars + count pushed to the right */}
        {showResults && totalVotes > 0 && (
          <VoterAvatarsButton
            votes={votes ?? []}
            totalVotes={totalVotes}
            authorsMap={authorsMap}
            onClick={() => openVotersModal(null)}
            className="ml-auto"
          />
        )}
      </div>

      {/* Options */}
      <div className="mt-3 space-y-2">
        {options.map((opt) => {
          const count = tally.get(opt.id) ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMyVote = userVote?.tags.some(([n, id]) => n === 'response' && id === opt.id);
          const isSelected = selectedOption === opt.id;

          return showResults ? (
            <div key={opt.id} className="relative overflow-hidden rounded-lg border border-border">
              {/* Background fill bar */}
              <div
                className={cn(
                  'absolute inset-0 transition-all duration-500',
                  isMyVote ? 'bg-primary/15' : 'bg-secondary/40',
                )}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  {isMyVote && <CheckCircle2 className="size-4 text-primary shrink-0" />}
                  <span className={cn('text-sm break-words', isMyVote && 'font-semibold')}>{opt.label}</span>
                </div>
                <span className="text-sm font-medium tabular-nums text-muted-foreground shrink-0 ml-3">
                  {pct}%
                </span>
              </div>
            </div>
          ) : (
            <button
              key={opt.id}
              onClick={() => setSelectedOption(opt.id)}
              className={cn(
                'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors',
                isSelected
                  ? 'border-primary bg-primary/10 font-semibold'
                  : 'border-border hover:bg-secondary/40',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Vote button + voter avatars (voting mode only) */}
      {!showResults && (
        <div className="flex items-center justify-between mt-3">
          {totalVotes > 0 ? (
            <VoterAvatarsButton
              votes={votes ?? []}
              totalVotes={totalVotes}
              authorsMap={authorsMap}
              onClick={() => openVotersModal(null)}
            />
          ) : (
            <span className="text-xs text-muted-foreground">0 votes</span>
          )}
          {user && (
            <button
              onClick={handleVote}
              disabled={!selectedOption || isVoting}
              className={cn(
                'text-sm font-semibold px-4 py-1.5 rounded-full transition-colors',
                selectedOption && !isVoting
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed',
              )}
            >
              {isVoting ? 'Voting…' : 'Vote'}
            </button>
          )}
        </div>
      )}

      {/* Voters Modal */}
      <PollVotersModal
        open={votersModalOpen}
        onOpenChange={setVotersModalOpen}
        allVotes={votes ?? []}
        options={options}
        pollType={pollType}
        initialOptionId={votersModalOptionId}
        authorsMap={authorsMap}
      />
    </div>
  );
}

/* ──── Poll Voters Modal ──── */

interface PollVotersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allVotes: NostrEvent[];
  options: PollOption[];
  pollType: string;
  initialOptionId?: string | null;
  authorsMap?: Map<string, { pubkey: string; event?: NostrEvent; metadata?: import('@nostrify/nostrify').NostrMetadata }>;
}

function PollVotersModal({ open, onOpenChange, allVotes, options, pollType, initialOptionId, authorsMap }: PollVotersModalProps) {
  const [activeFilter, setActiveFilter] = useState<string | null>(initialOptionId ?? null);

  // Sync filter when modal opens with a specific option
  useEffect(() => {
    if (open) setActiveFilter(initialOptionId ?? null);
  }, [open, initialOptionId]);

  // Build a map from option ID to label for display
  const optionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const opt of options) {
      map.set(opt.id, opt.label);
    }
    return map;
  }, [options]);

  // Filter voters based on active filter
  const filteredVoters = useMemo(() => {
    if (activeFilter === null) return allVotes;
    return getVotersForOption(allVotes, activeFilter, pollType);
  }, [allVotes, activeFilter, pollType]);

  // Tally per option for the count badges
  const tally = useMemo(() => tallyVotes(allVotes, pollType), [allVotes, pollType]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] rounded-2xl p-0 gap-0 border-border overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12">
          <DialogTitle className="text-base font-semibold">Voters</DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Option filter bars — scrollable when more than 3 */}
        <ScrollArea className={cn('px-4', options.length > 2 && 'max-h-[120px]')}>
          <div className="space-y-1.5">
            {/* "All" bar */}
            <button
              onClick={() => setActiveFilter(null)}
              className={cn(
                'relative w-full overflow-hidden rounded-lg border transition-colors text-left',
                activeFilter === null ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <div
                className={cn(
                  'absolute inset-0 transition-all duration-500',
                  activeFilter === null ? 'bg-primary/15' : 'bg-secondary/40',
                )}
                style={{ width: '100%' }}
              />
              <div className="relative flex items-center justify-between px-3 py-2">
                <span className={cn('text-sm', activeFilter === null && 'font-semibold')}>All</span>
                <span className="text-sm font-medium tabular-nums text-muted-foreground shrink-0 ml-3">
                  {allVotes.length}
                </span>
              </div>
            </button>

            {/* Per-option bars */}
            {options.map((opt) => {
              const count = tally.get(opt.id) ?? 0;
              const pct = allVotes.length > 0 ? Math.round((count / allVotes.length) * 100) : 0;
              const isActive = activeFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setActiveFilter(opt.id)}
                  className={cn(
                    'relative w-full overflow-hidden rounded-lg border transition-colors text-left',
                    isActive ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <div
                    className={cn(
                      'absolute inset-0 transition-all duration-500',
                      isActive ? 'bg-primary/15' : 'bg-secondary/40',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between px-3 py-2">
                    <span className={cn('text-sm break-words min-w-0', isActive && 'font-semibold')}>{opt.label}</span>
                    <span className="text-sm font-medium tabular-nums text-muted-foreground shrink-0 ml-3">
                      {count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* Primary accent divider — only when scrollbox is active */}
        {options.length > 2 && <div className="mx-4 h-1 bg-primary rounded-full" />}

        {/* Voter list */}
        <ScrollArea className="max-h-[60vh]">
          {filteredVoters.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No votes yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredVoters.map((vote) => (
                <VoterRow
                  key={vote.id}
                  vote={vote}
                  optionLabelMap={optionLabelMap}
                  pollType={pollType}
                  authorsMap={authorsMap}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/* ──── Voter Row ──── */

interface VoterRowProps {
  vote: NostrEvent;
  optionLabelMap: Map<string, string>;
  pollType: string;
  authorsMap?: Map<string, { pubkey: string; event?: NostrEvent; metadata?: import('@nostrify/nostrify').NostrMetadata }>;
}

function VoterRow({ vote, optionLabelMap, pollType, authorsMap }: VoterRowProps) {
  // Use batch-fetched author data if available, fall back to individual fetch
  const individualAuthor = useAuthor(authorsMap?.has(vote.pubkey) ? undefined : vote.pubkey);
  const authorData = authorsMap?.get(vote.pubkey) ?? individualAuthor.data;
  const metadata = authorData?.metadata;
  const avatarShape = getAvatarShape(metadata);
  const displayName = metadata?.name || metadata?.display_name || 'Anonymous';

  const nevent = useMemo(
    () => nip19.neventEncode({ id: vote.id, author: vote.pubkey }),
    [vote.id, vote.pubkey],
  );

  // Resolve which option(s) this person voted for
  const votedOptions = useMemo(() => {
    const responseTags = vote.tags.filter(([n]) => n === 'response');
    if (pollType === 'singlechoice') {
      const id = responseTags[0]?.[1];
      const label = id ? optionLabelMap.get(id) : undefined;
      return label ? [label] : [];
    }
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const [, id] of responseTags) {
      if (id && !seen.has(id)) {
        seen.add(id);
        const label = optionLabelMap.get(id);
        if (label) labels.push(label);
      }
    }
    return labels;
  }, [vote.tags, pollType, optionLabelMap]);

  return (
    <Link
      to={`/${nevent}`}
      onClick={() => {
        // Close any open dialogs by dispatching escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      }}
      className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
    >
      <Avatar shape={avatarShape} className="size-10 shrink-0">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="bg-primary/20 text-primary text-sm">
          {displayName[0]?.toUpperCase() ?? '?'}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-sm truncate">
            {authorData?.event ? (
              <EmojifiedText tags={authorData.event.tags}>{displayName}</EmojifiedText>
            ) : displayName}
          </span>
          {metadata?.nip05 && (
            <VerifiedNip05Text nip05={metadata.nip05} pubkey={vote.pubkey} className="text-xs text-muted-foreground truncate" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {votedOptions.length > 0 && (
            <span className="text-xs text-muted-foreground truncate">
              {votedOptions.join(', ')}
            </span>
          )}
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(vote.created_at)}</span>
        </div>
      </div>

      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}



/** Parse NIP-69 poll_option tags into PollOption shapes. */
function getZapPollOptions(tags: string[][]): PollOption[] {
  return tags
    .filter(([name]) => name === 'poll_option')
    .map(([, id, label]) => ({ id: id ?? '', label: label ?? '' }))
    .filter((opt) => opt.id && opt.label);
}

/** Parse a numeric constraint tag (value_minimum / value_maximum / closed_at). */
function getZapPollConstraint(tags: string[][], name: string): number | undefined {
  const value = getTag(tags, name);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Validate that a kind 6969 zap poll has the required NIP-69 constraints. */
function validateZapPoll(tags: string[][]): { ok: true } | { ok: false; reason: string } {
  const options = getZapPollOptions(tags);
  if (options.length < 2) {
    return { ok: false, reason: 'A zap poll needs at least two options.' };
  }
  const min = getZapPollConstraint(tags, 'value_minimum');
  const max = getZapPollConstraint(tags, 'value_maximum');
  if (min === undefined && max === undefined) {
    return { ok: false, reason: 'Missing vote value constraints.' };
  }
  if (min !== undefined && max !== undefined && min > max) {
    return { ok: false, reason: 'Minimum vote value exceeds the maximum.' };
  }
  const closedAt = getTag(tags, 'closed_at');
  if (closedAt !== undefined && getZapPollConstraint(tags, 'closed_at') === undefined) {
    return { ok: false, reason: 'Invalid poll close time.' };
  }
  return { ok: true };
}

/** Extract the poll_option index a kind 9735 receipt was voting for. */
function extractPollOptionFromReceipt(receipt: NostrEvent): string | undefined {
  const descTag = receipt.tags.find(([name]) => name === 'description');
  if (!descTag?.[1]) return undefined;
  try {
    const zapRequest = JSON.parse(descTag[1]);
    const tags: string[][] = zapRequest.tags ?? [];
    return tags.find(([name]) => name === 'poll_option')?.[1];
  } catch {
    return undefined;
  }
}

/** Render a kind 6969 NIP-69 zap poll and tally its Lightning zap votes. */
function ZapPollContent({ event }: { event: NostrEvent }) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [zapDialogOpen, setZapDialogOpen] = useState(false);

  const options = useMemo(() => getZapPollOptions(event.tags), [event.tags]);
  const validation = useMemo(() => validateZapPoll(event.tags), [event.tags]);
  const valueMinimum = getZapPollConstraint(event.tags, 'value_minimum');
  const valueMaximum = getZapPollConstraint(event.tags, 'value_maximum');
  const closedAt = getZapPollConstraint(event.tags, 'closed_at');
  const isExpired = closedAt !== undefined ? closedAt < Math.floor(Date.now() / 1000) : false;

  // Fetch zap receipt events from default relays + poll hints + author relays.
  const { data: receipts } = usePollVotes(event, 9735);

  const tally = useMemo(() => {
    const map = new Map<string, number>();
    for (const receipt of receipts ?? []) {
      const optionId = extractPollOptionFromReceipt(receipt);
      if (optionId === undefined) continue;
      const sats = getZapAmountSats(receipt);
      if (sats <= 0) continue;
      map.set(optionId, (map.get(optionId) ?? 0) + sats);
    }
    return map;
  }, [receipts]);

  const totalSats = useMemo(() => {
    let sum = 0;
    for (const value of tally.values()) sum += value;
    return sum;
  }, [tally]);

  const userVote = useMemo(() => {
    if (!user || !receipts) return undefined;
    return receipts.find((r) => getZapSenderPubkey(r) === user.pubkey && extractPollOptionFromReceipt(r) !== undefined);
  }, [user, receipts]);

  const hasVoted = !!userVote;
  const showResults = hasVoted || isExpired;

  const openVote = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedOption || !user || hasVoted || isExpired) return;
    setZapDialogOpen(true);
  };

  const handleZapSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['zap-poll-votes', event.id] });
  };

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      {/* Question */}
      <div className="text-[15px] leading-relaxed font-medium break-words">
        <NoteContent event={event} />
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
          <Zap className="size-3" />
          Zap poll
        </span>
        {valueMinimum !== undefined && valueMaximum !== undefined && valueMinimum === valueMaximum ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
            {valueMinimum.toLocaleString()} sats / vote
          </span>
        ) : (
          <>
            {valueMinimum !== undefined && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
                Min {valueMinimum.toLocaleString()} sats
              </span>
            )}
            {valueMaximum !== undefined && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
                Max {valueMaximum.toLocaleString()} sats
              </span>
            )}
          </>
        )}
        {isExpired && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
            <Clock className="size-3" />
            Ended
          </span>
        )}
      </div>

      {!validation.ok ? (
        <p className="mt-2 text-sm text-muted-foreground">{validation.reason}</p>
      ) : (
        <>
          {/* Options */}
          <div className="mt-3 space-y-2">
            {options.map((opt) => {
              const sats = tally.get(opt.id) ?? 0;
              const pct = totalSats > 0 ? Math.round((sats / totalSats) * 100) : 0;
              const isSelected = selectedOption === opt.id;
              const isMyVote = userVote && extractPollOptionFromReceipt(userVote) === opt.id;

              return showResults ? (
                <div key={opt.id} className="relative overflow-hidden rounded-lg border border-border">
                  {/* Background fill bar */}
                  <div
                    className={cn(
                      'absolute inset-0 transition-all duration-500',
                      isMyVote ? 'bg-amber-500/15' : 'bg-secondary/40',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {isMyVote && <CheckCircle2 className="size-4 text-amber-500 shrink-0" />}
                      <span className={cn('text-sm break-words', isMyVote && 'font-semibold')}>{opt.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3 text-xs tabular-nums text-muted-foreground">
                      <span>{sats.toLocaleString()} sats</span>
                      <span className="font-medium text-foreground">{pct}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  key={opt.id}
                  onClick={() => setSelectedOption(opt.id)}
                  className={cn(
                    'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    isSelected
                      ? 'border-amber-500 bg-amber-500/10 font-semibold'
                      : 'border-border hover:bg-secondary/40',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Vote button */}
          {!showResults && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                {totalSats > 0 ? `${totalSats.toLocaleString()} sats voted` : '0 sats voted'}
              </span>
              {user && (
                <button
                  onClick={openVote}
                  disabled={!selectedOption}
                  className={cn(
                    'inline-flex items-center gap-1 text-sm font-semibold px-4 py-1.5 rounded-full transition-colors',
                    selectedOption
                      ? 'bg-amber-500 text-white hover:bg-amber-500/90'
                      : 'bg-secondary text-muted-foreground cursor-not-allowed',
                  )}
                >
                  <Zap className="size-3.5" />
                  Vote with zap
                </button>
              )}
            </div>
          )}

          <ZapDialog
            target={event}
            open={zapDialogOpen}
            onOpenChange={setZapDialogOpen}
            pollOption={selectedOption ?? undefined}
            onZapSuccess={handleZapSuccess}
          />
        </>
      )}
    </div>
  );
}
