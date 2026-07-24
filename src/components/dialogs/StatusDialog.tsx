import { Loader2, Smile, SmilePlus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { EmojiShortcodeAutocomplete } from "@/components/chat/EmojiShortcodeAutocomplete";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCustomEmojis } from "@/hooks/useCustomEmojis";
import { useInsertText } from "@/hooks/useInsertText";
import { toast } from "@/hooks/useToast";
import { useSetUserStatus, useUserStatus } from "@/hooks/useUserStatus2";
import { collectEmojiTags } from "@/lib/customEmoji";

/** Lazy-loaded EmojiPicker — keeps emoji-mart + its data out of the main bundle. */
const LazyEmojiPicker = lazy(() =>
  import("@/components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A few one-tap status suggestions. */
const PRESETS = ["👋 Available", "🎧 Focusing", "🌴 Away", "💤 Sleeping", "🍕 Lunch"];

const MAX_LEN = 140;

/**
 * Set or clear the current user's NIP-38 status (kind 30315, `d: "general"`).
 * The status is a short, ephemeral message shown next to your name in member
 * lists and your profile card. Leaving it empty and saving clears it.
 */
export function StatusDialog({ open, onOpenChange }: StatusDialogProps) {
  const { user } = useCurrentUser();
  const { data } = useUserStatus(user?.pubkey);
  const { mutateAsync: setStatus, isPending } = useSetUserStatus();
  const { emojis: customEmojis } = useCustomEmojis();

  const [content, setContent] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same insertion helpers the chat composer uses (caret splice + focus restore).
  const setClampedContent = useCallback((value: string) => setContent(value.slice(0, MAX_LEN)), []);
  const { insertAtCursor, insertEmoji } = useInsertText(inputRef, content, setClampedContent);

  // Hydrate from the current status whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setContent(data?.status?.content ?? "");
      setPickerOpen(false);
    }
  }, [open, data?.status?.content]);

  const save = async (next: string) => {
    try {
      await setStatus({
        content: next,
        emojiTags: collectEmojiTags(next, customEmojis),
      });
      toast({
        title: next.trim() ? "Status updated" : "Status cleared",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn’t update status",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // The shortcode-autocomplete dropdown portals to document.body (to
        // escape the dialog's transform); don't let taps on it count as an
        // outside interaction that would close the dialog.
        onInteractOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-autocomplete-dropdown]")) {
            e.preventDefault();
          }
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center bg-primary/15 text-primary">
            <Smile className="size-6" />
          </div>
          <DialogTitle className="text-lg font-bold tracking-tight text-foreground">
            Set a status
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            A short message shown next to your name. Visible to everyone. Clear it any time.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(content);
          }}
          className="mt-6 space-y-5"
        >
          <div className="space-y-1.5">
            <Label
              htmlFor="user-status"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              What's happening?
            </Label>
            <div className="relative">
              <Input
                ref={inputRef}
                id="user-status"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="e.g. 🎧 Heads down or :shortcode:"
                autoComplete="off"
                maxLength={MAX_LEN}
                autoFocus
                className="pr-10 bg-background/40 border-transparent"
              />
              {/* Same `:shortcode` autocomplete as the chat composer (native + custom emojis). */}
              <EmojiShortcodeAutocomplete
                textareaRef={inputRef}
                content={content}
                onInsertEmoji={insertAtCursor}
              />
              <Popover open={pickerOpen} onOpenChange={setPickerOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Add emoji"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-8 text-muted-foreground hover:text-primary"
                  >
                    <SmilePlus className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="flex w-[min(20rem,90vw)] h-[min(360px,55dvh)] max-h-[var(--radix-popover-content-available-height)] p-0 rounded-xl border-border shadow-lg overflow-hidden"
                >
                  <Suspense fallback={<div className="w-full" />}>
                    <LazyEmojiPicker
                      customEmojis={customEmojis}
                      onSelect={(selection) => {
                        if (selection.type === "native") {
                          insertEmoji(selection.emoji);
                        } else {
                          insertEmoji(`:${selection.shortcode}:`);
                        }
                        setPickerOpen(false);
                      }}
                    />
                  </Suspense>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setContent(preset)}
                  className="clip-corner-lg bg-background/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            {data?.status?.content && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-muted-foreground"
                disabled={isPending}
                onClick={() => save("")}
              >
                Clear status
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? <><Loader2 className="size-4 mr-2 animate-spin" /> Saving…</> : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
