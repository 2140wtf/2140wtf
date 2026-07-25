import { useState } from 'react';
import { ChevronDown, ShieldCheck, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RelayListEditor } from '@/components/RelayListEditor';
import { cn } from '@/lib/utils';

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, description?: string, relays?: string[]) => Promise<void>;
  /** Servers the group will use unless the creator picks their own. */
  defaultRelays: string[];
}

export function CreateGroupDialog({ open, onOpenChange, onCreate, defaultRelays }: CreateGroupDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [relaysOpen, setRelaysOpen] = useState(false);
  const [relays, setRelays] = useState<string[] | null>(null);
  const effectiveRelays = relays ?? defaultRelays;

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isCreating) return;
    setIsCreating(true);
    try {
      await onCreate(trimmedName, description.trim() || undefined, relays ?? undefined);
      setName('');
      setDescription('');
      setRelays(null);
      onOpenChange(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Users className="size-4 text-primary" />
            </div>
            Create Private Group
          </DialogTitle>
          <DialogDescription>
            Create an encrypted group chat. You will be the first admin and can invite others.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bitcoin Builders"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-description">Description (optional)</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              maxLength={256}
              rows={3}
            />
          </div>

          <Collapsible open={relaysOpen} onOpenChange={setRelaysOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn('size-4 transition-transform', relaysOpen && 'rotate-180')} />
                Servers carrying this group ({effectiveRelays.length})
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <div className="pt-2">
                <RelayListEditor
                  relays={effectiveRelays}
                  onChange={setRelays}
                  onReset={defaultRelays.length > 0 ? () => setRelays(defaultRelays) : undefined}
                  emptyText="Add at least one server to carry this group."
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              What stays private — and what doesn't
            </p>
            <p>
              Nobody can read your messages or see who is in the group — not even the servers
              carrying it.
            </p>
            <p>
              The servers you picked <em>can</em> see that this group exists, when messages are
              sent, and roughly how many people are writing. Pick servers you trust.
            </p>
            <p>
              Want everything hidden, even that? Use <strong>₿AO Groups</strong> instead — fully
              sealed communities where servers see nothing at all.
            </p>
          </div>

          <Button
            onClick={() => void handleCreate()}
            disabled={isCreating || !name.trim() || effectiveRelays.length === 0}
            className="w-full"
          >
            {isCreating ? 'Creating…' : 'Create Group'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
