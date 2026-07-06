import { ExternalLink, Newspaper, Zap, MessageSquare } from 'lucide-react';

import { useStackerNews } from '@/hooks/useStackerNews';
import { Skeleton } from '@/components/ui/skeleton';

/** Link to a Stacker News item. */
function itemUrl(item: { id: string; url: string | null }): string {
  if (item.url) return item.url;
  return `https://stacker.news/items/${item.id}`;
}

/** Stacker News widget showing the current hot items. */
export function StackerNewsWidget() {
  const { data: items, isLoading, isError } = useStackerNews();

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-muted-foreground p-1">Failed to load Stacker News.</p>;
  }

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground p-1">No hot posts right now.</p>;
  }

  return (
    <div className="space-y-2.5 p-1">
      {items.map((item) => {
        const url = itemUrl(item);
        return (
          <a
            key={item.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-left group"
          >
            <div className="space-y-0.5">
              <h3 className="text-sm font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {item.title ?? `Post #${item.id}`}
              </h3>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/80 pt-0.5">
                <span className="truncate max-w-[50%]">@{item.user.name}</span>
                <span className="flex items-center gap-0.5">
                  <Zap className="size-2.5 text-amber-500" />
                  {item.sats.toLocaleString()}
                </span>
                <span className="flex items-center gap-0.5">
                  <MessageSquare className="size-2.5" />
                  {item.ncomments}
                </span>
              </div>
            </div>
          </a>
        );
      })}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 pt-0.5">
        <Newspaper className="size-2.5" />
        <span>stacker.news</span>
        <ExternalLink className="size-2.5" />
      </div>
    </div>
  );
}
