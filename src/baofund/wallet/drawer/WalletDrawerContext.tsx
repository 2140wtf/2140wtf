import React from 'react';

/**
 * WalletDrawerContext — global drawer state for the wallet quick panel.
 *
 * Any surface (the nav account bar, the pledge modal, an agent prompt) can
 * open it with a DOM event, the bao.markets pattern:
 *   window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'send' } }))
 * The drawer itself renders once, at the app root.
 */
export type WalletDrawerTab = 'balances' | 'send' | 'receive' | 'history';
export type WalletDrawerRail = 'l1' | 'liquid';

/** Pre-fill handed to the drawer by a caller (e.g. the pledge modal). */
export interface WalletDrawerSendIntent {
  rail?: WalletDrawerRail;
  to?: string;
  sats?: string;
}

export interface WalletDrawerApi {
  isOpen: boolean;
  activeTab: WalletDrawerTab;
  /** Last send intent supplied to openDrawer (escrow address/amount pre-fill). */
  sendIntent: WalletDrawerSendIntent | null;
  openDrawer: (opts?: { tab?: WalletDrawerTab; send?: WalletDrawerSendIntent }) => void;
  closeDrawer: () => void;
  setActiveTab: (tab: WalletDrawerTab) => void;
}

const WalletDrawerContext = React.createContext<WalletDrawerApi | null>(null);

export function WalletDrawerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<WalletDrawerTab>('balances');
  const [sendIntent, setSendIntent] = React.useState<WalletDrawerSendIntent | null>(null);

  React.useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ tab?: WalletDrawerTab; send?: WalletDrawerSendIntent; rail?: WalletDrawerRail; to?: string; sats?: string }>).detail;
      setSendIntent(detail?.send ?? (detail?.to || detail?.rail || detail?.sats
        ? { rail: detail.rail, to: detail.to, sats: detail.sats }
        : null));
      if (detail?.tab) setActiveTab(detail.tab);
      setIsOpen(true);
    };
    const onClose = (): void => setIsOpen(false);
    window.addEventListener('bao-open-wallet-drawer', onOpen);
    window.addEventListener('bao-close-wallet-drawer', onClose);
    return () => {
      window.removeEventListener('bao-open-wallet-drawer', onOpen);
      window.removeEventListener('bao-close-wallet-drawer', onClose);
    };
  }, []);

  const api = React.useMemo<WalletDrawerApi>(() => ({
    isOpen,
    activeTab,
    sendIntent,
    openDrawer: (opts) => {
      // A plain open CLEARS any previous send intent: a stale escrow prefill
      // must never leak into a later, unrelated send (money-path footgun -
      // the event path below behaves the same way).
      setSendIntent(opts?.send ?? null);
      if (opts?.tab) setActiveTab(opts.tab);
      setIsOpen(true);
    },
    closeDrawer: () => setIsOpen(false),
    setActiveTab,
  }), [isOpen, activeTab, sendIntent]);

  return <WalletDrawerContext.Provider value={api}>{children}</WalletDrawerContext.Provider>;
}

export function useWalletDrawer(): WalletDrawerApi {
  const ctx = React.useContext(WalletDrawerContext);
  if (!ctx) throw new Error('useWalletDrawer must be used inside WalletDrawerProvider');
  return ctx;
}
