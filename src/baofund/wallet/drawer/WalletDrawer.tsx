import React from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { balanceBreakdown } from '../angorPatterns';
import { deriveTestnet4Account, scanTestnet4Utxos } from '../rails/testnet4Account';
import { Testnet4WalletCard } from '../rails/Testnet4WalletCard';
import { readLiquidReceiveIndex, readTestnet4Cursors } from '../rails/railWalletStore';
import { useNip60Wallet } from '../useNip60Wallet';
import { useWallet } from '../useWallet';
import { WalletHistory } from '../WalletHistory';
import { useWalletDrawer, type WalletDrawerTab } from './WalletDrawerContext';

const LiquidTestnetWalletCard = React.lazy(() =>
  import('../rails/LiquidTestnetWalletCard').then((m) => ({ default: m.LiquidTestnetWalletCard })),
);

type RailId = 'l1' | 'liquid';
interface RailBalance {
  state: 'loading' | 'ok' | 'error';
  total?: number;
  error?: string;
}

const DRAWER_TABS: Array<{ id: WalletDrawerTab; label: string }> = [
  { id: 'balances', label: 'Balances' },
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'history', label: 'History' },
];

function railRow(label: string, badge: string, balance: RailBalance, onRetry: () => void): React.ReactElement {
  return (
    <div className="flex items-center justify-between border-b py-2" style={{ borderColor: 'var(--np-rule)' }}>
      <div className="min-w-0">
        <div className="text-xs font-bold">{label}</div>
        <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>{badge}</div>
      </div>
      <div className="text-right">
        {balance.state === 'loading' && <span className="text-[11px]" style={{ color: 'var(--np-muted)' }}>scanning…</span>}
        {balance.state === 'ok' && (
          <span className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>
            {(balance.total ?? 0).toLocaleString()} <span className="text-[10px]">sats</span>
          </span>
        )}
        {balance.state === 'error' && (
          <button type="button" onClick={onRetry} className="text-[10px] underline" style={{ color: 'var(--np-error, #b91c1c)' }}>
            {balance.error ?? 'scan failed'} - retry
          </button>
        )}
      </div>
    </div>
  );
}

