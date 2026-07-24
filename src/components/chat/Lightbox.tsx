import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BlurhashCanvas } from "@/components/BlurhashCanvas";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useResolvedMediaSrc } from "@/hooks/useResolvedMediaSrc";
import { cn } from "@/lib/utils";

import type { EncryptedRef } from "@/hooks/useResolvedMediaSrc";

interface LightboxProps {
  images: EncryptedRef[];
  currentIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

const EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
const DURATION = 280;

/**
 * Fullscreen image lightbox — cinematic gallery ported from Ditto.
 *
 * Features: horizontal swipe between images (a slot strip that keeps decoded
 * images in memory so neighbours don't reload), pinch / wheel / double-tap zoom
 * and pan per image, vertical swipe-to-dismiss (disabled while zoomed), keyboard
 * navigation (arrows + Escape), dot indicators, and a download / open-original
 * button.
 *
 * Each slot is rendered at a stable key and positioned absolutely at
 * `translateX((index - currentIndex) * 100vw + dragOffset)`; only the current
 * image and its immediate neighbours are mounted to cap DOM size.
 */
export function Lightbox({ images, currentIndex, onClose, onNext, onPrev }: LightboxProps) {
  const hasMultiple = images.length > 1;
  const canGoNext = currentIndex < images.length - 1;
  const canGoPrev = currentIndex > 0;

  // System back (Android gesture/button) closes the lightbox instead of
  // navigating the underlying screen.
  useAndroidBack(() => {
    onClose();
    return true;
  });

  // Lock body scroll while open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && canGoNext) onNext();
      else if (e.key === "ArrowLeft" && canGoPrev) onPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNext, onPrev, canGoNext, canGoPrev]);

  // ── Gesture state (refs → direct DOM mutation for 60fps, no re-render) ──────
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef(0);
  const verticalOffsetRef = useRef(0);
  const dragX = useRef<number | null>(null);
  const dragY = useRef<number | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const animating = useRef(false);
  /** Whether the current image is zoomed (blocks strip + dismiss gestures). */
  const childZoomedRef = useRef(false);

  // One DOM node per rendered slot, keyed by image index.
  const slotRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setSlotTransform = useCallback(
    (idx: number, offsetPx: number, transition: string) => {
      const el = slotRefs.current.get(idx);
      if (!el) return;
      const base = (idx - currentIndex) * window.innerWidth;
      el.style.transition = transition;
      el.style.transform = `translateX(${base + offsetPx}px)`;
    },
    [currentIndex],
  );

  const snapAll = useCallback(
    (offsetPx = 0) => {
      slotRefs.current.forEach((_, idx) => setSlotTransform(idx, offsetPx, "none"));
    },
    [setSlotTransform],
  );

  /** Vertical swipe-to-dismiss: fade backdrop in place, translate content. */
  const applyVerticalDismiss = useCallback((offsetY: number, transition: string) => {
    const el = containerRef.current;
    if (!el) return;
    const progress = Math.min(Math.abs(offsetY) / (window.innerHeight * 0.4), 1);
    el.style.transition = transition ? `opacity ${DURATION}ms ${EASING}` : "none";
    el.style.opacity = String(1 - progress * 0.6);
    const content = el.querySelector<HTMLDivElement>("[data-lightbox-content]");
    if (content) {
      content.style.transition = transition;
      content.style.transform = `translateY(${offsetY}px)`;
    }
  }, []);

  // Snap all slots into place when the index changes (keyboard/button nav).
  useEffect(() => {
    dragOffsetRef.current = 0;
    snapAll(0);
  }, [currentIndex, snapAll]);

  // Clear the animating lock on unmount so stale refs can't block controls.
  useEffect(() => () => {
    animating.current = false;
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    if (animating.current) return;
    if (e.touches.length >= 2) {
      dragX.current = null;
      dragY.current = null;
      return;
    }
    dragX.current = e.touches[0].clientX;
    dragY.current = e.touches[0].clientY;
    axis.current = null;
    slotRefs.current.forEach((_, idx) => setSlotTransform(idx, dragOffsetRef.current, "none"));
    applyVerticalDismiss(0, "none");
    verticalOffsetRef.current = 0;
  };

  // touchmove is registered non-passively so we can preventDefault().
  const onTouchMoveRef = useRef((_e: TouchEvent) => {});
  onTouchMoveRef.current = (e: TouchEvent) => {
    if (dragX.current === null || dragY.current === null || animating.current) return;
    const dx = e.touches[0].clientX - dragX.current;
    const dy = e.touches[0].clientY - dragY.current;
    if (!axis.current) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      axis.current = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
    }
    if (axis.current === "v") {
      if (childZoomedRef.current) return;
      e.preventDefault();
      verticalOffsetRef.current = dy;
      applyVerticalDismiss(dy, "none");
      return;
    }
    if (axis.current !== "h") return;
    if (childZoomedRef.current) return;
    e.preventDefault();
    const atEdge = (dx > 0 && !canGoPrev) || (dx < 0 && !canGoNext);
    dragOffsetRef.current = atEdge ? dx * 0.2 : dx;
    slotRefs.current.forEach((_, idx) => setSlotTransform(idx, dragOffsetRef.current, "none"));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => onTouchMoveRef.current(e);
    el.addEventListener("touchmove", handler, { passive: false });
    return () => el.removeEventListener("touchmove", handler);
  }, []);

  const onTouchEnd = (e: React.TouchEvent) => {
    // Vertical swipe-to-dismiss.
    if (axis.current === "v" && dragY.current !== null && !childZoomedRef.current) {
      const dy = e.changedTouches[0].clientY - dragY.current;
      dragX.current = null;
      dragY.current = null;
      axis.current = null;
      const committed = Math.abs(dy) > window.innerHeight * 0.15;
      if (committed) {
        animating.current = true;
        const targetY = dy > 0 ? window.innerHeight : -window.innerHeight;
        applyVerticalDismiss(targetY, `transform ${DURATION}ms ${EASING}`);
        setTimeout(() => {
          verticalOffsetRef.current = 0;
          onClose();
          animating.current = false;
        }, DURATION);
      } else {
        applyVerticalDismiss(0, `transform ${DURATION}ms ${EASING}`);
        verticalOffsetRef.current = 0;
      }
      return;
    }

    if (dragX.current === null || axis.current !== "h") {
      dragX.current = null;
      dragY.current = null;
      axis.current = null;
      slotRefs.current.forEach((_, idx) => setSlotTransform(idx, 0, `transform ${DURATION}ms ${EASING}`));
      dragOffsetRef.current = 0;
      return;
    }

    const dx = e.changedTouches[0].clientX - dragX.current;
    dragX.current = null;
    dragY.current = null;
    axis.current = null;

    const committed = Math.abs(dx) > window.innerWidth * 0.2;
    const goingNext = dx < 0 && canGoNext && committed;
    const goingPrev = dx > 0 && canGoPrev && committed;

    if (goingNext || goingPrev) {
      animating.current = true;
      const targetOffset = goingNext ? -window.innerWidth : window.innerWidth;
      const transition = `transform ${DURATION}ms ${EASING}`;
      slotRefs.current.forEach((_, idx) => setSlotTransform(idx, targetOffset, transition));
      setTimeout(() => {
        animating.current = false;
        dragOffsetRef.current = 0;
        if (goingNext) onNext();
        else onPrev();
      }, DURATION);
    } else {
      slotRefs.current.forEach((_, idx) => setSlotTransform(idx, 0, `transform ${DURATION}ms ${EASING}`));
      dragOffsetRef.current = 0;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG" || target.closest("button") || target.closest("[data-gallery-topbar]")) return;
    e.stopPropagation();
    e.preventDefault();
    onClose();
  };

  // Only the current image and its immediate neighbours are mounted.
  const visibleIndices = [currentIndex - 1, currentIndex, currentIndex + 1].filter(
    (i) => i >= 0 && i < images.length,
  );

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[200] animate-in fade-in duration-200"
      onClick={handleBackdropClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — fades in place, never translates. */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />

      {/* Content layer — translates together during swipe-to-dismiss. */}
      <div data-lightbox-content className="absolute inset-0">
        {/* Top bar */}
        <div
          data-gallery-topbar
          className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3 safe-area-top"
        >
          {hasMultiple ? (
            <span className="text-white/80 text-sm font-medium tabular-nums">
              {currentIndex + 1} / {images.length}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            <LightboxDownloadButton image={images[currentIndex]} />
            <button
              type="button"
              aria-label="Close"
              title="Close (Esc)"
              className="p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onClose();
              }}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Prev / next buttons (desktop) */}
        {canGoPrev && (
          <button
            type="button"
            aria-label="Previous image"
            title="Previous"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 backdrop-blur-sm transition-all hidden sm:flex"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {canGoNext && (
          <button
            type="button"
            aria-label="Next image"
            title="Next"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 backdrop-blur-sm transition-all hidden sm:flex"
          >
            <ChevronRight className="size-6" />
          </button>
        )}

        {/* Per-image slots — each absolutely positioned by index offset. */}
        <div data-lightbox-strip className="absolute inset-0 overflow-hidden">
          {visibleIndices.map((i) => {
            const initialX = (i - currentIndex) * window.innerWidth;
            return (
              <div
                key={images[i].url || i}
                ref={(el) => {
                  if (el) slotRefs.current.set(i, el);
                  else slotRefs.current.delete(i);
                }}
                className="absolute inset-0 flex items-center justify-center will-change-transform py-6 pt-14 px-4 sm:px-12"
                style={{ transform: `translateX(${initialX}px)` }}
              >
                <LightboxImage
                  image={images[i]}
                  isActive={i === currentIndex}
                  onSwipeBlocked={() => {
                    dragX.current = null;
                    axis.current = null;
                  }}
                  onZoomChange={(zoomed) => {
                    if (i === currentIndex) childZoomedRef.current = zoomed;
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Dot indicators (mobile) */}
        {hasMultiple && images.length <= 10 && (
          <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bottom-6 sm:hidden">
            {images.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-full transition-all duration-200",
                  i === currentIndex ? "size-2 bg-white" : "size-1.5 bg-white/40",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Top-bar button that opens the (resolved) original image in a new tab. */
function LightboxDownloadButton({ image }: { image: EncryptedRef }) {
  const resolved = useResolvedMediaSrc(image);
  if (resolved.status !== "ready") return null;
  return (
    <button
      type="button"
      aria-label="Open original"
      title="Open original"
      className="p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        window.open(resolved.src, "_blank", "noopener,noreferrer");
      }}
    >
      <Download className="size-5" />
    </button>
  );
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

/** A single lightbox image with pinch / wheel / double-tap zoom and pan. */
function LightboxImage({
  image,
  isActive,
  onSwipeBlocked,
  onZoomChange,
}: {
  image: EncryptedRef;
  isActive: boolean;
  onSwipeBlocked?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const resolved = useResolvedMediaSrc(image);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom/pan state (mutated directly on the DOM for 60fps).
  const scale = useRef(1);
  const panX = useRef(0);
  const panY = useRef(0);

  const pinchStart = useRef<
    { dist: number; midX: number; midY: number; scale: number; panX: number; panY: number } | null
  >(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const lastTap = useRef(0);
  const mouseDrag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const notifyZoom = useCallback(() => {
    onZoomChange?.(scale.current > 1);
  }, [onZoomChange]);

  const applyTransform = useCallback((animated = false) => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.transition = animated ? "transform 0.25s ease" : "none";
    el.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${scale.current})`;
  }, []);

  const clampPan = useCallback((s = scale.current) => {
    const el = imgRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const iw = el.offsetWidth * s;
    const ih = el.offsetHeight * s;
    const cw = wrap.parentElement?.offsetWidth ?? window.innerWidth;
    const ch = wrap.parentElement?.offsetHeight ?? window.innerHeight;
    const maxX = Math.max(0, (iw - cw) / 2);
    const maxY = Math.max(0, (ih - ch) / 2);
    panX.current = Math.max(-maxX, Math.min(maxX, panX.current));
    panY.current = Math.max(-maxY, Math.min(maxY, panY.current));
  }, []);

  // Reset zoom when the underlying image changes.
  useEffect(() => {
    scale.current = 1;
    panX.current = 0;
    panY.current = 0;
    applyTransform();
    notifyZoom();
  }, [image.url, applyTransform, notifyZoom]);

  function dist(t: React.TouchList | TouchList) {
    const dx = t[1].clientX - t[0].clientX;
    const dy = t[1].clientY - t[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStart.current = {
        dist: dist(e.touches),
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        scale: scale.current,
        panX: panX.current,
        panY: panY.current,
      };
      panStart.current = null;
    } else if (e.touches.length === 1) {
      if (scale.current > 1) {
        panStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: panX.current,
          panY: panY.current,
        };
      }
      const now = Date.now();
      if (now - lastTap.current < 300) {
        e.preventDefault();
        if (scale.current > 1) {
          scale.current = 1;
          panX.current = 0;
          panY.current = 0;
        } else {
          scale.current = 2.5;
          const rect = wrapRef.current?.getBoundingClientRect();
          if (rect) {
            const cx = e.touches[0].clientX - rect.left - rect.width / 2;
            const cy = e.touches[0].clientY - rect.top - rect.height / 2;
            panX.current = (-cx * (scale.current - 1)) / scale.current;
            panY.current = (-cy * (scale.current - 1)) / scale.current;
            clampPan();
          }
        }
        applyTransform(true);
        notifyZoom();
      }
      lastTap.current = now;
    }
  };

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStart.current) {
        e.preventDefault();
        const p = pinchStart.current;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (p.scale * dist(e.touches)) / p.dist));
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        scale.current = newScale;
        panX.current = p.panX + (midX - p.midX);
        panY.current = p.panY + (midY - p.midY);
        clampPan(newScale);
        applyTransform();
        notifyZoom();
      } else if (e.touches.length === 1 && panStart.current && scale.current > 1) {
        e.preventDefault();
        const p = panStart.current;
        panX.current = p.panX + (e.touches[0].clientX - p.x);
        panY.current = p.panY + (e.touches[0].clientY - p.y);
        clampPan();
        applyTransform();
        onSwipeBlocked?.();
      }
    },
    [applyTransform, clampPan, notifyZoom, onSwipeBlocked],
  );

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchStart.current = null;
    if (e.touches.length === 0) {
      panStart.current = null;
      if (scale.current < MIN_SCALE) {
        scale.current = MIN_SCALE;
        panX.current = 0;
        panY.current = 0;
        applyTransform(true);
        notifyZoom();
      } else {
        clampPan();
        applyTransform(true);
      }
    }
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        scale.current = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.current * factor));
        if (scale.current === MIN_SCALE) {
          panX.current = 0;
          panY.current = 0;
        } else {
          clampPan();
        }
        applyTransform();
        notifyZoom();
      } else if (scale.current > 1) {
        e.preventDefault();
        panX.current -= e.deltaX;
        panY.current -= e.deltaY;
        clampPan();
        applyTransform();
      }
    },
    [applyTransform, clampPan, notifyZoom],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale.current <= 1) return;
    e.preventDefault();
    mouseDrag.current = { x: e.clientX, y: e.clientY, panX: panX.current, panY: panY.current };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!mouseDrag.current) return;
    panX.current = mouseDrag.current.panX + (e.clientX - mouseDrag.current.x);
    panY.current = mouseDrag.current.panY + (e.clientY - mouseDrag.current.y);
    clampPan();
    applyTransform();
  };
  const handleMouseUp = () => {
    if (!mouseDrag.current) return;
    mouseDrag.current = null;
    clampPan();
    applyTransform(true);
  };

  // Non-passive touchmove/wheel so we can preventDefault().
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tm = (e: TouchEvent) => handleTouchMove(e);
    const wh = (e: WheelEvent) => handleWheel(e);
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("wheel", wh, { passive: false });
    return () => {
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("wheel", wh);
    };
  }, [handleTouchMove, handleWheel]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: scale.current > 1 ? "grab" : "default" }}
    >
      {/* Loading spinner / blurhash while the current image resolves. */}
      {isActive && (resolved.status === "loading" || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {image.blurhash ? (
            <BlurhashCanvas
              hash={image.blurhash}
              className="absolute inset-0 opacity-40"
              style={{ objectFit: "contain" }}
            />
          ) : (
            <div className="size-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
          )}
        </div>
      )}

      <div
        ref={wrapRef}
        style={{
          transformOrigin: "center center",
          willChange: "transform",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {resolved.status === "ready" && (
          <img
            ref={imgRef}
            src={resolved.src}
            alt=""
            draggable={false}
            className={cn(
              "block max-w-full max-h-full object-contain select-none transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setLoaded(true)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
}
