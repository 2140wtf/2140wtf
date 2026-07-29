import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, HandCoins, Loader2, Plus, Download, Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { fetchFundraiser } from '@/lib/baoFundraising';
import type { CommunityMetadata, CommunityV2 } from '@/concord-v2/lib/types';
import { useMetadataActions2 } from '@/concord-v2/hooks/useRoles2';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/** Extract a fundraiser id from a pasted id or bao.markets URL. */
function parseFundraiserId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/fundraiser[s]?\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

interface FundView2Props {
  community: CommunityV2;
  metadata: CommunityMetadata | undefined;
  /** Owner/managers may start, import, or unlink the fundraiser. */
  canManage: boolean;
}

/**
 * The community's Fund pane: its linked ₿AO Fund campaign when one exists,
 * otherwise owner actions to start a new fundraiser (pre-filled with the
 * community name + repo) or import an existing one by id/URL. The link lives
 * in community metadata (`fund_id`) so every member folds the same view.
 */
export function FundView2({ community, metadata, canManage }: FundView2Props) {
  const { updateMetadata, isUpdating } = useMetadataActions2(community);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const fundId = metadata?.fund_id;
  const fundQuery = useQuery({
    queryKey: ['bao-fundraiser', fundId],
    queryFn: () => fetchFundraiser(fundId!),
    enabled: !!fundId,
    retry: 1,
  });

  const handleImport = async () => {
    const id = parseFundraiserId(importValue);
    if (!id) {
      setImportError('Paste a fundraiser id or a bao.markets fundraiser URL.');
      return;
    }
    setImportError(null);
    try {
      await fetchFundraiser(id);
    } catch {
      setImportError('No fundraiser found with that id.');
      return;
    }
    await updateMetadata({ fund_id: id });
    setImportOpen(false);
    setImportValue('');
  };

  if (!fundId) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <Card className="border-dashed max-w-md mx-auto mt-8">
          <CardContent className="py-10 px-6 text-center space-y-4">
            <HandCoins className="size-8 mx-auto text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="font-medium">No fundraiser linked</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {canManage
                  ? 'Start a fundraiser for this community, or import an existing one — it will show up here for every member.'
                  : 'The community owner has not linked a fundraiser yet.'}
              </p>
            </div>
            {canManage && (
              <div className="flex flex-col gap-2">
                <Button asChild className="gap-1.5">
                  <Link
                    to={`/bao-fund?create=1&title=${encodeURIComponent(community.name)}${metadata?.repo ? `&repo=${encodeURIComponent(metadata.repo)}` : ''}`}
                  >
                    <Plus className="size-4" /> Start funding
                  </Link>
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => setImportOpen((v) => !v)}>
                  <Download className="size-4" /> Import fundraiser
                </Button>
                {importOpen && (
                  <div className="space-y-2 pt-1">
                    <Input
                      value={importValue}
                      onChange={(e) => setImportValue(e.target.value)}
                      placeholder="Fundraiser id or bao.markets URL"
                      className="text-sm"
                    />
                    {importError && <p className="text-xs text-destructive">{importError}</p>}
                    <Button size="sm" onClick={handleImport} disabled={isUpdating || !importValue.trim()}>
                      {isUpdating ? <Loader2 className="size-4 animate-spin" /> : 'Link fundraiser'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const f = fundQuery.data?.fundraiser;
  const pct = f ? Math.min(100, Math.round((Number(f.raised_sats) / Math.max(1, Number(f.goal_sats))) * 100)) : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <Card className="max-w-md mx-auto mt-4">
        <CardContent className="py-6 px-6 space-y-4">
          {fundQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : fundQuery.isError || !f ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                The linked fundraiser could not be loaded (id <code className="text-xs">{fundId}</code>).
              </p>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => updateMetadata({ fund_id: null })} disabled={isUpdating}>
                  <Unlink className="size-3.5 mr-1.5" /> Unlink
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">{f.status}</p>
                </div>
                <Badge variant={f.status === 'open' ? 'default' : 'secondary'} className="capitalize shrink-0">
                  {f.status}
                </Badge>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatSats(Number(f.raised_sats))} raised</span>
                  <span>{formatSats(Number(f.goal_sats))} sats goal</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button asChild className="gap-1.5">
                  <Link to={`/bao-fund?campaign=${encodeURIComponent(f.id)}`}>
                    <ExternalLink className="size-4" /> Open in ₿AO Fund
                  </Link>
                </Button>
                {canManage && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => updateMetadata({ fund_id: null })} disabled={isUpdating}>
                    <Unlink className="size-3.5 mr-1.5" /> Unlink fundraiser
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
