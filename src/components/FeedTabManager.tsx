import { ChevronDown, ChevronUp, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { FeedTabLayout } from '@/hooks/useFeedTabLayout';

interface TabDefinition {
  id: string;
  label: string;
}

interface FeedTabManagerProps {
  tabs: TabDefinition[];
  layout: FeedTabLayout;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onReset: () => void;
}

export function FeedTabManager({ tabs, layout, onToggle, onMove, onReset }: FeedTabManagerProps) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const ordered = layout.order.flatMap((id) => byId.get(id) ?? []);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="shrink-0 flex items-center justify-center px-3 py-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          aria-label="Manage feed tabs"
          title="Manage feed tabs"
        >
          <Settings2 className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage feed tabs</DialogTitle>
          <DialogDescription>
            Choose which tabs appear and put them in your preferred order. This layout stays on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 py-2">
          {ordered.map((tab, index) => {
            const visible = !layout.hidden.includes(tab.id);
            return (
              <div key={tab.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Checkbox
                  id={`feed-tab-${tab.id}`}
                  checked={visible}
                  onCheckedChange={() => onToggle(tab.id)}
                  aria-label={`Show ${tab.label} tab`}
                />
                <label htmlFor={`feed-tab-${tab.id}`} className="min-w-0 flex-1 text-sm font-medium cursor-pointer">
                  {tab.label}
                </label>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={index === 0} onClick={() => onMove(tab.id, -1)} aria-label={`Move ${tab.label} earlier`}>
                  <ChevronUp className="size-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={index === ordered.length - 1} onClick={() => onMove(tab.id, 1)} aria-label={`Move ${tab.label} later`}>
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onReset} className="gap-2">
            <RotateCcw className="size-4" />
            Reset layout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
