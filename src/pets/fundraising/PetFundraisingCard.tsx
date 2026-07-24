import { useQuery } from '@tanstack/react-query';
import { HandCoins, Heart, Plus, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchFundraisers } from '@/lib/baoFundraising';
import {
  campaignsForPet,
  parseAgentBody,
  upkeepStatusForCampaigns,
} from '@/lib/petFundraising';
import type { PetsCompanion } from '@/pets/core/lib/pets';

function formatSats(n: number): string {
  return Number(n).toLocaleString();
}

/**
 * Pet upkeep & ₿AO Fund card — shown wherever a single pet is displayed.
 *
 * Lists the pet's ₿AO Fund campaigns (matched via the pet/owner/agent
 * pubkeys — see `src/lib/petFundraising.ts`), shows an upkeep meter derived
 * from the total raised ("⚡ funded for N days"), and deep-links into the
 * ₿AO Fund page for contributing or starting a new raise.
 *
 * DEMO: campaigns run on the bao.markets signet demo API — no real money.
 */
export function PetFundraisingCard({ companion }: { companion: PetsCompanion }) {
  const listQuery = useQuery({
    queryKey: ['bao-fundraisers'],
    queryFn: () => fetchFundraisers(),
    retry: 1,
  });

  const identity = {
    petPubkey: companion.event.pubkey,
    agentPubkey: parseAgentBody(companion.event),
  };

  const campaigns = campaignsForPet(listQuery.data ?? [], identity);
  const upkeep = upkeepStatusForCampaigns(campaigns);
  const totalGoal = campaigns.reduce((sum, f) => sum + (Number(f.goal_sats) || 0), 0);
  const totalRaised = campaigns.reduce((sum, f) => sum + (Number(f.raised_sats) || 0), 0);
  const upkeepPct = totalGoal > 0 ? Math.min(100, Math.round((totalRaised / totalGoal) * 100)) : 0;

  // Prefer deep-linking to an open campaign; fall back to any campaign, then the fund page.
  const supportTarget = campaigns.find((f) => f.status === 'open') ?? campaigns[0];
  const supportHref = supportTarget ? `/bao-fund?campaign=${encodeURIComponent(supportTarget.id)}` : '/bao-fund';
  const createHref = `/bao-fund?create=1&title=${encodeURIComponent(`${companion.name} upkeep`)}`;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <HandCoins className="size-3.5" /> Upkeep &amp; funding
        </p>
        <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-600 border-amber-500/40 dark:text-amber-400">
          DEMO
        </Badge>
      </div>

      {listQuery.isLoading ? (
        <Skeleton className="h-10 w-full rounded-md" />
      ) : listQuery.isError ? (
        <p className="text-xs text-muted-foreground">
          Can't reach the ₿AO Fund demo API right now.
        </p>
      ) : (
        <>
          {/* Upkeep meter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1 font-medium">
                <Zap className="size-3.5 text-amber-500" />
                {upkeep.label}
              </span>
              {campaigns.length > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatSats(totalRaised)} / {formatSats(totalGoal)} sats
                </span>
              )}
            </div>
            {campaigns.length > 0 && <Progress value={upkeepPct} className="h-2" />}
          </div>

          {/* Campaign list */}
          {campaigns.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No ₿AO Fund campaigns for {companion.name} yet. Start one so this pet can pay its own upkeep.
            </p>
          ) : (
            <div className="space-y-2">
              {campaigns.map((f) => {
                const pct = Math.min(100, Math.round((Number(f.raised_sats) / Number(f.goal_sats)) * 100));
                return (
                  <div key={f.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{f.title}</span>
                      <Badge variant={f.status === 'open' ? 'outline' : 'secondary'} className="capitalize text-[10px] px-1 py-0 shrink-0">
                        {f.status}
                      </Badge>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatSats(Number(f.raised_sats))} / {formatSats(Number(f.goal_sats))} sats · {pct}%
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* CTAs */}
          <div className="flex gap-2">
            <Button asChild size="sm" className="flex-1 gap-1.5">
              <Link to={supportHref}>
                <Heart className="size-3.5" /> Support this pet
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="flex-1 gap-1.5">
              <Link to={createHref}>
                <Plus className="size-3.5" /> Start a fundraiser
              </Link>
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            ₿AO Fund runs on the bao.markets signet demo — no real money.
          </p>
        </>
      )}
    </div>
  );
}
