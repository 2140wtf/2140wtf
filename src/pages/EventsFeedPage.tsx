import type { NostrEvent } from "@nostrify/nostrify";
import { useSeoMeta } from "@unhead/react";
import { CalendarDays, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { FeedEmptyState } from "@/components/FeedEmptyState";
import { KindInfoButton } from "@/components/KindInfoButton";
import { NoteCard } from "@/components/NoteCard";
import { PageHeader } from "@/components/PageHeader";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SubHeaderBar } from "@/components/SubHeaderBar";
import { TabButton } from "@/components/TabButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeed } from "@/hooks/useFeed";
import { useFeedTab } from "@/hooks/useFeedTab";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useMuteList } from "@/hooks/useMuteList";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { getExtraKindDef } from "@/lib/extraKinds";
import { isEventMuted } from "@/lib/muteHelpers";
import { sidebarItemIcon } from "@/lib/sidebarItems";

type FeedTab = "follows" | "global";

const eventsDef = getExtraKindDef("events")!;

/** Extract the first value of a tag by name. */
function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

// ─── EventsFeedPage ───────────────────────────────────────────────────────────

export function EventsFeedPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { muteItems } = useMuteList();

  const [activeTab, setActiveTab] = useFeedTab<FeedTab>("events", [
    "follows",
    "global",
  ]);

  useSeoMeta({ title: `Events | ${config.appName}` });
  useLayoutOptions({ showFAB: true, fabKind: 31923, hasSubHeader: !!user });

  // Calendar events feed
  const feedQuery = useFeed(activeTab, { kinds: [31922, 31923] });

  const handleRefresh = usePageRefresh(useMemo(() => ["feed", activeTab], [activeTab]));

  const {
    data: rawData,
    isPending,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = feedQuery;

  const { scrollRef } = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    pageCount: rawData?.pages?.length,
  });

  // Flatten, deduplicate, filter muted, then sort: future events first
  const feedItems = useMemo(() => {
    if (!rawData?.pages) return [];
    const seenIds = new Set<string>();
    const now = Math.floor(Date.now() / 1000);

    const items = (
      rawData.pages as { items: { event: NostrEvent; repostedBy?: string }[] }[]
    )
      .flatMap((page) => page.items)
      .filter((item) => {
        if (seenIds.has(item.event.id)) return false;
        seenIds.add(item.event.id);
        if (muteItems.length > 0 && isEventMuted(item.event, muteItems))
          return false;
        return true;
      });

    // Calendar events can be published as both kind 31922 (date-based) and
    // kind 31923 (time-based) with the same d-tag. Keep one per author+d-tag,
    // preferring the time-based (31923) version and otherwise the newest one.
    const byCalendarCoord = new Map<string, { event: NostrEvent; repostedBy?: string }>();
    for (const item of items) {
      const dTag = getTag(item.event.tags, 'd');
      if (!dTag) continue;
      const key = `${item.event.pubkey}:${dTag}`;
      const existing = byCalendarCoord.get(key);
      if (!existing) {
        byCalendarCoord.set(key, item);
      } else if (
        item.event.kind === 31923 && existing.event.kind !== 31923
      ) {
        byCalendarCoord.set(key, item);
      } else if (
        item.event.kind === existing.event.kind &&
        item.event.created_at > existing.event.created_at
      ) {
        byCalendarCoord.set(key, item);
      }
    }

    const deduped = items.filter((item) => {
      const dTag = getTag(item.event.tags, 'd');
      if (!dTag) return true;
      const key = `${item.event.pubkey}:${dTag}`;
      return byCalendarCoord.get(key) === item;
    });

    return deduped.sort((a, b) => {
      const aStart = parseInt(getTag(a.event.tags, "start") ?? "0", 10);
      const bStart = parseInt(getTag(b.event.tags, "start") ?? "0", 10);
      const aFuture = aStart >= now;
      const bFuture = bStart >= now;
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      if (aFuture && bFuture) return aStart - bStart;
      return bStart - aStart;
    });
  }, [rawData?.pages, muteItems]);

  const showSkeleton = isPending || (isLoading && !rawData);

  return (
    <main className="max-w-2xl mx-auto">
      <PageHeader title="Events" icon={<CalendarDays className="size-5" />}>
        <KindInfoButton
          kindDef={eventsDef}
          icon={sidebarItemIcon("events", "size-5")}
        />
      </PageHeader>

      {/* Follows / Global tabs */}
      {user && (
        <SubHeaderBar>
          <TabButton
            label="Follows"
            active={activeTab === "follows"}
            onClick={() => setActiveTab("follows")}
          />
          <TabButton
            label="Global"
            active={activeTab === "global"}
            onClick={() => setActiveTab("global")}
          />
        </SubHeaderBar>
      )}

      <PullToRefresh onRefresh={handleRefresh}>
        {showSkeleton ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : feedItems.length > 0 ? (
          <div>
            {feedItems.map((item) => (
              <NoteCard key={item.event.id} event={item.event} />
            ))}

            {hasNextPage && (
              <div ref={scrollRef} className="py-4">
                {isFetchingNextPage && (
                  <div className="flex justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <FeedEmptyState
            message={
              activeTab === "follows"
                ? "No events from people you follow yet."
                : "No calendar events found. Check your relay connections or try again later."
            }
            onSwitchToGlobal={
              activeTab === "follows" ? () => setActiveTab("global") : undefined
            }
          />
        )}
      </PullToRefresh>
    </main>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function EventCardSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full shrink-0" />
        <div className="min-w-0 space-y-1.5 flex-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}
