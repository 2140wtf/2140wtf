import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import { CashuUrEncoder, shouldAnimateCashuToken } from '@/lib/cashu/nut16';

interface CashuTokenQrProps {
  token: string;
  size?: number;
}

/** NUT-16 display with a static fallback for small tokens and manual frame
 * controls when the user requests reduced motion. */
export function CashuTokenQr({ token, size = 200 }: CashuTokenQrProps) {
  const animated = shouldAnimateCashuToken(token);
  const encoder = useMemo(() => {
    if (!animated) return null;
    try {
      return new CashuUrEncoder(token);
    } catch {
      return null;
    }
  }, [animated, token]);
  const [frame, setFrame] = useState(() => encoder?.nextPart() ?? token);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    setFrame(encoder?.nextPart() ?? token);
    if (!encoder || reducedMotion) return;
    const timer = window.setInterval(() => {
      setFrame(encoder.nextPart());
    }, 250);
    return () => window.clearInterval(timer);
  }, [encoder, reducedMotion, token]);

  const advance = () => {
    if (!encoder) return;
    setFrame(encoder.nextPart());
  };

  if (animated && !encoder) {
    return (
      <p className="max-w-xs text-center text-xs text-destructive">
        This token is too large or invalid for a QR code. Copy the token text instead.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <QRCodeSVG value={frame} size={size} level="M" />
      </div>
      {encoder && (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Animated QR · {encoder.partCount} source fragments
          </p>
          {reducedMotion && (
            <Button type="button" variant="outline" size="sm" onClick={advance}>
              Next QR frame
            </Button>
          )}
        </>
      )}
    </div>
  );
}