/** Live rail balances: Cashu + NIP-60 from their hooks, the on-chain rails scanned. */
function RailBalances(): React.ReactElement {
  const auth = useAuth();
  const cashu = useWallet();
  const portable = useNip60Wallet();
  const identityHex = auth.status === 'ready' ? auth.seedIdentityHex?.() ?? null : null;
  const identityPubkey = auth.status === 'ready' ? auth.pubkey ?? null : null;
  const [nonce, setNonce] = React.useState(0);
  const [rails, setRails] = React.useState<{ l1: RailBalance; liquid: RailBalance }>({
    l1: { state: 'loading' },
    liquid: { state: 'loading' },
  });

  React.useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!identityHex) {
        if (!cancelled) setRails({ l1: { state: 'error', error: 'sign in with a seed identity' }, liquid: { state: 'error', error: 'sign in with a seed identity' } });
        return;
      }
      try {
        const account = deriveTestnet4Account(identityHex);
        // Follow the card's persisted receive/change cursors so a rotated
        // wallet's balance is not under-reported.
        const cursors = readTestnet4Cursors(identityPubkey);
        const utxos = await scanTestnet4Utxos(account, { receiveIndex: cursors.receiveIndex, changeIndex: cursors.changeIndex });
        if (!cancelled) {
          setRails((prev) => ({ ...prev, l1: { state: 'ok', total: balanceBreakdown(utxos, new Set()).confirmedAvailable } }));
        }
      } catch (e) {
        if (!cancelled) setRails((prev) => ({ ...prev, l1: { state: 'error', error: e instanceof Error ? e.message : 'scan failed' } }));
      }
      try {
        const mod = await import('../rails/liquidTestnetAccount');
        const account = mod.deriveLiquidTestnetAccount(identityHex);
        // Follow the card's persisted receive cursor so a rotated wallet's
        // balance is not under-reported as 0.
        const utxos = await mod.scanLiquidTestnetUtxos(account, { receiveIndex: readLiquidReceiveIndex(identityPubkey) });
        if (!cancelled) {
          setRails((prev) => ({ ...prev, liquid: { state: 'ok', total: balanceBreakdown(utxos, new Set()).confirmedAvailable } }));
        }
      } catch (e) {
        if (!cancelled) setRails((prev) => ({ ...prev, liquid: { state: 'error', error: e instanceof Error ? e.message : 'scan failed' } }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [identityHex, identityPubkey, nonce]);

  const retry = (): void => {
    setRails({ l1: { state: 'loading' }, liquid: { state: 'loading' } });
    setNonce((n) => n + 1);
  };

  const portableLabel = portable.status === 'ready'
    ? `${portable.mints.length} mint${portable.mints.length === 1 ? '' : 's'}`
    : portable.status;

  return (
    <div data-testid="drawer-balances">
      {railRow('Cashu (this browser)', `${cashu.mints.length} mint(s) · ${cashu.mintUrl}`, { state: 'ok', total: cashu.totalBalanceSats }, retry)}
      {railRow('Cashu portable (NIP-60)', portableLabel, { state: 'ok', total: undefined }, retry)}
      {railRow('Bitcoin testnet4', 'no value', rails.l1, retry)}
      {railRow('Liquid testnet', 'no value · confidential', rails.liquid, retry)}
      <p className="mt-3 text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        On-chain balances are confirmed UTXOs of the wallet derived from your seed identity. The portable wallet row
        opens the full panel on the Wallet page - use the tabs above for on-chain send/receive.
      </p>
    </div>
  );
}

/** Send/Receive reuse the live rail cards (single source of truth per rail). */
function RailForms({ mode }: { mode: 'send' | 'receive' }): React.ReactElement {
  const auth = useAuth();
  const { sendIntent } = useWalletDrawer();
  const [rail, setRail] = React.useState<RailId>(sendIntent?.rail ?? 'l1');
  // A NEW send intent (e.g. a second pledge prefill while the drawer is
  // already open) must switch the rail with it - otherwise the pre-filled
  // escrow address would sit in the OTHER rail's form. Deferred: a
  // synchronous setState in the effect body is a cascading render.
  React.useEffect(() => {
    void Promise.resolve().then(() => setRail(sendIntent?.rail ?? 'l1'));
  }, [sendIntent]);
  const identityHex = auth.status === 'ready' ? auth.seedIdentityHex?.() ?? null : null;
  const identityPubkey = auth.status === 'ready' ? auth.pubkey ?? null : null;

  const pill = (id: RailId, label: string): React.ReactElement => (
    <button
      key={id}
      type="button"
      onClick={() => setRail(id)}
      className="flex-1 rounded border px-2 py-1 text-[10px] uppercase tracking-widest"
      style={{
        borderColor: rail === id ? 'var(--np-accent-2)' : 'var(--np-rule)',
        color: rail === id ? 'var(--np-accent-2)' : 'var(--np-muted)',
        fontFamily: 'var(--np-font-mono)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3" data-testid={`drawer-${mode}`}>
      <div className="flex gap-2">
        {pill('l1', 'Bitcoin testnet4')}
        {pill('liquid', 'Liquid testnet')}
      </div>
      {rail === 'l1' ? (
        <Testnet4WalletCard
          identityHex={identityHex}
          identityPubkey={identityPubkey}
          {...(sendIntent?.to ? { initialTo: sendIntent.to } : {})}
          {...(sendIntent?.sats ? { initialSats: sendIntent.sats } : {})}
        />
      ) : (
        <React.Suspense fallback={<p className="text-[11px]" style={{ color: 'var(--np-muted)' }}>Loading the Liquid wallet…</p>}>
          <LiquidTestnetWalletCard
            identityHex={identityHex}
            identityPubkey={identityPubkey}
            {...(sendIntent?.to ? { initialTo: sendIntent.to } : {})}
            {...(sendIntent?.sats ? { initialSats: sendIntent.sats } : {})}
          />
        </React.Suspense>
      )}
    </div>
  );
}

function DrawerHistory(): React.ReactElement {
  const cashu = useWallet();
  return (
    <div data-testid="drawer-history">
      <WalletHistory transactions={cashu.transactions} onClear={cashu.clearHistory} />
    </div>
  );
}

/**
 * WalletDrawer — right-side slide-out (bao.markets pattern) with the fund's
 * rail inventory: balances, send, receive, history. Opens via the context or
 * the global `bao-open-wallet-drawer` event; Escape closes.
 */
export function WalletDrawer(): React.ReactElement | null {
  const { isOpen, activeTab, closeDrawer, setActiveTab } = useWalletDrawer();

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, closeDrawer]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="wallet-drawer" role="dialog" aria-modal="true" aria-label="Wallet">
      <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} />
      <div
        className="absolute right-0 top-0 bottom-0 flex w-full max-w-[420px] flex-col border-l shadow-2xl"
        style={{ background: 'var(--np-paper)', borderColor: 'var(--np-rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--np-rule)' }}>
          <div>
            <div className="font-serif text-sm font-bold">₿AO Wallet · testnet</div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              cashu · bitcoin testnet4 · liquid testnet - no value
            </div>
          </div>
          <button type="button" onClick={closeDrawer} aria-label="Close wallet" className="rounded border p-1.5" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b px-3 py-2" style={{ borderColor: 'var(--np-rule)' }}>
          {DRAWER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 rounded px-2 py-1.5 text-[10px] uppercase tracking-widest"
              style={{
                background: activeTab === tab.id ? 'var(--np-accent-2)' : 'transparent',
                color: activeTab === tab.id ? 'var(--np-paper)' : 'var(--np-muted)',
                fontFamily: 'var(--np-font-mono)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {activeTab === 'balances' && <RailBalances />}
          {activeTab === 'send' && <RailForms mode="send" />}
          {activeTab === 'receive' && <RailForms mode="receive" />}
          {activeTab === 'history' && <DrawerHistory />}
        </div>
      </div>
    </div>
  );
}
