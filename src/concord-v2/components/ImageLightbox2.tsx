import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

/** Fullscreen viewer for a single already-decrypted image URL.
 *
 * Escape / click closes; on touch, drag the image vertically to dismiss (see
 * `useSwipeToDismiss`) — the same gesture as the chat `Lightbox`, so
 * banner/avatar previews behave identically. */
export function ImageLightbox2({ src, onClose }: { src: string; onClose: () => void }) {
  const { containerRef, handlers } = useSwipeToDismiss(onClose);

  // System back (Android gesture/button) closes the lightbox instead of
  // navigating the underlying screen.
  useAndroidBack(() => {
    onClose();
    return true;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[300]"
      onClick={onClose}
      {...handlers}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — fades in place, never translates. */}
      <div className="absolute inset-0 bg-black/90" />

      {/* Content layer — translates together during swipe-to-dismiss. */}
      <div data-lightbox-content className="absolute inset-0 flex items-center justify-center">
        <button
          type="button"
          aria-label="Close"
          className="absolute top-safe-4 right-4 p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          onClick={onClose}
        >
          <X className="size-6" />
        </button>
        <img
          src={src}
          alt=""
          draggable={false}
          className="max-w-[95vw] max-h-[92vh] object-contain select-none"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  );
}
