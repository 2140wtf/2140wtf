import { Check, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DISAPPEAR_OPTIONS,
  getDisappearTtl,
  setDisappearTtl,
  ttlBadge,
} from "@/concord-v2/lib/disappearing";
import { cn } from "@/lib/utils";

/**
 * Channel-header timer for disappearing messages (NIP-40). The choice is a
 * sender-side, per-channel preference: messages sent while it's active carry
 * an expiration on the rumor (member clients hide them after expiry) and on
 * the wrap (NIP-40 relays drop the ciphertext).
 */
export function DisappearTimerButton2({ channelIdHex }: { channelIdHex: string }) {
  const [ttl, setTtl] = useState<number | undefined>(() => getDisappearTtl(channelIdHex));

  // Switching channels loads that channel's timer.
  useEffect(() => {
    setTtl(getDisappearTtl(channelIdHex));
  }, [channelIdHex]);

  const pick = (secs: number | undefined) => {
    setDisappearTtl(channelIdHex, secs);
    setTtl(secs);
  };

  const activeLabel = DISAPPEAR_OPTIONS.find((o) => o.secs === ttl)?.label;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                ttl ? `Disappearing messages: ${activeLabel}` : "Disappearing messages: off"
              }
              aria-pressed={ttl !== undefined}
              className={cn("size-8 touch:size-11 relative", ttl && "text-primary")}
            >
              <Timer className="size-4" />
              {ttl !== undefined && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-semibold leading-none">
                  {ttlBadge(ttl)}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {ttl ? `Disappearing messages: ${activeLabel}` : "Disappearing messages: off"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Disappearing messages</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => pick(undefined)}>
          <Check className={cn("size-4 mr-2", ttl === undefined ? "opacity-100" : "opacity-0")} />
          Off
        </DropdownMenuItem>
        {DISAPPEAR_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.secs} onClick={() => pick(option.secs)}>
            <Check
              className={cn("size-4 mr-2", ttl === option.secs ? "opacity-100" : "opacity-0")}
            />
            {option.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Applies to messages you send. Everyone's app hides them after the timer; relays that
          honor NIP-40 delete them too.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
