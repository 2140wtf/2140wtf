// src/wallet/qrScan.ts
//
// Camera-scan session logic for the wallet QR scanner (WS6), deliberately
// DOM-free so it is testable without a camera:
//
//   - a plain `cashu…` token or `lnbc…` invoice frame completes immediately;
//   - NUT-16 `ur:bytes/…` frames are fed to the vendored animated decoder,
//     which reports progress until the token is complete.
//
// The animated decoder module is imported ON DEMAND (never at module scope):
// `@/baofund/cashu-wallet/lib/cashu/nut16` pulls Node-only bc-ur shims that blank a dev
// server when statically imported (see CashuTokenQr). If the decoder cannot
// load, animated frames fail with a typed error while static codes still work.
//
// No dependency is added: the IMAGE decoding lives in the browser's native
// BarcodeDetector (see QrScanDialog); this module only interprets its values.

/**
 * NUT-16 UR frame prefix. Mirrors `CASHU_UR_PREFIX` in the vendored nut16
 * module WITHOUT importing it (a static import of that module pulls the
 * Node-only bc-ur shims into the browser graph - see CashuTokenQr).
 */
const CASHU_UR_PREFIX = 'ur:bytes/';

export type QrScanResult =
  | { kind: 'code'; value: string }
  | { kind: 'ur-progress'; progress: number }
  | { kind: 'ur-complete'; token: string };

/** Structural type of the vendored decoder (loaded on demand). */
interface UrDecoderLike {
  receive(part: string): { complete: boolean; progress: number; token?: string };
}

/** What a static (non-UR) scan looks like, for user-facing copy. */
export function staticCodeKind(value: string): 'cashu' | 'bolt11' | 'other' {
  const lower = value.trim().toLowerCase();
  if (lower.startsWith('cashu')) return 'cashu';
  if (lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt') || lower.startsWith('lightning:')) return 'bolt11';
  return 'other';
}

let decoderFactory: (() => Promise<UrDecoderLike>) | null = () => import('@/baofund/cashu-wallet/lib/cashu/nut16')
  .then((mod) => new mod.CashuUrDecoder());

/** Test seam: replace the on-demand decoder loader (null restores the real one). */
export function setQrUrDecoderFactory(factory: (() => Promise<UrDecoderLike>) | null): void {
  decoderFactory = factory ?? (() => import('@/baofund/cashu-wallet/lib/cashu/nut16').then((mod) => new mod.CashuUrDecoder()));
}

/**
 * One scanner session: owns a single UR decoder so fragments from separate
 * transfers can never mix. Create one per dialog open.
 */
export class QrScanSession {
  private decoder: UrDecoderLike | null = null;
  private loading: Promise<UrDecoderLike | null> | null = null;

  private async loadDecoder(): Promise<UrDecoderLike | null> {
    if (this.decoder) return this.decoder;
    if (!this.loading) {
      this.loading = (decoderFactory
        ? decoderFactory()
        : Promise.reject(new Error('no decoder'))
      ).catch(() => null);
    }
    const loaded = await this.loading;
    this.decoder = loaded;
    return loaded;
  }

  /** Interpret one detector frame. Throws a typed Error on invalid frames. */
  async receive(raw: string): Promise<QrScanResult> {
    const value = (raw ?? '').trim();
    if (!value) throw new Error('Empty scan');
    if (!value.toLowerCase().startsWith(CASHU_UR_PREFIX)) {
      return { kind: 'code', value };
    }
    const decoder = await this.loadDecoder();
    if (!decoder) {
      throw new Error('This browser cannot decode animated QR codes - paste the token instead');
    }
    const res = decoder.receive(value);
    if (res.complete && res.token) return { kind: 'ur-complete', token: res.token };
    return { kind: 'ur-progress', progress: res.progress };
  }
}
