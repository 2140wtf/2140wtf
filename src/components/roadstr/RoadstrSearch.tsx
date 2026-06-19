import { Search, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGeocode } from '@/components/roadstr/useGeocode';
import { MAP_STYLE_LABELS, type MapStyle } from '@/components/roadstr/roadstrTypes';

interface RoadstrSearchProps {
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
  onFlyTo: (lat: number, lon: number) => void;
}

export function RoadstrSearch({ mapStyle, onMapStyleChange, onFlyTo }: RoadstrSearchProps): React.JSX.Element {
  const { query, setQuery, results, isLoading } = useGeocode();

  const handleSelect = (lat: number, lon: number) => {
    onFlyTo(lat, lon);
    setQuery('');
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder="Search location…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 pr-9 h-9 text-sm"
          aria-label="Search location"
        />
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
        )}

        {results.length > 0 && query.trim() && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-md py-1 max-h-60 overflow-auto">
            {results.map((result, index) => (
              <button
                key={`${result.lat}-${result.lon}-${index}`}
                type="button"
                onClick={() => handleSelect(result.lat, result.lon)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none truncate"
              >
                {result.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <Select value={mapStyle} onValueChange={(value) => onMapStyleChange(value as MapStyle)}>
        <SelectTrigger className="w-full sm:w-32 h-9 text-sm" aria-label="Map style">
          <SelectValue placeholder="Style" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(MAP_STYLE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
