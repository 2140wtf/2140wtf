/**
 * SupportZap - paper-edition donation block with the same flow as the Court
 * landing page (court.bao.network): Lightning address + copy, suggested
 * amounts, and a fresh-invoice panel (QR, copy, open-in-wallet, WebLN).
 *
 * Backed by the FUND API's LNURL proxy (/v1/lnurl/resolve, /v1/lnurl/invoice):
 * the address is resolved server-side (SSRF-guarded) so browser CORS never
 * blocks a provider, and the fund frontend keeps its own API boundary.
 *
 * Used by the bao.network hub (bao@rizful.com) and the fund app
 * (baofund@rizful.com). No custody anywhere - the invoice is created by the
 * provider and paid directly by the visitor's wallet.
 */
import React from 'react';
import QRCode from 'qrcode';

import { fundApiOrigin } from '../../lib/fundHttp';

/** Court-page parity: the same suggested amounts in sats. */
const DEFAULT_AMOUNTS = [214, 1111, 2140, 5000, 21400, 42140, 100000, 214000] as const;

interface WebLnProvider {
  enable?: () => Promise<void>;
  sendPayment: (paymentRequest: string) => Promise<unknown>;
}

export interface SupportZapProps {
  /** Lightning address shown and paid (e.g. bao@rizful.com). */
  address: string;
  /** Section heading, e.g. "Support BAO". */
  title: string;
  /** One-line explanation under the heading. */
  blurb: string;
  /** Small caps kicker above the heading (optional). */
  kicker?: string;
  /** Right-hand section note next to the kicker (optional). */
  sectionNo?: string;
  /** Fine print under the block (optional). */
  fine?: string;
  amounts?: readonly number[];
}

