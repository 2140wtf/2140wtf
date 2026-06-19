/**
 * Filter bar for the BTC Map page.
 * Country select, type select, Lightning/on-chain toggles, search input,
 * and a "locate me" button.
 */

import { MapPin, Search, Zap, Bitcoin, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { COMMON_TYPES, getTypeLabel } from '@/lib/btcmap/discover';
import { getAllCountries } from '@/lib/btcmap/btcmap';

export interface BtcMapFiltersState {
  country: string;
  type: string;
  lightning: boolean;
  onchain: boolean;
  search: string;
}

interface BtcMapFiltersProps {
  filters: BtcMapFiltersState;
  onChange: (filters: BtcMapFiltersState) => void;
  onLocate: () => void;
  locating?: boolean;
}

export function BtcMapFilters({ filters, onChange, onLocate, locating }: BtcMapFiltersProps): React.JSX.Element {
  const countries = getAllCountries();

  const update = <K extends keyof BtcMapFiltersState>(key: K, value: BtcMapFiltersState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex flex-col gap-3 p-3 bg-card/80 backdrop-blur-sm border-b border-border">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 min-w-[140px] flex-1">
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          <Select value={filters.country} onValueChange={(v) => update('country', v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="All countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 min-w-[140px] flex-1">
          <Select value={filters.type} onValueChange={(v) => update('type', v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {COMMON_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{getTypeLabel(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <Switch
              id="btcmap-lightning"
              checked={filters.lightning}
              onCheckedChange={(v) => update('lightning', v)}
            />
            <Label htmlFor="btcmap-lightning" className="text-xs font-normal cursor-pointer">
              Lightning
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Bitcoin className="w-3.5 h-3.5 text-orange-500" />
            <Switch
              id="btcmap-onchain"
              checked={filters.onchain}
              onCheckedChange={(v) => update('onchain', v)}
            />
            <Label htmlFor="btcmap-onchain" className="text-xs font-normal cursor-pointer">
              On-chain
            </Label>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search merchants…"
            value={filters.search}
            onChange={(e) => update('search', e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLocate}
          disabled={locating}
          className="h-9 gap-1.5"
        >
          <LocateFixed className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Locate me</span>
        </Button>
      </div>
    </div>
  );
}
