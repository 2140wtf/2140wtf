import React from 'react';
import QRCode from 'qrcode';
import { decodeCashuToken } from '@/baofund/cashu-wallet/lib/cashu/cashu';

interface CashuTokenQrProps {
  token: string;
  size?: number;
  caption?: string;
}

/** Structural type of the vendored NUT-16 encoder (loaded on demand below). */
interface UrEncoder {
  partCount: number;
  nextPart(): string;
}

/**
 * NUT-16 recommends animation once a token has more than two proofs; the byte
 * cap also catches long scripts, memos, and mint URLs. Mirrors the vendored
 * `shouldAnimateCashuToken` WITHOUT importing the NUT-16 module: that module
 * pulls Node-only '@ngraveio/bc-ur' (its browserify `util`/`assert` shims
 * reference bare `process` at evaluation time), and the vendor barrel
 * documents it as node-context-only - a static import blanks the browser
 * build with "process is not defined".
 */
export function shouldAnimateToken(token: string): boolean {
  if (new TextEncoder().encode(token).byteLength > 900) return true;
  try {
    const entries = decodeCashuToken(token);
    return (entries?.reduce((count, entry) => count + entry.proofs.length, 0) ?? 0) > 2;
  } catch {
    return false;
  }
}

/** `prefers-reduced-motion` guard - jsdom and old browsers may lack matchMedia. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type EncoderState = 'none' | 'loading' | 'ready' | 'unavailable';

/**
 * Token display: static QR for small tokens, animated NUT-16 UR fragments for
 * large ones. The UR encoder is imported ON DEMAND (never at module scope) so
 * the Node-only bc-ur dependency stays out of the browser graph; when it is
 * unavailable the component degrades to a static QR of the raw token, and if
 * the token exceeds QR capacity it points at the copyable text instead.
 */
export function CashuTokenQr({ token, size = 200, caption }: CashuTokenQrProps): React.ReactElement {
  const animated = React.useMemo(() => shouldAnimateToken(token), [token]);
  const [encoder, setEncoder] = React.useState<UrEncoder | null>(null);
  const [encoderState, setEncoderState] = React.useState<EncoderState>(animated ? 'loading' : 'none');
  const reducedMotion = React.useMemo(() => prefersReducedMotion(), []);
  const [frame, setFrame] = React.useState<string>(token);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (!animated) {
        setEncoder(null);
        setEncoderState('none');
        setFrame(token);
        return;
      }
      setEncoder(null);
      setEncoderState('loading');
    });
    if (animated) {
      void import('@/baofund/cashu-wallet/lib/cashu/nut16')
        .then((mod) => {
          if (cancelled) return;
          try {
            const enc = new mod.CashuUrEncoder(token);
            setEncoder(enc);
            setEncoderState('ready');
            setFrame(enc.nextPart());
          } catch {
            setEncoderState('unavailable');
            setFrame(token);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEncoderState('unavailable');
            setFrame(token);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [animated, token]);

  React.useEffect(() => {
    if (!encoder || reducedMotion) return;
    const timer = window.setInterval(() => setFrame(encoder.nextPart()), 250);
    return () => window.clearInterval(timer);
  }, [encoder, reducedMotion]);

  const advance = (): void => {
    if (encoder) setFrame(encoder.nextPart());
  };

  const key = `${size}:${frame}`;
  const [rendered, setRendered] = React.useState<{ key: string; svg: string } | null>(null);
  const [failedKey, setFailedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toString(frame, { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) setRendered({ key, svg });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [frame, key, size]);

  const staticFallback = animated && encoderState === 'unavailable';
  const svg = rendered?.key === key ? rendered.svg : null;

  return (
    <div className="flex flex-col items-center gap-2" data-testid="cashu-token-qr">
      {svg ? (
        <img
          alt="Cashu token QR"
          data-testid="cashu-token-qr-image"
          width={size}
          height={size}
          style={{ background: '#fff', border: '1px solid var(--np-rule)', padding: 4 }}
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        />
      ) : failedKey === key ? (
        <p className="max-w-xs text-center text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>
          This token is too large for a QR code. Copy the token text instead.
        </p>
      ) : (
        <span
          data-testid="cashu-token-qr-loading"
          aria-hidden="true"
          style={{ width: size, height: size, border: '1px solid var(--np-rule)', background: 'var(--np-bg)' }}
        />
      )}
      {encoder && (
        <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }} aria-live="polite">
          Animated QR · {encoder.partCount} fragments
        </p>
      )}
      {staticFallback && (
        <p className="max-w-xs text-center text-[10px]" style={{ color: 'var(--np-muted)' }} data-testid="cashu-token-qr-static-note">
          Static QR (the animated encoder is unavailable in this browser) - some wallets may prefer the token text below.
        </p>
      )}
      {encoder && reducedMotion && (
        <button
          type="button"
          onClick={advance}
          className="rounded border px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          Next QR frame
        </button>
      )}
      {caption && (
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          {caption}
        </span>
      )}
    </div>
  );
}

export default CashuTokenQr;
