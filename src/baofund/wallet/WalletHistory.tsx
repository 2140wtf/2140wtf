/**
 * WalletHistory - local operation history (2140 parity): receive, send,
 * Lightning top-up and Lightning payment, newest first. Presentational; the
 * data lives in walletHistory.ts and is mirrored by useWallet.
 */
import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Zap, Send } from 'lucide-react';
import { testnet4ExplorerTxUrl } from '../lib/testnet4Rail';
import { liquidTestnetExplorerTxUrl } from '../lib/liquidTestnetRail';
import type { WalletTransaction, WalletTxRail, WalletTxType } from './walletHistory';

const TYPE_LABEL: Record<WalletTxType, string> = {
  receive: 'Received',
  send: 'Sent',
  topup: 'Top-up',
  pay: 'Lightning paid',
};

const RAIL_LABEL: Record<WalletTxRail, string> = {
  l1: 'Bitcoin testnet4',
  liquid: 'Liquid testnet',
};

function railExplorerTxUrl(rail: WalletTxRail, txid: string): string {
  return rail === 'liquid' ? liquidTestnetExplorerTxUrl(txid) : testnet4ExplorerTxUrl(txid);
}

function TypeIcon({ type }: { type: WalletTxType }): React.ReactElement {
  const size = 11;
  if (type === 'receive') return <ArrowDownLeft size={size} />;
  if (type === 'send') return <ArrowUpRight size={size} />;
  if (type === 'topup') return <Zap size={size} />;
  return <Send size={size} />;
}

/** Short mint label: host + first path segment, never the full URL. */
export function shortMintLabel(mintUrl: string): string {
  try {
    const u = new URL(mintUrl);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname}${path && path !== '/' ? path : ''}`;
  } catch {
    return mintUrl;
  }
}

export function WalletHistory({
  transactions,
  onClear,
}: {
  transactions: WalletTransaction[];
  onClear?: () => void;
}): React.ReactElement {
  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--np-rule)' }} data-testid="wallet-history">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>History</h4>
        {transactions.length > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] underline"
            style={{ color: 'var(--np-muted)' }}
          >
            Clear
          </button>
        )}
      </div>
      {transactions.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--np-muted)' }}>
          No wallet activity yet.
        </p>
      ) : (
        <ul className="max-h-44 space-y-1 overflow-y-auto text-[11px]" style={{ fontFamily: 'var(--np-font-mono)' }}>
          {transactions.slice(0, 50).map((tx) => (
            <li
              key={tx.id}
              className="flex items-center gap-2 border-b pb-1"
              style={{ borderColor: 'var(--np-rule)' }}
              data-testid="wallet-history-item"
            >
              <span style={{ color: tx.type === 'receive' || tx.type === 'topup' ? 'var(--np-success)' : 'var(--np-ink)' }}>
                <TypeIcon type={tx.type} />
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--np-ink)' }}>
                {TYPE_LABEL[tx.type]} · {tx.rail ? RAIL_LABEL[tx.rail] : shortMintLabel(tx.mintUrl)}
              </span>
              {tx.rail && tx.txid && (
                <a
                  href={railExplorerTxUrl(tx.rail, tx.txid)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 underline"
                  style={{ color: 'var(--np-muted)' }}
                  title={`${tx.txid} (explorer)`}
                  data-testid="wallet-history-tx-link"
                >
                  tx {tx.txid.slice(0, 6)}…{tx.txid.slice(-4)}
                </a>
              )}
              <span className="shrink-0" style={{ color: tx.type === 'send' || tx.type === 'pay' ? 'var(--np-error, #b91c1c)' : 'var(--np-success)' }}>
                {tx.type === 'send' || tx.type === 'pay' ? '-' : '+'}
                {tx.amountSats.toLocaleString()}
                {tx.feeSats ? ` (fee ${tx.feeSats})` : ''}
              </span>
              <span className="shrink-0 text-[9px]" style={{ color: 'var(--np-muted)' }}>
                {new Date(tx.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WalletHistory;
