/**
 * LightningInvoice - a bolt11 payment request rendered for EXTERNAL wallets:
 * scannable QR, copy button, `lightning:` deep link, and an optional WebLN
 * "pay from this browser" action. The QR is an SVG data-URL (qrcode's
 * canvas-free path) so it renders in tests without a canvas polyfill.
 *
 * Used by the wallet top-up panel and the campaign pledge flow: any user with
 * a Lightning wallet can pay without owning the built-in BAO wallet.
 */
import React from 'react';
import QRCode from 'qrcode';

interface WebLnProvider {
  enable?: () => Promise<void>;
  sendPayment: (paymentRequest: string) => Promise<unknown>;
}

export interface LightningInvoiceProps {
  /** bolt11 payment request (with or without `lightning:` prefix). */
  invoice: string;
  amountSats?: number;
  /** Small caption under the code. */
  caption?: string;
  /** Live status line (e.g. "waiting for payment…"). */
  status?: string | null;
  /** Error line; when set, replaces the status styling. */
  error?: string | null;
  /** QR size in px (default 200). */
  size?: number;
}

export function LightningInvoice({
  invoice,
  amountSats,
  caption,
  status,
  error,
  size = 200,
}: LightningInvoiceProps): React.ReactElement {
  const pr = invoice.replace(/^lightning:/i, '').trim();
  // BOLT11 is QR-alphanumeric when uppercased: a smaller, denser code.
  const payload = pr.toUpperCase();
  const key = `${payload}\u0000${size}`;
  const [rendered, setRendered] = React.useState<{ key: string; svg: string } | null>(null);
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [weblnMsg, setWeblnMsg] = React.useState<string | null>(null);

  const webln = typeof window !== 'undefined'
    ? (window as unknown as { webln?: WebLnProvider }).webln
    : undefined;
  const weblnAvailable = typeof webln?.sendPayment === 'function';
  const empty = pr.length === 0;

  React.useEffect(() => {
    if (empty) return;
    let cancelled = false;
    QRCode.toString(payload, { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then((out) => {
        if (!cancelled) setRendered({ key, svg: out });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size, key, empty]);

  const copy = (): void => {
    void navigator.clipboard?.writeText(pr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  const payWithWebln = async (): Promise<void> => {
    if (!webln) return;
    try {
      setWeblnMsg('Waiting for your wallet…');
      await webln.enable?.();
      await webln.sendPayment(pr);
      setWeblnMsg('Payment sent - the wallet will confirm it here.');
    } catch (e) {
      setWeblnMsg(e instanceof Error ? e.message.slice(0, 160) : 'The wallet did not complete the payment.');
    }
  };

  if (empty) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
        No invoice to show yet.
      </span>
    );
  }

  const svg = rendered?.key === key ? rendered.svg : null;

  return (
    <div className="flex flex-col items-center gap-2" data-testid="lightning-invoice">
      {svg ? (
        <img
          alt={`Lightning invoice QR${amountSats ? ` for ${amountSats} sats` : ''}`}
          data-testid="lightning-invoice-qr"
          width={size}
          height={size}
          style={{ background: '#fff', border: '1px solid var(--np-rule)', padding: 4 }}
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        />
      ) : failedKey === key ? (
        <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
          QR unavailable - copy the invoice instead.
        </span>
      ) : (
        <span
          data-testid="lightning-invoice-qr-loading"
          aria-hidden="true"
          style={{ width: size, height: size, border: '1px solid var(--np-rule)', background: 'var(--np-bg)' }}
        />
      )}
      {caption && (
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          {caption}
        </span>
      )}
      <div className="w-full break-all rounded bg-black/5 p-2 text-[9px] font-mono" data-testid="lightning-invoice-text">
        {pr}
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded border px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          {copied ? 'Copied ✓' : 'Copy invoice'}
        </button>
        <a
          href={`lightning:${pr}`}
          className="rounded border px-3 py-1.5 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          Open in wallet
        </a>
        {weblnAvailable && (
          <button
            type="button"
            onClick={() => void payWithWebln()}
            className="rounded border px-3 py-1.5 text-xs font-bold"
            style={{ borderColor: 'var(--np-accent)', background: 'var(--np-accent)', color: 'var(--np-on-accent)' }}
          >
            Pay with browser wallet
          </button>
        )}
      </div>
      {(error || status || weblnMsg) && (
        <p
          aria-live="polite"
          className="text-center text-[11px]"
          style={{ color: error ? 'var(--np-error, #b91c1c)' : 'var(--np-muted)' }}
        >
          {error ?? status ?? weblnMsg}
        </p>
      )}
    </div>
  );
}

export default LightningInvoice;
