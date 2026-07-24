import { useMemo } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Activity, ExternalLink, MessageSquare, RefreshCw, Telescope, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ComposeBox } from '@/components/ComposeBox';
import { FlatThreadedReplyList } from '@/components/ThreadedReplyList';
import { useAppContext } from '@/hooks/useAppContext';
import { useComments } from '@/hooks/useComments';
import { useLightningNetworkStats } from '@/hooks/useLightningObservatory';
import { useMuteList } from '@/hooks/useMuteList';
import { LIGHTNING_OBSERVATORY_URL } from '@/lib/lightningObservatory';
import { isEventMuted } from '@/lib/muteHelpers';
import { formatNumber } from '@/lib/formatNumber';

/** Format a satoshi amount as a compact BTC string (e.g. 146666332527 -> "1,466.7 BTC"). */
function satsToBtc(sats: number): string {
  return `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} BTC`;
}

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * In-app Lightning Observatory page.
 *
 * lightningobservatory.com disallows framing (`X-Frame-Options: DENY`), so the
 * full 3D observatory can't be embedded — instead this page renders the live
 * network-wide stats from its JSON API natively, links out to the full
 * experience, and keeps the NIP-73 discussion thread for the URL.
 */
export function LightningObservatoryPage() {
  const { config } = useAppContext();
  const { data: stats, isLoading, isError, dataUpdatedAt, refetch, isRefetching } = useLightningNetworkStats();

  useSeoMeta({ title: `Lightning Observatory | ${config.appName}` });

  // NIP-73 discussion thread for the observatory URL (same root as /i/<url>).
  const commentRoot = useMemo(() => new URL(LIGHTNING_OBSERVATORY_URL), []);
  const { muteItems } = useMuteList();
  const { data: commentsData, isLoading: commentsLoading } = useComments(commentRoot, 500);
  const orderedReplies = useMemo(() => {
    const topLevel = commentsData?.topLevelComments ?? [];
    const filtered = muteItems.length > 0
      ? topLevel.filter((r) => !isEventMuted(r, muteItems))
      : topLevel;
    return [...filtered]
      .sort((a, b) => a.created_at - b.created_at)
      .map((reply) => ({
        reply,
        firstSubReply: commentsData?.getDirectReplies(reply.id)[0],
      }));
  }, [commentsData, muteItems]);

  return (
    <main className="pb-8">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 pt-4 pb-5">
        <Telescope className="size-6 text-primary shrink-0" />
        <h1 className="text-xl font-bold truncate flex-1">Lightning Observatory</h1>
        {/* Same-tab navigation (no new tab) — the browser's back button returns
            here. An in-page iframe is impossible: the site sends
            X-Frame-Options: DENY / frame-ancestors 'self'. */}
        <Button variant="outline" size="sm" asChild>
          <a href={LIGHTNING_OBSERVATORY_URL}>
            <ExternalLink className="size-4 mr-2" />
            Full observatory
          </a>
        </Button>
      </div>

      <div className="px-4 space-y-6">
        {/* Live network stats */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">Network overview</h2>
            {stats && (
              <Badge variant={stats.source === 'live' ? 'default' : 'secondary'} className="ml-1">
                {stats.source === 'live' ? 'LIVE' : stats.source}
              </Badge>
            )}
            <div className="flex-1" />
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Refresh stats"
            >
              <RefreshCw className={`size-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isError ? (
            <Card>
              <CardContent className="py-6 text-center space-y-3">
                <Zap className="size-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Live stats aren't reachable from this browser right now.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a href={LIGHTNING_OBSERVATORY_URL} target="_blank" rel="noopener noreferrer">
                    Open lightningobservatory.com
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Nodes" value={stats ? formatNumber(stats.nodeCount) : ''} loading={isLoading} />
              <StatCard label="Channels" value={stats ? formatNumber(stats.channelCount) : ''} loading={isLoading} />
              <StatCard label="Capacity" value={stats ? satsToBtc(stats.totalCapacity) : ''} loading={isLoading} />
              <StatCard label="Avg channel" value={stats ? `${formatNumber(Math.round(stats.avgChannelSize))} sats` : ''} loading={isLoading} />
              <StatCard label="Max channel" value={stats ? satsToBtc(stats.maxChannelSize) : ''} loading={isLoading} />
              <StatCard label="Block height" value={stats ? stats.blockHeight.toLocaleString() : ''} loading={isLoading} />
            </div>
          )}

          {stats && dataUpdatedAt > 0 && (
            <p className="text-xs text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()} · refreshes every minute · data by{' '}
              <a
                href={LIGHTNING_OBSERVATORY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                lightningobservatory.com
              </a>
            </p>
          )}
        </section>

        {/* Discussion */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">Discussion</h2>
          </div>
          <ComposeBox compact replyTo={commentRoot} />
          {commentsLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : orderedReplies.length > 0 ? (
            <FlatThreadedReplyList replies={orderedReplies} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No comments yet — be the first to share your thoughts about the Lightning Observatory!
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
