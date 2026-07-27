import type { NostrEvent } from "@nostrify/nostrify";
import { useSeoMeta } from "@unhead/react";
import { CalendarDays, List, Loader2, Map as MapIcon, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { FeedEmptyState } from "@/components/FeedEmptyState";
import { KindInfoButton } from "@/components/KindInfoButton";
import { NoteCard } from "@/components/NoteCard";
import { PageHeader } from "@/components/PageHeader";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SubHeaderBar } from "@/components/SubHeaderBar";
import { TabButton } from "@/components/TabButton";
import { CreateEventDialog } from "@/components/events/CreateEventDialog";
import { EventsMap } from "@/components/events/EventsMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutOptions } from "@/contexts/LayoutContext";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeed } from "@/hooks/useFeed";
import { useFeedTab } from "@/hooks/useFeedTab";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useMuteList } from "@/hooks/useMuteList";
import { usePageRefresh } from "@/hooks/usePageRefresh";
import { isUpcoming } from "@/hooks/useCalendarEvents";
import { getExtraKindDef } from "@/lib/extraKinds";
import { isEventMuted } from "@/lib/muteHelpers";
import { parseCalendarEvent, type CalendarEvent } from "@/lib/nip29";
import { sidebarItemIcon } from "@/lib/sidebarItems";
import { cn } from "@/lib/utils";

type FeedTab = "follows" | "global";
type WhenFilter = "upcoming" | "past" | "all";
type PlaceFilter = "all" | "online" | "in-person";
type ViewMode = "list" | "map";

const eventsDef = getExtraKindDef("events")!;

/** Extract the first value of a tag by name. */
function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

/** True when the event's location reads as an online link rather than a place. */
function isOnlineEvent(event: NostrEvent): boolean {
  const location = getTag(event.tags, "location") ?? "";
  return /^https?:\/\//i.test(location.trim());
}

/** Free-text match over the fields an attendee would search by. */
function matchesQuery(event: NostrEvent, q: string): boolean {
  const haystack = [
    getTag(event.tags, "title"),
    getTag(event.tags, "summary"),
    getTag(event.tags, "location"),
    event.content,
    ...event.tags.filter(([n]) => n === "t").map(([, v]) => v),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** True when a 31922 date string or 31923 timestamp ends before now. */
function eventIsUpcoming(event: NostrEvent, now: number): boolean {
  const parsed = parseCalendarEvent(event);
  if (parsed) return isUpcoming(parsed, now);
  return true; // unparseable events stay visible
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
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [when, setWhen] = useState<WhenFilter>("upcoming");
  const [place, setPlace] = useState<PlaceFilter>("all");

  useSeoMeta({ title: `Events | ${config.appName}` });
  useLayoutOptions({
    showFAB: true,
    onFabClick: () => setCreateOpen(true),
    hasSubHeader: !!user,
  });

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

  // Client-side filters: when (upcoming/past), place (online/in-person), text.
  const filteredItems = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const q = query.trim().toLowerCase();
    return feedItems.filter((item) => {
      if (when === "upcoming" && !eventIsUpcoming(item.event, now)) return false;
      if (when === "past" && eventIsUpcoming(item.event, now)) return false;
      if (place === "online" && !isOnlineEvent(item.event)) return false;
      if (place === "in-person" && isOnlineEvent(item.event)) return false;
      if (q && !matchesQuery(item.event, q)) return false;
      return true;
    });
  }, [feedItems, when, place, query]);

  // Parsed events for the map (only those with a geohash render a marker).
  const mapEvents = useMemo(() => {
    const parsed: CalendarEvent[] = [];
    for (const item of filteredItems) {
      const c = parseCalendarEvent(item.event);
      if (c) parsed.push(c);
    }
    return parsed;
  }, [filteredItems]);

  const showSkeleton = isPending || (isLoading && !rawData);

  return (
    <main className="max-w-2xl mx-auto">
      <PageHeader title="Events" icon={<CalendarDays className="size-5" />}>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" />
          Create event
        </Button>
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

      {/* Discovery toolbar: search, when, place, list/map */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events, places, #tags"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["upcoming", "past", "all"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWhen(w)}
              className={cn(
                "px-2.5 py-1.5 rounded-full font-medium transition-colors capitalize",
                when === w
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(
            [
              ["all", "Anywhere"],
              ["online", "Online"],
              ["in-person", "In person"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlace(p)}
              className={cn(
                "px-2.5 py-1.5 rounded-full font-medium transition-colors",
                place === p
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            type="button"
            aria-label="List view"
            onClick={() => setView("list")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              view === "list" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Map view"
            onClick={() => setView("map")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              view === "map" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MapIcon className="size-4" />
          </button>
        </div>
      </div>

      <PullToRefresh onRefresh={handleRefresh}>
        {view === "map" ? (
          <div className="p-4">
            <EventsMap events={mapEvents} />
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Only events pinned to a place appear on the map — the list view has everything.
            </p>
          </div>
        ) : showSkeleton ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredItems.length > 0 ? (
          <div>
            {filteredItems.map((item) => (
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
              feedItems.length > 0
                ? "No events match these filters."
                : activeTab === "follows"
                  ? "No events from people you follow yet."
                  : "No calendar events found. Check your relay connections or try again later."
            }
            onSwitchToGlobal={
              activeTab === "follows" && feedItems.length === 0 ? () => setActiveTab("global") : undefined
            }
          />
        )}
      </PullToRefresh>

      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} />
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
