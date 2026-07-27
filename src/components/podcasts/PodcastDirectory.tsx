import { Check, Copy, ExternalLink, Rss, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePodcastSearch, type PodcastEntry } from '@/hooks/usePodcastDirectory';
import { cn } from '@/lib/utils';

/** Default search when the box is empty — the audience lands on Bitcoin shows. */
const DEFAULT_TERM = 'bitcoin';

const QUICK_TERMS = [
  'bitcoin',
  'nostr',
  'freedom tech',
  'news',
  'comedy',
  'technology',
  'business',
  'history',
];

function PodcastCard({ podcast }: { podcast: PodcastEntry }) {
  const [copied, setCopied] = useState(false);

  const copyFeed = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!podcast.feedUrl) return;
    navigator.clipboard.writeText(podcast.feedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <a
      href={podcast.link ?? podcast.feedUrl}
      target='_blank'
      rel='noopener noreferrer'
      className='group block rounded-xl border bg-card p-3 transition-colors hover:border-primary/40'
    >
      <div className='relative'>
        {podcast.artwork ? (
          <img
            src={podcast.artwork}
            alt=''
            loading='lazy'
            className='aspect-square w-full rounded-lg object-cover bg-muted'
          />
        ) : (
          <div className='aspect-square w-full rounded-lg bg-muted flex items-center justify-center'>
            <Rss className='size-8 text-muted-foreground/50' />
          </div>
        )}
        {podcast.feedUrl && (
          <button
            type='button'
            onClick={copyFeed}
            title='Copy RSS feed URL'
            aria-label='Copy RSS feed URL'
            className='absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-primary group-hover:opacity-100 focus:opacity-100'
          >
            {copied ? <Check className='size-3.5 text-green-500' /> : <Copy className='size-3.5' />}
          </button>
        )}
      </div>
      <div className='mt-2 space-y-0.5'>
        <h3 className='line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary transition-colors'>
          {podcast.title}
        </h3>
        <p className='line-clamp-1 text-xs text-muted-foreground'>{podcast.author}</p>
        {podcast.genre && (
          <p className='line-clamp-1 text-[10px] text-muted-foreground/70'>{podcast.genre}</p>
        )}
      </div>
    </a>
  );
}

/**
 * Podcast directory backed by the iTunes Search API — full-catalog discovery
 * to complement the (still tiny) set of Nostr-native podcast lists.
 */
export function PodcastDirectory() {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState(DEFAULT_TERM);

  // Debounce free-text searches; chip clicks set the term immediately.
  useEffect(() => {
    const trimmed = input.trim();
    const handle = setTimeout(() => {
      setTerm(trimmed || DEFAULT_TERM);
    }, 400);
    return () => clearTimeout(handle);
  }, [input]);

  const { data: podcasts, isLoading, isError } = usePodcastSearch(term);

  return (
    <div className='space-y-3 px-4 py-3'>
      <div className='relative'>
        <Search className='absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Search podcasts…'
          className='h-9 pl-8 text-sm'
        />
      </div>

      <div className='flex flex-wrap gap-1.5'>
        {QUICK_TERMS.map((quick) => (
          <button
            key={quick}
            type='button'
            onClick={() => {
              setInput('');
              setTerm(quick);
            }}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors',
              term === quick && !input.trim()
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {quick}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className='space-y-2'>
              <Skeleton className='aspect-square w-full rounded-lg' />
              <Skeleton className='h-4 w-4/5' />
              <Skeleton className='h-3 w-3/5' />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className='py-8 text-center text-sm text-muted-foreground'>
          Couldn’t load the podcast directory. Check your connection and try again.
        </p>
      ) : podcasts && podcasts.length > 0 ? (
        <>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
            {podcasts.map((podcast) => (
              <PodcastCard key={podcast.id} podcast={podcast} />
            ))}
          </div>
          <p className='flex items-center justify-center gap-1 pt-1 text-[10px] text-muted-foreground/70'>
            Directory: Apple Podcasts
            <ExternalLink className='size-2.5' />
          </p>
        </>
      ) : (
        <p className='py-8 text-center text-sm text-muted-foreground'>
          No podcasts found for “{term}”.
        </p>
      )}
    </div>
  );
}
