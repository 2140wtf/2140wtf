import { useState } from "react";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

/** Discord-style `||spoiler||`: blacked out until clicked. */
export function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role={revealed ? undefined : "button"}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : "Reveal spoiler"}
      onClick={(e) => {
        if (revealed) return;
        e.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(e) => {
        if (revealed) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed(true);
        }
      }}
      className={cn(
        "rounded-[3px] px-0.5 transition-colors",
        revealed
          ? "bg-muted/60"
          : "bg-foreground/90 text-transparent cursor-pointer select-none [&_img]:invisible [&_a]:text-transparent",
      )}
    >
      {children}
    </span>
  );
}
