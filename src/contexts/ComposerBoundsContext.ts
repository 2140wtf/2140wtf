import { createContext, useContext } from "react";

/**
 * Tracks the chat composer's container element so that floating UI (context
 * menus, popovers) can avoid overlapping it. The composer is the bottom-most
 * element in every chat view; without tracking it, Radix's collision detection
 * only knows about the viewport, so a context menu opened on a message near the
 * bottom can extend down into the composer / safe-area inset instead of
 * flipping upward.
 *
 * Each chat view (GroupChat, ConcordV2Page, ConcordPage, DMsPage Conversation,
 * ThreadPanel) provides its own instance via {@link ComposerBoundsProvider},
 * scoping the ref to that pane — important on desktop where a thread panel and
 * the main chat each have their own composer.
 */
export type ComposerBoundsRef = React.RefObject<HTMLElement | null>;

const ComposerBoundsContext = createContext<ComposerBoundsRef>({ current: null });

export const ComposerBoundsProvider = ComposerBoundsContext.Provider;

export function useComposerBoundsRef(): ComposerBoundsRef {
  return useContext(ComposerBoundsContext);
}

/**
 * Computes `collisionPadding` for Radix floating content (context menus,
 * popovers) so it doesn't overlap the composer. Returns `undefined` when the
 * composer isn't mounted (no boundary to avoid), leaving Radix's default
 * viewport collision detection in effect.
 *
 * The composer sits at the bottom of the chat pane; its distance from the
 * viewport's bottom edge becomes the bottom collision padding, so the
 * effective boundary is the composer's top edge — forcing the menu to flip
 * upward instead of dropping into the composer / safe-area inset.
 */
export function getComposerCollisionPadding(
  ref: ComposerBoundsRef,
): number | Partial<Record<"top" | "right" | "bottom" | "left", number>> | undefined {
  const el = ref.current;
  if (!el) return undefined;
  const rect = el.getBoundingClientRect();
  return { bottom: Math.max(0, window.innerHeight - rect.top) };
}
