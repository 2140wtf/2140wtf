import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Landmark, Globe, Users, Star, Plus, Check, ChevronDown, ChevronUp, ShieldCheck, Pencil, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useToast } from '@/hooks/useToast';
import {
  useMintDiscovery,
  useMintInfo,
  useMintAuditInfo,
  useSmartMintSelection,
  usePublishMintRecommendation,
  type SmartMintOption,
} from '@/hooks/useMintDiscovery';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import { openUrl } from '@/lib/downloadFile';
import { useQueryClient } from '@tanstack/react-query';

function NutBadge({ nut }: { nut: number }) {
  return (
    <Badge variant="outline" className="text-xs font-mono">
      NUT-{nut}
    </Badge>
  );
}

function MintInfoPanel({ url }: { url: string }) {
  const { data, isLoading, error } = useMintInfo(url);
  const audit = useMintAuditInfo(url);

  if (isLoading) {
    return (
      <div className="space-y-2 pt-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-destructive pt-2">Could not load mint info.</p>;
  }

  const info = data as {
    name?: string;
    description?: string;
    description_long?: string;
    version?: string;
    motd?: string;
    contact?: Array<{ method?: string; info?: string }>;
    nuts?: Record<string, { methods?: Array<{ method?: string; unit?: string }> }>;
  };
  const supportedNuts = Object.keys(info.nuts ?? {})
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0);
  const contacts = Array.isArray(info.contact)
    ? info.contact.filter((contact) => typeof contact?.method === 'string' && typeof contact?.info === 'string').slice(0, 8)
    : [];
  const units = [...new Set(
    Object.values(info.nuts ?? {}).flatMap((nut) => nut.methods ?? []).map((method) => method.unit).filter((unit): unit is string => typeof unit === 'string'),
  )];
  const methods = [...new Set(
    Object.values(info.nuts ?? {}).flatMap((nut) => nut.methods ?? []).map((method) => method.method).filter((method): method is string => typeof method === 'string'),
  )];

  return (
    <div className="space-y-2 pt-2">
      {info.name && <p className="font-semibold text-sm">{info.name}</p>}
      {info.motd && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Mint message</p>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">{info.motd}</p>
        </div>
      )}
      {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}
      {info.description_long && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{info.description_long}</p>}
      {info.version && <p className="text-xs text-muted-foreground font-mono">v{info.version}</p>}
      {(units.length > 0 || methods.length > 0) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {units.length > 0 && <><dt className="text-muted-foreground">Currencies</dt><dd>{units.map((unit) => unit.toUpperCase()).join(', ')}</dd></>}
          {methods.length > 0 && <><dt className="text-muted-foreground">Payments</dt><dd>{methods.map((method) => method.toUpperCase()).join(', ')}</dd></>}
        </dl>
      )}
      {contacts.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium">Contact</p>
          {contacts.map((contact, index) => (
            <p key={`${contact.method}-${index}`} className="text-xs break-all">
              <span className="text-muted-foreground">{contact.method}:</span> {contact.info}
            </p>
          ))}
        </div>
      )}
      {supportedNuts.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {supportedNuts.slice(0, 12).map((nut) => (
            <NutBadge key={nut} nut={nut} />
          ))}
        </div>
      )}
      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Independent audit</p>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openUrl('https://audit.8333.space')}>
            audit.8333.space
          </Button>
        </div>
        {audit.isLoading && <Skeleton className="h-16 w-full" />}
        {!audit.isLoading && audit.data === null && (
          <p className="text-xs text-muted-foreground">This mint has not been observed by the auditor yet.</p>
        )}
        {audit.error && (
          <p className="text-xs text-muted-foreground">Audit information is temporarily unavailable.</p>
        )}
        {audit.data && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground">Success rate</p>
                <p className="text-xl font-semibold">{audit.data.successRate}%</p>
                <p className="text-[11px] text-muted-foreground">{audit.data.successfulSwaps} of {audit.data.swaps.length} swaps</p>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground">Average time</p>
                <p className="text-xl font-semibold">
                  {audit.data.averageTimeMs === null ? 'N/A' : audit.data.averageTimeMs < 10_000
                    ? `${Math.round(audit.data.averageTimeMs)} ms`
                    : `${(audit.data.averageTimeMs / 1000).toFixed(1)} s`}
                </p>
                <p className="text-[11px] text-muted-foreground">Successful swaps</p>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Third-party observations are informational and do not guarantee safety, solvency, or trustworthiness.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {Array.from({ length: 5 }).map((_, i) => {
        const rating = i + 1;
        const filled = rating <= value;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`${rating} star${rating === 1 ? '' : 's'}`}
            onClick={() => onChange(rating)}
            className="p-1 rounded hover:bg-secondary transition-colors"
          >
            <Star className={`size-6 ${filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
          </button>
        );
      })}
    </div>
  );
}

function MintReviewDialog({
  option,
  open,
  onOpenChange,
}: {
  option: SmartMintOption | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { publishReview, isPending } = usePublishMintRecommendation();
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');

  const handleSubmit = async () => {
    if (!option?.announcement) return;
    if (rating < 1 || rating > 5) {
      toast({ variant: 'destructive', title: 'Rating required', description: 'Pick a 1–5 star rating.' });
      return;
    }

    try {
      await publishReview({
        mintId: option.announcement.mintId,
        mintUrl: option.announcement.mintUrl,
        announcementCoordinate: `${option.announcement.event.kind}:${option.announcement.event.pubkey}:${option.announcement.mintId}`,
        rating,
        content,
      });
      toast({ title: 'Review published', description: 'Your mint recommendation is live.' });
      setRating(0);
      setContent('');
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['cashu-mint-discovery'] });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Publish failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open && !isPending) {
      setRating(0);
      setContent('');
    }
    onOpenChange(open);
  };

  if (!option) return null;
  const displayName = typeof option.announcement?.metadata?.name === 'string'
    ? option.announcement.metadata.name
    : option.url;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review mint</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <StarRating value={rating} onChange={setRating} />
          <Textarea
            placeholder="Why do you recommend (or not recommend) this mint?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || rating < 1}>
            {isPending ? 'Publishing…' : 'Publish review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MintCard({
  option,
  isAdded,
  onAdd,
  onReview,
}: {
  option: SmartMintOption;
  isAdded: boolean;
  onAdd: (url: string) => void;
  onReview: (option: SmartMintOption) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { announcement, recommendations, hasBalance } = option;
  const avgRating =
    recommendations.length > 0
      ? recommendations.reduce((sum, r) => sum + (r.rating ?? 0), 0) / recommendations.length
      : 0;

  const displayName = typeof announcement?.metadata?.name === 'string' ? announcement.metadata.name : option.url;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate" title={displayName}>
              {displayName}
            </CardTitle>
            <p className="text-xs text-muted-foreground truncate" title={option.url}>
              {option.url}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {announcement && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onReview(option)}>
                <Pencil className="size-3.5" />
                Review
              </Button>
            )}
            <Button
              size="sm"
              variant={isAdded ? 'secondary' : 'default'}
              disabled={isAdded}
              onClick={() => onAdd(option.url)}
              className="gap-1"
            >
              {isAdded ? <Check className="size-4" /> : <Plus className="size-4" />}
              {isAdded ? 'Added' : 'Add'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {announcement?.network === 'mainnet' && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <ShieldCheck className="size-3" />
              mainnet
            </Badge>
          )}
          {announcement?.network && announcement.network !== 'mainnet' && (
            <Badge variant="outline" className="text-xs">
              {announcement.network}
            </Badge>
          )}
          {hasBalance && (
            <Badge className="gap-1 text-xs">
              <Check className="size-3" />
              balance
            </Badge>
          )}
          {recommendations.length > 0 && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Users className="size-3" />
              {recommendations.length} rec{recommendations.length === 1 ? '' : 's'}
            </Badge>
          )}
          {avgRating > 0 && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Star className="size-3" />
              {avgRating.toFixed(1)}
            </Badge>
          )}
          {announcement?.nuts.slice(0, 5).map((nut) => (
            <NutBadge key={nut} nut={nut} />
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Button variant="ghost" size="sm" className="gap-1 -ml-2 h-8" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {expanded ? 'Hide details' : 'Show details'}
        </Button>
        {expanded && <MintInfoPanel url={option.url} />}
      </CardContent>
    </Card>
  );
}

export function MintDiscoveryPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const wallet = useCashuWalletContext();
  const [global, setGlobal] = useState(true);
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState<SmartMintOption | null>(null);

  const discovery = useMintDiscovery({ global });
  const userMintUrls = wallet.allMints.map((m) => m.url);
  const ranked = useSmartMintSelection(discovery.data, userMintUrls);
  const addedUrls = new Set(userMintUrls.map((u) => u.toLowerCase()));
  const normalizedSearch = search.trim().toLowerCase();
  const searchedMintUrl = safeNormalizeMintUrl(search);
  const filtered = normalizedSearch
    ? ranked.filter((option) => {
        const metadata = option.announcement?.metadata;
        const searchable = [
          option.url,
          typeof metadata?.name === 'string' ? metadata.name : '',
          typeof metadata?.description === 'string' ? metadata.description : '',
          option.announcement?.network ?? '',
          ...option.announcement?.nuts.map((nut) => `nut-${nut}`) ?? [],
        ];
        return searchable.some((value) => value.toLowerCase().includes(normalizedSearch));
      })
    : ranked;
  const searchResults = searchedMintUrl && !filtered.some((option) => option.url.toLowerCase() === searchedMintUrl.toLowerCase())
    ? [{ url: searchedMintUrl, announcement: undefined, recommendations: [], hasBalance: addedUrls.has(searchedMintUrl.toLowerCase()), score: 0 }, ...filtered]
    : filtered;

  useSeoMeta({
    title: `Mint Discovery | ${config.appName}`,
    description: 'Discover and review recommended Cashu mints on Nostr.',
  });

  const handleAdd = (url: string) => {
    const normalized = safeNormalizeMintUrl(url);
    if (!normalized) return;
    wallet.addCustomMint(normalized, normalized);
    toast({ title: 'Mint added', description: normalized });
  };

  if (!user) {
    return (
      <main>
        <PageHeader title="Mint Discovery" icon={<Landmark className="size-5" />} backTo="/wallet" />
        <div className="py-20 px-8 flex flex-col items-center gap-6 text-center">
          <div className="p-4 rounded-full bg-primary/10">
            <Landmark className="size-8 text-primary" />
          </div>
          <div className="space-y-2 max-w-xs">
            <h2 className="text-xl font-bold">Discover Cashu Mints</h2>
            <p className="text-muted-foreground text-sm">Log in to browse NIP-87 mint announcements and recommendations.</p>
          </div>
          <LoginArea className="max-w-60" />
        </div>
      </main>
    );
  }

  return (
    <main className="pb-12">
      <PageHeader title="Mint Discovery" icon={<Landmark className="size-5" />} backTo="/wallet" />

      <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by mint name, URL, network, or NUT…"
            aria-label="Search Cashu mints"
            className="pl-9 pr-10"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
              onClick={() => setSearch('')}
              aria-label="Clear mint search"
            >
              <X className="size-4" />
            </Button>
          )}
          {searchedMintUrl && !ranked.some((option) => option.url.toLowerCase() === searchedMintUrl.toLowerCase()) && (
            <p className="mt-2 text-xs text-muted-foreground">
              This URL is not in the community results. Check its mint details before adding it.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Discovery scope</p>
            <p className="text-xs text-muted-foreground">
              {global ? 'Showing mints from everyone.' : 'Showing mints recommended by people you follow.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <Switch
              id="mint-discovery-global"
              checked={global}
              onCheckedChange={setGlobal}
              aria-label="Toggle global mint discovery"
            />
            <Globe className="size-4 text-muted-foreground" />
          </div>
        </div>

        {discovery.isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-3 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!discovery.isLoading && searchResults.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <p className="text-muted-foreground max-w-sm mx-auto">
                {normalizedSearch
                  ? 'No mints match that search. Paste a full HTTPS mint URL to inspect and add it.'
                  : 'No Cashu mints found. Try switching to global discovery or check your relay connections.'}
              </p>
            </CardContent>
          </Card>
        )}

        {searchResults.length > 0 && (
          <div className="space-y-4">
            {searchResults.map((option) => (
              <MintCard
                key={option.url}
                option={option}
                isAdded={addedUrls.has(option.url.toLowerCase())}
                onAdd={handleAdd}
                onReview={setReviewing}
              />
            ))}
          </div>
        )}

        <MintReviewDialog option={reviewing} open={!!reviewing} onOpenChange={(open) => !open && setReviewing(null)} />

        <div className="text-center pt-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/wallet">Back to wallet</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
