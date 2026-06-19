import { useMemo, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { encodeGeohash } from '@/lib/geohash';
import { isRoadstrEventType, ROADSTR_EVENT_TYPES, type RoadstrEventType } from '@/components/roadstr/roadstrTypes';

interface RoadstrReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, use this location; otherwise the dialog acquires it on submit. */
  location?: { lat: number; lon: number } | null;
}

/** Relay-side NIP-40 expiration for all Roadstr events (14 days). */
const EXPIRATION_SECONDS = 14 * 24 * 60 * 60;

/**
 * Lightweight dialog to publish a kind 1315 Roadstr report.
 *
 * If no location is provided, the dialog reads the browser's current GPS
 * position when the user submits. This avoids constant location polling.
 */
export function RoadstrReportDialog({
  open,
  onOpenChange,
  location,
}: RoadstrReportDialogProps): React.JSX.Element {
  const { user } = useCurrentUser();
  const { mutate: publishEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();
  const [type, setType] = useState<RoadstrEventType>('other');
  const [comment, setComment] = useState('');
  const [locating, setLocating] = useState(false);

  const typeOptions = useMemo(
    () => Object.entries(ROADSTR_EVENT_TYPES).map(([value, config]) => ({ value: value as RoadstrEventType, ...config })),
    [],
  );

  const handleSubmit = () => {
    if (!user) {
      toast({ title: 'Log in to report road events' });
      return;
    }
    if (!isEnabled('roadstr')) {
      toast({ title: 'Roadstr publishing disabled', description: 'Turn on “Roadstr” in Settings → Privacy & Publishing to submit Roadstr reports.' });
      return;
    }

    const publishAtLocation = (lat: number, lon: number) => {
      const createdAt = Math.floor(Date.now() / 1000);
      const expiration = createdAt + EXPIRATION_SECONDS;
      const cfg = ROADSTR_EVENT_TYPES[type];

      const tags: string[][] = [
        ['t', type],
        ['g', encodeGeohash(lat, lon, 4)],
        ['g', encodeGeohash(lat, lon, 5)],
        ['g', encodeGeohash(lat, lon, 6)],
        ['lat', lat.toFixed(7)],
        ['lon', lon.toFixed(7)],
        ['expiration', String(expiration)],
        ['alt', `Roadstr: ${cfg.label.toLowerCase()} report`],
      ];

      publishEvent(
        {
          kind: 1315,
          content: comment.trim(),
          tags,
          created_at: createdAt,
        },
        {
          onSuccess: () => {
            toast({ title: 'Road event reported' });
            setComment('');
            setType('other');
            onOpenChange(false);
          },
          onError: () => {
            toast({ title: 'Failed to report road event', variant: 'destructive' });
          },
        },
      );
    };

    if (location) {
      publishAtLocation(location.lat, location.lon);
      return;
    }

    if (!navigator.geolocation) {
      toast({ title: 'Geolocation is not available', variant: 'destructive' });
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        publishAtLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        toast({ title: 'Could not get your location', variant: 'destructive' });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const selectedConfig = ROADSTR_EVENT_TYPES[type];
  const SelectedIcon = selectedConfig.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-5" />
            Report road event
          </DialogTitle>
          <DialogDescription>
            Publish a decentralized Roadstr report to your relays.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-2 block">Event type</label>
            <ToggleGroup
              type="single"
              value={type}
              onValueChange={(value) => {
                if (isRoadstrEventType(value)) setType(value);
              }}
              className="flex flex-wrap justify-start gap-2"
            >
              {typeOptions.map(({ value, label, icon: Icon, color }) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  aria-label={label}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 h-auto data-[state=on]:border-primary data-[state=on]:ring-1 data-[state=on]:ring-primary"
                  style={{ '--type-color': color } as React.CSSProperties}
                >
                  <Icon className="size-4" style={{ color }} />
                  <span className="text-xs">{label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SelectedIcon className="size-4" style={{ color: selectedConfig.color }} />
            <span>{location ? `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}` : 'Current location will be used'}</span>
          </div>

          <div>
            <label htmlFor="roadstr-comment" className="text-sm font-medium mb-2 block">
              Comment (optional)
            </label>
            <Textarea
              id="roadstr-comment"
              placeholder="e.g. checking seatbelts, lane closed…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending || locating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || locating}>
            {(isPending || locating) && <Loader2 className="mr-2 size-4 animate-spin" />}
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