export function SupportZap({
  address,
  title,
  blurb,
  kicker,
  sectionNo,
  fine,
  amounts = DEFAULT_AMOUNTS,
}: SupportZapProps): React.ReactElement {
  const [copiedAddr, setCopiedAddr] = React.useState(false);
  const [panelLabel, setPanelLabel] = React.useState<string | null>(null);
  const [invoice, setInvoice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Wallet payment in flight: amount switches must not relabel the panel
  // while a wallet is signing (a success message would land on the NEW
  // amount's invoice and invite a double payment).
  const [paying, setPaying] = React.useState(false);
  const [copiedInvoice, setCopiedInvoice] = React.useState(false);
  const [message, setMessage] = React.useState('Scan with any Lightning wallet.');
  const [isError, setIsError] = React.useState(false);
  const qrRef = React.useRef<HTMLDivElement>(null);
  const lnurlRef = React.useRef<{ callback: string } | null>(null);

  const webln = typeof window !== 'undefined'
    ? (window as unknown as { webln?: WebLnProvider }).webln
    : undefined;
  const weblnAvailable = typeof webln?.sendPayment === 'function';

  const setMsg = (text: string, err = false): void => {
    setMessage(text);
    setIsError(err);
  };

  const copyAddress = (): void => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1500);
    }).catch(() => undefined);
  };

  const copyInvoice = (): void => {
    if (!invoice) return;
    void navigator.clipboard?.writeText(invoice).then(() => {
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 1500);
    }).catch(() => undefined);
  };

  const resolveLnurl = async (): Promise<{ callback: string }> => {
    if (lnurlRef.current) return lnurlRef.current;
    const res = await fetch(`${fundApiOrigin()}/v1/lnurl/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      // AGENTS: every outbound fetch is bounded - a wedged API must not pin
      // the donation block in "Creating a fresh invoice…" forever.
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { callback?: string; error?: { message?: string } };
    if (!res.ok || !data.callback) {
      throw new Error(data.error?.message || `Could not resolve ${address}.`);
    }
    lnurlRef.current = { callback: data.callback };
    return lnurlRef.current;
  };

  const requestInvoice = async (sats: number): Promise<string> => {
    const meta = await resolveLnurl();
    const res = await fetch(`${fundApiOrigin()}/v1/lnurl/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callbackUrl: meta.callback, amountMsats: sats * 1000 }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { pr?: string; error?: { message?: string } };
    if (!res.ok || !data.pr) {
      throw new Error(data.error?.message || 'Could not create the invoice.');
    }
    return data.pr;
  };

  const renderQr = (pr: string): void => {
    const box = qrRef.current;
    if (!box) return;
    box.innerHTML = '';
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    // BOLT11 is QR-alphanumeric when uppercased: a smaller, denser code.
    QRCode.toCanvas(canvas, pr.toUpperCase(), { width: 220, margin: 1 }, (err) => {
      if (err) setMsg('QR rendering failed - copy the invoice instead.', true);
    });
  };

  const zap = async (sats: number): Promise<void> => {
    if (busy || paying) return;
    setBusy(true);
    setPanelLabel(`${sats.toLocaleString()} sats - ${address}`);
    setInvoice(null);
    setCopiedInvoice(false);
    setMsg('Creating a fresh invoice...');
    // Clear the previous QR immediately: while the new invoice is being
    // created (or when creation fails) a stale code under the new label
    // would let an eager scan pay the wrong amount.
    if (qrRef.current) qrRef.current.innerHTML = '';
    try {
      const pr = await requestInvoice(sats);
      setInvoice(pr);
      renderQr(pr);
      setMsg(weblnAvailable
        ? 'Scan the QR, or pay directly from your browser wallet.'
        : 'Scan the QR with any Lightning wallet.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : 'Something went wrong - try again.', true);
    } finally {
      setBusy(false);
    }
  };

  const payWithWebln = async (): Promise<void> => {
    if (!invoice || !webln) return;
    const target = invoice;
    setPaying(true);
    try {
      setMsg('Waiting for your wallet...');
      await webln.enable?.();
      await webln.sendPayment(target);
      // Only report success when the SAME invoice is still on screen.
      setMsg(target === invoice
        ? 'Payment sent - thank you for keeping it running.'
        : 'Payment for the previous invoice was sent - the panel has moved on.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : 'The wallet did not complete the payment.', true);
    } finally {
      setPaying(false);
    }
  };

  const closePanel = (): void => {
    setPanelLabel(null);
    setInvoice(null);
    setMsg('Scan with any Lightning wallet.');
  };

  return (
    <div className="border-t pt-4" style={{ borderColor: 'var(--np-rule)' }}>
      {(kicker || sectionNo) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          {kicker && (
            <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}>
              {kicker}
            </span>
          )}
          {sectionNo && (
            <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              {sectionNo}
            </span>
          )}
        </div>
      )}
      <h3 className="font-serif text-xl font-bold">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--np-muted)' }}>{blurb}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm" style={{ color: 'var(--np-accent-2)' }}>{address}</span>
        <button
          type="button"
          onClick={copyAddress}
          className="rounded border px-2 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          {copiedAddr ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggested amounts in sats">
        {amounts.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy || paying}
            onClick={() => void zap(a)}
            className="rounded border px-2 py-1 font-mono text-xs disabled:opacity-50"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
          >
            {a.toLocaleString()}
          </button>
        ))}
      </div>

      {panelLabel && (
        <div className="mt-3 border p-3" style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
              {panelLabel}
            </span>
            <button
              type="button"
              onClick={closePanel}
              className="rounded border px-2 py-0.5 text-[10px]"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              Close
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-center gap-3">
            <div ref={qrRef} className="border bg-white p-1.5 leading-none" style={{ borderColor: 'var(--np-rule)' }} />
            <div className="flex min-w-[11rem] flex-1 flex-col gap-1.5">
              {weblnAvailable && invoice && (
                <button
                  type="button"
                  onClick={() => void payWithWebln()}
                  className="rounded border px-3 py-1.5 text-sm"
                  style={{ borderColor: 'var(--np-accent)', background: 'var(--np-accent)', color: 'var(--np-on-accent)' }}
                >
                  Pay with browser wallet
                </button>
              )}
              {invoice && (
                <>
                  <button
                    type="button"
                    onClick={copyInvoice}
                    className="rounded border px-3 py-1.5 text-sm"
                    style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                  >
                    {copiedInvoice ? 'Copied' : 'Copy invoice'}
                  </button>
                  <a
                    href={`lightning:${invoice}`}
                    className="rounded border px-3 py-1.5 text-center text-sm"
                    style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                  >
                    Open in wallet
                  </a>
                </>
              )}
              <p className="font-mono text-[10px]" style={{ color: isError ? 'var(--np-accent)' : 'var(--np-muted)' }} aria-live="polite">
                {message}
              </p>
            </div>
          </div>
        </div>
      )}

      {fine && (
        <p className="mt-3 text-[11px] leading-snug" style={{ color: 'var(--np-muted)' }}>{fine}</p>
      )}
    </div>
  );
}
