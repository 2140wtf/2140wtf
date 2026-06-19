import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface JoinGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoin: (event: NostrEvent) => Promise<void>;
}

export function JoinGroupDialog({ open, onOpenChange, onJoin }: JoinGroupDialogProps) {
  const [rawEvent, setRawEvent] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleJoin = async () => {
    setParseError(null);
    if (!rawEvent.trim() || isJoining) return;

    let event: NostrEvent;
    try {
      const trimmed = rawEvent.trim();
      if (trimmed.length > 512 * 1024) throw new Error('Event JSON is too large');
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid JSON');
      event = parsed as NostrEvent;
      if (
        typeof event.id !== 'string' ||
        typeof event.pubkey !== 'string' ||
        typeof event.sig !== 'string' ||
        typeof event.kind !== 'number' ||
        typeof event.content !== 'string' ||
        typeof event.created_at !== 'number' ||
        !Array.isArray(event.tags) ||
        !event.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))
      ) {
        throw new Error('Invalid event shape');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid event JSON');
      return;
    }

    setIsJoining(true);
    try {
      await onJoin(event);
      setRawEvent('');
      onOpenChange(false);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Join Private Group</DialogTitle>
          <DialogDescription>
            Paste a Welcome gift-wrap event (kind 1059) you received from a group admin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="welcome-event">Welcome event JSON</Label>
            <Textarea
              id="welcome-event"
              value={rawEvent}
              onChange={(e) => setRawEvent(e.target.value)}
              placeholder='{"kind":1059,"content":"...","tags":[["p","..."]],...}'
              rows={8}
              className="font-mono text-xs"
            />
            {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          </div>
          <Button
            onClick={() => void handleJoin()}
            disabled={isJoining || !rawEvent.trim()}
            className="w-full"
          >
            {isJoining ? 'Joining…' : 'Join Group'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
