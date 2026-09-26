/**
 * EscrowAddressQR - the campaign escrow deposit address as a scannable QR.
 *
 * Renders the QR as an SVG data-URL (the `qrcode` package's canvas-free path),
 * so it works without a canvas polyfill in tests. Testnet only: the address is
 * a no-value faucet target; the UI still prints it as text for copy/paste.
 */

import React from 'react';
import QRCode from 'qrcode';

export interface EscrowAddressQRProps {
  address: string;
  /** Rendered size in px (default 168). */
  size?: number;
  /** Small caption under the code. */
  caption?: string;
}

export function EscrowAddressQR({ address, size = 168, caption }: EscrowAddressQRProps): React.ReactElement {
  // Results are keyed by input so a changed address never shows a stale code
  // and the effect itself never calls setState synchronously.
  const key = `${address}\u0000${size}`;
  const [rendered, setRendered] = React.useState<{ key: string; svg: string } | null>(null);
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  const empty = address.trim().length === 0;

  React.useEffect(() => {
    if (empty) return;
    let cancelled = false;
    QRCode.toString(address, { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then((out) => {
        if (!cancelled) {
          setRendered({ key, svg: out });
          // A retry for the same address must be able to clear a previous
          // failure - otherwise "QR unavailable" sticks forever.
          setFailedKey((prev) => (prev === key ? null : prev));
        }
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [address, size, key, empty]);

  if (empty || failedKey === key) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
        QR unavailable - copy the address instead.
      </span>
    );
  }

  const svg = rendered?.key === key ? rendered.svg : null;

  return (
    <span className="inline-flex flex-col items-center gap-1">
      {svg ? (
        <img
          alt={`Escrow address QR: ${address}`}
          data-testid="escrow-address-qr"
          width={size}
          height={size}
          style={{ background: '#fff', border: '1px solid var(--np-rule)', padding: 4 }}
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        />
      ) : (
        <span
          data-testid="escrow-address-qr-loading"
          aria-hidden="true"
          style={{ width: size, height: size, border: '1px solid var(--np-rule)', background: 'var(--np-bg)' }}
        />
      )}
      {caption && (
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
          {caption}
        </span>
      )}
    </span>
  );
}

export default EscrowAddressQR;
