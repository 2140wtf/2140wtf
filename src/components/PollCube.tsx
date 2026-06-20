import { useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAuthor } from '@/hooks/useAuthor';
import { useHostedCubeEmbed } from '@/hooks/useHostedCubeEmbed';
import { usePollEvent } from '@/hooks/usePollEvent';
import { usePollVotes } from '@/hooks/usePollVotes';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Skeleton } from '@/components/ui/skeleton';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

import './PollCube.css';

interface PollOption {
  id: string;
  label: string;
}

interface PollCubeProps {
  pollId: string;
  title?: string;
  className?: string;
}

const DEFAULT_ACCENT = '#8B5CF6';
const DEFAULT_LABEL = 'COMMUNITY POLL';

function getOptions(event: NostrEvent): PollOption[] {
  if (event.kind === 6969) {
    return event.tags
      .filter(([name]) => name === 'poll_option')
      .map(([, id, label]) => ({ id: id ?? '', label: label ?? '' }))
      .filter((opt) => opt.id && opt.label);
  }
  return event.tags
    .filter(([name]) => name === 'option')
    .map(([, id, label]) => ({ id: id ?? '', label: label ?? '' }))
    .filter((opt) => opt.id && opt.label);
}

function getTitle(event: NostrEvent): string {
  for (const line of event.content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return 'Poll';
}

function getEndsAt(event: NostrEvent): number | undefined {
  const tag = event.tags.find(([name]) => name === 'endsAt' || name === 'closed_at');
  if (tag?.[1]) {
    const n = Number(tag[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function formatTimeLeft(until: number): string {
  const diff = until - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `ends ${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600) / 60);
  return `ends ${hours}h ${mins}m`;
}

function useAccentColor(brandingColor?: string): string {
  return useMemo(() => {
    if (!brandingColor) return DEFAULT_ACCENT;
    const hex = brandingColor.startsWith('#') ? brandingColor : `#${brandingColor}`;
    return /^#[0-9A-Fa-f]{3,8}$/.test(hex) ? hex : DEFAULT_ACCENT;
  }, [brandingColor]);
}

function useCubeVoteCounts(event: NostrEvent) {
  const kind = event.kind === 6969 ? 9735 : 1018;
  const votes = usePollVotes(event, kind);

  return useMemo(() => {
    const counts = new Map<string, number>();
    let satsTotal = 0;

    for (const vote of votes.data ?? []) {
      if (kind === 9735) {
        const amountTag = vote.tags.find(([name]) => name === 'amount')?.[1];
        const amount = amountTag ? Number(amountTag) : 0;
        if (amount > 0) satsTotal += amount;

        const descTag = vote.tags.find(([name]) => name === 'description')?.[1];
        if (descTag) {
          try {
            const zapReq = JSON.parse(descTag) as { tags?: string[][] };
            const pollOption = zapReq.tags?.find(([name]) => name === 'poll_option')?.[1];
            if (pollOption) {
              counts.set(pollOption, (counts.get(pollOption) ?? 0) + 1);
            }
          } catch {
            // ignore malformed zap request
          }
        }
      } else {
        const response = vote.tags.find(([name]) => name === 'response')?.[1];
        if (response) {
          counts.set(response, (counts.get(response) ?? 0) + 1);
        }
      }
    }

    const total = Array.from(counts.values()).reduce((sum, c) => sum + c, 0);
    return { total, counts, satsTotal };
  }, [kind, votes.data]);
}

function PollCubeContent({ event, title, className }: { event: NostrEvent; title?: string; className?: string }) {
  const { data: design } = useHostedCubeEmbed(event.id);
  const author = useAuthor(event.pubkey);
  const { total, counts, satsTotal } = useCubeVoteCounts(event);

  const accent = useAccentColor(design?.branding?.accentColor);
  const label = design?.branding?.label || DEFAULT_LABEL;
  const options = useMemo(() => getOptions(event), [event]);
  const pollTitle = title || getTitle(event);
  const endsAt = getEndsAt(event);

  const sceneRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ x: -10, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, rotX: 0, rotY: 0 });

  const qrValue = useMemo(() => {
    try {
      return `${window.location.origin}/${nip19.neventEncode({ id: event.id })}`;
    } catch {
      return `${window.location.origin}/polls`;
    }
  }, [event.id]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const scene = sceneRef.current;
    if (!scene) return;
    setDragging(true);
    scene.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rotX: rotation.x,
      rotY: rotation.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setRotation({
      x: Math.max(-60, Math.min(60, dragStartRef.current.rotX - dy * 0.5)),
      y: dragStartRef.current.rotY + dx * 0.5,
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
  };

  const authorName = author.data?.metadata?.name || `${event.pubkey.slice(0, 8)}…`;
  const authorImage = sanitizeUrl(author.data?.metadata?.picture) ?? undefined;
  const wallImage = (idx: number) => sanitizeUrl(design?.wallImages?.[idx]?.url);

  const frontBg = wallImage(1);
  const rightBg = wallImage(2);
  const backBg = wallImage(3);
  const leftBg = wallImage(4);

  const renderOptions = () => (
    <div className="flex flex-col h-full p-4 text-white">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <h3 className="mb-4 text-base font-bold leading-tight line-clamp-4">{pollTitle}</h3>
      <div className="flex-1 space-y-2 overflow-hidden">
        {options.slice(0, 5).map((opt) => {
          const count = counts.get(opt.id) ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={opt.id} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="line-clamp-1">{opt.label}</span>
                <span className="opacity-80">{pct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white/90" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs opacity-80">
        <span>
          {total} {event.kind === 6969 ? 'zaps' : 'votes'}
          {satsTotal > 0 ? ` · ${satsTotal.toLocaleString()} sats` : ''}
        </span>
        <span>{endsAt ? formatTimeLeft(endsAt) : ''}</span>
      </div>
    </div>
  );

  const renderFace = (
    side: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom',
    bgUrl?: string,
    children?: React.ReactNode,
  ) => {
    const faceStyle: React.CSSProperties = {
      backgroundColor: accent,
      backgroundImage: bgUrl ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.45)), url(${bgUrl})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
    return (
      <div key={side} className={cn('poll-cube-face', `poll-cube-face--${side}`)} style={faceStyle}>
        {children}
      </div>
    );
  };

  return (
    <div
      className={cn('poll-cube-scene mx-auto', className)}
      ref={sceneRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        className={cn('poll-cube', !dragging && 'poll-cube--spinning')}
        style={{ transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}
      >
        {renderFace('front', frontBg, renderOptions())}
        {renderFace('back', backBg, renderOptions())}
        {renderFace(
          'right',
          rightBg,
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white">
            {authorImage ? (
              <img
                src={authorImage}
                alt={authorName}
                className="mb-3 size-16 rounded-full border-2 border-white/30 object-cover"
              />
            ) : (
              <div className="mb-3 flex size-16 items-center justify-center rounded-full bg-white/20 text-xl font-bold">
                {authorName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <p className="line-clamp-2 text-sm font-semibold">{authorName}</p>
            <p className="mt-2 text-xs opacity-80">{endsAt ? formatTimeLeft(endsAt) : ''}</p>
            {satsTotal > 0 && <p className="mt-1 text-xs opacity-80">{satsTotal.toLocaleString()} sats</p>}
          </div>,
        )}
        {renderFace(
          'left',
          leftBg,
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white">
            <div className="rounded-lg bg-white p-2">
              <QRCodeCanvas value={qrValue} size={140} />
            </div>
            <p className="mt-3 text-xs opacity-80">Scan to open poll</p>
          </div>,
        )}
        {renderFace(
          'top',
          undefined,
          <div className="flex h-full items-center justify-center text-white/90">
            <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
          </div>,
        )}
        {renderFace(
          'bottom',
          undefined,
          <div className="flex h-full items-center justify-center text-white/90">
            <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
          </div>,
        )}
      </div>
    </div>
  );
}

export function PollCube({ pollId, title, className }: PollCubeProps) {
  const { data: event, isLoading } = usePollEvent(pollId);

  if (isLoading) {
    return <Skeleton className={cn('h-[420px] w-full rounded-xl', className)} />;
  }

  if (!event) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground',
          className,
        )}
        style={{ minHeight: 420 }}
      >
        Poll not found.
      </div>
    );
  }

  return <PollCubeContent event={event} title={title} className={className} />;
}
