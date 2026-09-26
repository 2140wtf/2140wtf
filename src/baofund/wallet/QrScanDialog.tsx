// src/wallet/QrScanDialog.tsx
//
// Camera QR scanner for the wallet (WS6). Decoding is native-first: the
// browser's BarcodeDetector when present, otherwise frame decoding with
// `jsqr` (lazy-loaded) - the same decoder bao.markets ships, so iOS Safari /
// Firefox / in-app webviews scan instead of seeing "not supported". Only a
// browser with neither decoder, or no camera at all, gets the fail-closed
// "paste the code" state. Interpretation of the decoded value (static
// token/invoice vs NUT-16 UR frames) lives in `qrScan.ts`, which loads the
// animated decoder on demand.
//
// The detector, frame decoder and mediaDevices are injectable so the dialog
// is testable in jsdom without a camera.

import React from 'react';
import { X } from 'lucide-react';
import { QrScanSession } from './qrScan';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

type DetectorFactory = () => BarcodeDetectorLike | null;

/** Decodes one video frame; null when no QR is visible in it. */
type FrameDecoder = (video: HTMLVideoElement) => string | null;
type FrameDecoderFactory = () => FrameDecoder | null;

type JsQrResult = { data?: string } | null;
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => JsQrResult;

interface QrScanDialogProps {
  open: boolean;
  title: string;
  onResult: (value: string) => void;
  onClose: () => void;
  /** Test seams; default to the browser's BarcodeDetector + mediaDevices. */
  detectorFactory?: DetectorFactory;
  /** Fallback decoder used when BarcodeDetector is unavailable (default jsqr). */
  frameDecoderFactory?: FrameDecoderFactory;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
}

type ScanStatus =
  | { kind: 'scanning' }
  | { kind: 'progress'; progress: number }
  | { kind: 'error'; text: string }
  | { kind: 'unsupported' };

function defaultDetectorFactory(): BarcodeDetectorLike | null {
  const Ctor = (globalThis as { BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/**
 * jsqr-backed frame decoder. The module is imported lazily (it is ~40 KB) and
 * the canvas is created once per dialog session; frames whose video metadata
 * has not loaded yet decode to null and are retried on the next tick.
 */
function defaultFrameDecoderFactory(): FrameDecoder {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let jsqr: JsQrFn | null = null;
  let loadStarted = false;
  return (video) => {
    if (!jsqr) {
      if (!loadStarted) {
        loadStarted = true;
        void import('jsqr')
          .then((mod) => {
            jsqr = ((mod as { default?: JsQrFn }).default ?? (mod as unknown as JsQrFn)) || null;
          })
          .catch(() => undefined);
      }
      return null;
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return null;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    const frame = ctx.getImageData(0, 0, width, height);
    if (!frame?.data) return null;
    return jsqr(frame.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/** jsdom's HTMLMediaElement.play() is not promise-shaped; never throw on it. */
function safePlay(video: HTMLVideoElement): void {
  try {
    const p = video.play();
    if (p && typeof (p as Promise<void>).catch === 'function') void (p as Promise<void>).catch(() => undefined);
  } catch {
    /* autoplay restrictions surface as a frozen frame, not a crash */
  }
}

export function QrScanDialog({
  open, title, onResult, onClose, detectorFactory, frameDecoderFactory, mediaDevices,
}: QrScanDialogProps): React.ReactElement | null {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = React.useState<ScanStatus>({ kind: 'scanning' });

  // Callbacks are read through refs so a parent re-render cannot restart the
  // camera session mid-scan.
  const onResultRef = React.useRef(onResult);
  const onCloseRef = React.useRef(onClose);
  // Latest-callback refs are synced in an effect: writing refs during render
  // is a react-hooks/refs violation (and can tear under concurrent render).
  React.useEffect(() => {
    onResultRef.current = onResult;
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    if (!open) return;
    const factory = detectorFactory ?? defaultDetectorFactory;
    const detector = factory();
    const frameFactory = frameDecoderFactory ?? defaultFrameDecoderFactory;
    const decodeFrame = detector ? null : frameFactory();
    const media = mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
    if ((!detector && !decodeFrame) || !media?.getUserMedia) {
      // Deferred: a synchronous setState in the effect body is a cascading
      // render (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setStatus({ kind: 'unsupported' }));
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    const session = new QrScanSession();
    void Promise.resolve().then(() => setStatus({ kind: 'scanning' }));

    const finish = (value: string): void => {
      if (cancelled) return;
      onResultRef.current(value);
      onCloseRef.current();
    };

    const tick = async (): Promise<void> => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      try {
        const raws = detector
          ? (await detector.detect(video)).map((code) => code?.rawValue)
          : [decodeFrame!(video)];
        for (const raw of raws) {
          if (!raw) continue;
          try {
            const res = await session.receive(raw);
            if (cancelled) return;
            if (res.kind === 'code') return finish(res.value);
            if (res.kind === 'ur-complete') return finish(res.token);
            setStatus({ kind: 'progress', progress: res.progress });
          } catch (err) {
            // An invalid frame must not kill the session: the animated QR may
            // need more frames, and a stray code in view is common.
            setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Invalid QR code' });
          }
        }
      } catch {
        /* detect() can throw while the video warms up; keep scanning */
      }
    };

    void (async () => {
      try {
        stream = await media.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        safePlay(video);
        timer = window.setInterval(() => { void tick(); }, 300);
      } catch (err) {
        if (!cancelled) setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Camera unavailable' });
      }
    })();

    const videoEl = videoRef.current;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
    };
  }, [open, detectorFactory, frameDecoderFactory, mediaDevices]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm border p-4"
        style={{ borderColor: 'var(--np-rule)', background: 'var(--np-bg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded border px-2 py-0.5 text-xs"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
          >
            <X size={13} />
          </button>
        </div>
        {status.kind === 'unsupported' ? (
          <p data-testid="qr-scan-unsupported" className="text-[11px]" style={{ color: 'var(--np-muted)' }}>
            Camera scanning is not supported in this browser - paste the code instead.
          </p>
        ) : (
          <video
            ref={videoRef}
            data-testid="qr-scan-video"
            muted
            playsInline
            className="w-full"
            style={{ background: '#000', minHeight: 200 }}
          />
        )}
        {status.kind === 'progress' && (
          <p data-testid="qr-scan-progress" className="mt-2 text-[11px]" style={{ color: 'var(--np-accent-2)' }} aria-live="polite">
            Animated QR · {status.progress}%
          </p>
        )}
        {status.kind === 'error' && (
          <p data-testid="qr-scan-error" role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}

export default QrScanDialog;
