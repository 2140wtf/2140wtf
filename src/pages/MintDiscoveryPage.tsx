import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Landmark, Globe, Users, Star, Plus, Check, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/PageHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useToast } from '@/hooks/useToast';
import { useMintDiscovery, useMintInfo, useSmartMintSelection, type SmartMintOption } from '@/hooks/useMintDiscovery';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';

function NutBadge({ nut }: { nut: number }) {
  return (
    <Badge variant="outline" className="text-xs font-mono">
      NUT-{nut}
    </Badge>
  );
}

function MintInfoPanel({ url }: { url: string }) {
  const { data, isLoading, error } = useMintInfo(url);

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

  const info = data as { name?: string; description?: string; version?: string; nuts?: Record<string, unknown> };
  const supportedNuts = Object.keys(info.nuts ?? {})
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0);

  return (
    <div className="space-y-2 pt-2">
      {info.name && <p className="font-semibold text-sm">{info.name}</p>}
      {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}
      {info.version && <p className="text-xs text-muted-foreground font-mono">v{info.version}</p>}
      {supportedNuts.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {supportedNuts.slice(0, 12).map((nut) => (
            <NutBadge key={nut} nut={nut} />
          ))}
        </div>
      )}
    </div>
  );
}

function MintCard({
  option,
  isAdded,
  onAdd,
}: {
  option: SmartMintOption;
  isAdded: boolean;
  onAdd: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { announcement, recommendations, hasBalance } = option;
  const avgRating =
    recommendations.length > 0
      ? recommendations.reduce((sum, r) => sum + (r.rating ?? 0), 0) / recommendations.length
      : 0;

  const displayName = (announcement?.metadata?.name as string | undefined) || option.url;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate" title={displayName as string}>
              {displayName as string}
            </CardTitle>
            <p className="text-xs text-muted-foreground truncate" title={option.url}>
              {option.url}
            </p>
          </div>
          <Button
            size="sm"
            variant={isAdded ? 'secondary' : 'default'}
            disabled={isAdded}
            onClick={() => onAdd(option.url)}
            className="shrink-0 gap-1"
          >
            {isAdded ? <Check className="size-4" /> : <Plus className="size-4" />}
            {isAdded ? 'Added' : 'Add'}
          </Button>
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
  const [global, setGlobal] = useState(false);

  const discovery = useMintDiscovery({ global });
  const userMintUrls = wallet.allMints.map((m) => m.url);
  const ranked = useSmartMintSelection(discovery.data, userMintUrls);
  const addedUrls = new Set(userMintUrls.map((u) => u.toLowerCase()));

  useSeoMeta({
    title: `Mint Discovery | ${config.appName}`,
    description: 'Discover recommended Cashu mints on Nostr.',
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

        {!discovery.isLoading && ranked.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 px-8 text-center">
              <p className="text-muted-foreground max-w-sm mx-auto">
                No Cashu mints found. Try switching to global discovery or check your relay connections.
              </p>
            </CardContent>
          </Card>
        )}

        {ranked.length > 0 && (
          <div className="space-y-4">
            {ranked.map((option) => (
              <MintCard
                key={option.url}
                option={option}
                isAdded={addedUrls.has(option.url.toLowerCase())}
                onAdd={handleAdd}
              />
            ))}
          </div>
        )}

        <div className="text-center pt-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/wallet">Back to wallet</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
