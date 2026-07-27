import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FEED_TOPICS } from '@/lib/feedTopics';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

interface CuratedOption {
  id: string;
  label: string;
  description: string;
}

const SOCIAL_OPTIONS: CuratedOption[] = [
  { id: 'follows', label: 'Latest', description: 'Latest notes by your follows' },
  { id: 'popular-follows', label: 'Popular from follows', description: 'Notes currently popular from people you follow' },
  { id: 'follows-replies', label: 'Latest with Replies', description: 'Latest notes and replies by your follows' },
];

const TRENDING_OPTIONS: CuratedOption[] = [
  { id: 'trending-24h', label: 'Trending 24h', description: 'Global trending notes in the past 24 hours' },
  { id: 'trending-7d', label: 'Trending 7d', description: 'Global trending notes in the past 7 days' },
  { id: 'global', label: 'Nostr Firehose', description: 'Latest global notes; be careful!' },
];

const READS_OPTIONS: CuratedOption[] = [
  { id: 'bitcoin-reads', label: 'Bitcoin Reads', description: 'Bitcoin-related long-form notes' },
  { id: 'podcasts-reads', label: 'Podcasts Reads', description: 'Podcasts-related long-form notes' },
  { id: 'art-reads', label: 'Art Reads', description: 'Art-related long-form notes' },
];

const CURATED_IDS = new Set([
  ...SOCIAL_OPTIONS.map((o) => o.id),
  ...TRENDING_OPTIONS.map((o) => o.id),
  ...READS_OPTIONS.map((o) => o.id),
  ...FEED_TOPICS.map((t) => t.id),
]);

const HIDDEN_TOPIC_IDS = new Set([
  'popular-follows',
  'follows-replies',
  'trending-24h',
  'trending-7d',
  'bitcoin-reads',
  'podcasts-reads',
  'art-reads',
]);

interface CurateFeedDropdownProps {
  activeTab: string;
  onSelect: (tab: string) => void;
}

function OptionItem({ option, activeTab, onSelect }: { option: CuratedOption; activeTab: string; onSelect: (id: string) => void }) {
  const active = activeTab === option.id;
  return (
    <DropdownMenuItem
      key={option.id}
      className={cn(
        'flex items-start gap-2 py-2 focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
        active && 'text-primary',
      )}
      onClick={() => onSelect(option.id)}
    >
      <div className="flex flex-col items-start min-w-0">
        <span className={cn('text-sm font-medium', active && 'text-primary')}>{option.label}</span>
        <span className={cn('text-xs leading-snug', active ? 'text-primary/80' : 'text-muted-foreground')}>
          {option.description}
        </span>
      </div>
      {active && <Check className="ml-auto size-4 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
}

export function CurateFeedDropdown({ activeTab, onSelect }: CurateFeedDropdownProps) {
  const isCuratedActive = CURATED_IDS.has(activeTab);
  // On narrow screens the nested flyout sub-menus (w-72 opening sideways from a
  // w-72 parent) cannot fit the viewport — the "second menu" lands off-screen
  // and is unreachable. Render the same options as a flat, sectioned list that
  // stays inside the screen instead.
  const isMobile = useIsMobile();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md',
            isCuratedActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Curate feed
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>

      {isMobile ? (
        <DropdownMenuContent align="start" className="w-[min(18rem,calc(100vw-1rem))] max-h-[70dvh] overflow-y-auto">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Social</DropdownMenuLabel>
          {SOCIAL_OPTIONS.map((option) => (
            <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Trending</DropdownMenuLabel>
          {TRENDING_OPTIONS.map((option) => (
            <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Reads</DropdownMenuLabel>
          {READS_OPTIONS.map((option) => (
            <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Topics</DropdownMenuLabel>
          {FEED_TOPICS.filter((topic) => !HIDDEN_TOPIC_IDS.has(topic.id)).map((topic) => (
            <DropdownMenuItem
              key={topic.id}
              className={cn(
                'flex items-start gap-2 py-2 focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
                activeTab === topic.id && 'text-primary',
              )}
              onClick={() => onSelect(topic.id)}
            >
              <span className="shrink-0">{topic.iconSrc ? <img src={topic.iconSrc} alt="" className="size-4 object-contain rounded-sm" /> : topic.icon}</span>
              <div className="flex flex-col items-start min-w-0">
                <span className={cn('text-sm font-medium', activeTab === topic.id && 'text-primary')}>{topic.label}</span>
                {topic.description && (
                  <span className={cn('text-xs leading-snug', activeTab === topic.id ? 'text-primary/80' : 'text-muted-foreground')}>
                    {topic.description}
                  </span>
                )}
              </div>
              {activeTab === topic.id && <Check className="ml-auto size-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      ) : (
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-sm font-medium text-muted-foreground focus:bg-muted focus:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground hover:bg-muted hover:text-foreground">Social</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {SOCIAL_OPTIONS.map((option) => (
              <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-sm font-medium text-muted-foreground focus:bg-muted focus:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground hover:bg-muted hover:text-foreground">Trending</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {TRENDING_OPTIONS.map((option) => (
              <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-sm font-medium text-muted-foreground focus:bg-muted focus:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground hover:bg-muted hover:text-foreground">Reads</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {READS_OPTIONS.map((option) => (
              <OptionItem key={option.id} option={option} activeTab={activeTab} onSelect={onSelect} />
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-sm font-medium text-muted-foreground focus:bg-muted focus:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground hover:bg-muted hover:text-foreground">Topics</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {FEED_TOPICS.filter((topic) => !HIDDEN_TOPIC_IDS.has(topic.id)).map((topic) => (
              <DropdownMenuItem
                key={topic.id}
                className={cn(
                  'flex items-start gap-2 py-2 focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
                  activeTab === topic.id && 'text-primary',
                )}
                onClick={() => onSelect(topic.id)}
              >
                <span className="shrink-0">{topic.iconSrc ? <img src={topic.iconSrc} alt="" className="size-4 object-contain rounded-sm" /> : topic.icon}</span>
                <div className="flex flex-col items-start min-w-0">
                  <span className={cn('text-sm font-medium', activeTab === topic.id && 'text-primary')}>{topic.label}</span>
                  {topic.description && (
                    <span className={cn('text-xs leading-snug', activeTab === topic.id ? 'text-primary/80' : 'text-muted-foreground')}>
                      {topic.description}
                    </span>
                  )}
                </div>
                {activeTab === topic.id && <Check className="ml-auto size-4 shrink-0 text-primary" />}

              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
