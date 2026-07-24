import { decode } from "blurhash";
import { useEffect, useRef } from "react";

import { isValidBlurhash } from "@/lib/blurhash";

interface BlurhashCanvasProps {
  hash: string;
  /** Decode resolution (kept small — the canvas is stretched to fill its box). */
  resolution?: number;
  punch?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders a NIP-94 `blurhash` string as a blurred placeholder on a `<canvas>`.
 *
 * A tiny (default 32×32) bitmap is decoded and stretched to fill the element
 * via CSS, giving the classic blur-up placeholder without pulling in a React
 * blurhash wrapper — it decodes with the already-bundled `blurhash` package.
 */
export function BlurhashCanvas({
  hash,
  resolution = 32,
  punch = 1,
  className,
  style,
}: BlurhashCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isValidBlurhash(hash)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      const pixels = decode(hash, resolution, resolution, punch);
      const imageData = ctx.createImageData(resolution, resolution);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // Ignore malformed hashes — the placeholder just stays blank.
    }
  }, [hash, resolution, punch]);

  if (!isValidBlurhash(hash)) return null;

  return (
    <canvas
      ref={canvasRef}
      width={resolution}
      height={resolution}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}
