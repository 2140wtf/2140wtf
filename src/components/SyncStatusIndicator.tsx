import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useSyncTasks } from "@/hooks/useSyncActivity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A quiet passive sync indicator: a small spinning dot anchored in the corner
 * of the channel/server icon while a background catch-up is in flight. It
 * replaces the old full-width inline "Syncing #general…" bar, which nagged
 * over otherwise-usable chat.
 *
 * Reads the sync-activity task list (see src/lib/syncActivity.ts): the first
 * task names the work, further concurrent tasks collapse into a "+n". When
 * `priorityScope` is given (the conversation on screen), a task for that
 * conversation is surfaced ahead of unrelated background work.
 *
 * The whole thing is a click/tap-to-open Popover (not a hover-only tooltip),
 * so the "what's syncing" detail is reachable on touch — mirroring the app's
 * other passive info affordances (e.g. the DM legacy/best-effort badges).
 * Delayed (house useDelayedFlag pattern) so routine sub-second syncs never
 * flash it — only a genuinely slow catch-up paints.
 *
 * Visibility policy (whether to render at all) is the parent's call; this
 * component only decides whether there's live work worth surfacing.
 */
export function SyncStatusIndicator({
  className,
  priorityScope,
}: {
  className?: string;
  /** Wire-bus scope of the conversation on screen (e.g. `c2:<channelIdHex>`). */
  priorityScope?: string;
}) {
  const tasks = useSyncTasks();
  const shown = useDelayedFlag(tasks.length > 0, 700);

  if (!shown || tasks.length === 0) return null;
  const task = (priorityScope && tasks.find((t) => t.scope === priorityScope)) || tasks[0];
  const more = tasks.length - 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-chrome p-0.5 text-muted-foreground hover:text-foreground select-none",
            className,
          )}
          aria-label="Syncing. Tap for details."
        >
          {/* Pure-CSS border spinner (not a lucide SVG): a rotated SVG bitmap
              smears/blurs at this size, a spun border circle stays crisp. */}
          <span
            className="size-2.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-64 p-3 text-xs font-normal text-muted-foreground">
        <span className="text-foreground font-medium">
          Syncing {task.label}
          {task.detail ? ` — ${task.detail}` : "…"}
        </span>
        {more > 0 && (
          <span className="mt-1 block">
            …and {more} more {more === 1 ? "conversation" : "conversations"} catching up in the
            background.
          </span>
        )}
      </PopoverContent>
    </Popover>
  );
}
