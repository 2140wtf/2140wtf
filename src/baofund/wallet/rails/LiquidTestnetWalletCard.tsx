import React from 'react';
import QRCode from 'qrcode';
import { ArrowUpRight, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { balanceBreakdown } from '../angorPatterns';
import { recordRailSend } from '../walletHistory';
import {
  deriveLiquidTestnetAccount,
  deriveLiquidTestnetAccountFromSeed,
  generateLiquidTestnetMnemonic,
  importLiquidTestnetAccountFromMnemonic,
  scanLiquidTestnetUtxos,
  sendLiquidTestnet,
  type LiquidTestnetAccount,
  type LiquidUnblindFn,
  type LiquidUtxo,
} from './liquidTestnetAccount';
import {
  LIQUID_TESTNET_EXPLORER_BASE,
  LIQUID_TESTNET_NO_VALUE_BADGE,
  liquidTestnetExplorerAddressUrl,
  liquidTestnetExplorerTxUrl,
} from '../../lib/liquidTestnetRail';
import {
  clearRailWallet,
  loadRailWallet,
  normalizeRailWalletMnemonic,
  readLiquidReceiveIndex,
  saveLiquidReceiveIndex,
  saveRailWallet,
  type RailWalletRecord,
  type RailWalletSource,
} from './railWalletStore';

/**
 * LiquidTestnetWalletCard — the live Liquid-testnet holding wallet on /wallet.
 *
 * Markets-parity keys (frozen cross-app derivation), non-custodial: keys are
 * derived from the signed-in seed identity, confidential UTXOs are unblinded
 * in the browser and sends are signed locally. A created/imported mnemonic
 * wallet is stored per identity (`rails/railWalletStore.ts`, rail 'liquid')
 * and re-activates on reload; it takes precedence over the identity-derived
 * session account. The words are the only backup — reveal/forget are explicit,
 * confirmed actions. This module pulls liquidjs-lib + the zkp wasm, so
 * WalletPanel loads it lazily.
 */
export interface LiquidTestnetWalletCardProps {
  /** Seed identity hex (useAuth.seedIdentityHex()); null when unavailable. */
  identityHex: string | null;
  /** Signed-in pubkey for per-identity wallet storage; null = signed out. */
  identityPubkey: string | null;
  /** Pre-fill for the send form (e.g. the pledge modal's escrow address). */
  initialTo?: string;
  initialSats?: string;
  /** Injected for tests (chain reads + unblinding). */
  fetchFn?: typeof fetch;
  unblind?: LiquidUnblindFn;
}

/** Public captcha-free Liquid testnet faucet (GET form; fixed 100k sats LBTC). */
export const LIQUID_TESTNET_FAUCET_BASE = 'https://liquidtestnet.com/faucet';

/** Prefilled faucet URL for an address (confidential or unconfidential). */
export function liquidTestnetFaucetUrl(address: string): string {
  return `${LIQUID_TESTNET_FAUCET_BASE}?address=${encodeURIComponent(address)}&action=lbtc`;
}

/** The active created/imported wallet, pinned to the identity that owns it. */
interface BrowserWalletState {
  pubkey: string | null;
  account: LiquidTestnetAccount;
  record: RailWalletRecord;
  /** False while signed out / storage-refusing: the wallet is tab-only. */
  persisted: boolean;
}

export function LiquidTestnetWalletCard({ identityHex, identityPubkey, initialTo, initialSats, fetchFn, unblind }: LiquidTestnetWalletCardProps): React.ReactElement {
  // The session account is a pure function of the signed-in seed identity -
  // derive during render (memo) instead of mirroring props into state.
  const session = React.useMemo((): { account: LiquidTestnetAccount | null; error: string | null } => {
    if (!identityHex) return { account: null, error: null };
    try {
      return { account: deriveLiquidTestnetAccount(identityHex), error: null };
    } catch (e) {
      return { account: null, error: e instanceof Error ? e.message : 'could not derive the liquid account' };
    }
  }, [identityHex]);

  // Created/imported mnemonics are pinned to the identity that owns them, so
  // an account switch cannot keep spending a stale wallet.
  const [browserWallet, setBrowserWallet] = React.useState<BrowserWalletState | null>(null);
  const stored = browserWallet && browserWallet.pubkey === identityPubkey ? browserWallet : null;
  // Readable from the identity-change effect without making it re-run.
  const browserWalletRef = React.useRef<BrowserWalletState | null>(null);
  React.useEffect(() => {
    browserWalletRef.current = browserWallet;
  }, [browserWallet]);

  const [showImport, setShowImport] = React.useState(false);
  const [mnemonicInput, setMnemonicInput] = React.useState('');
  const [importError, setImportError] = React.useState<string | null>(null);
  const [newMnemonic, setNewMnemonic] = React.useState<string | null>(null);
  const [revealWords, setRevealWords] = React.useState(false);
  const [confirmForget, setConfirmForget] = React.useState(false);

  const [receiveIndex, setReceiveIndex] = React.useState(0);
  const [utxos, setUtxos] = React.useState<LiquidUtxo[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showUnconfidential, setShowUnconfidential] = React.useState(false);
  const [qr, setQr] = React.useState<{ address: string; url: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [sendTo, setSendTo] = React.useState(initialTo ?? '');
  const [sendSats, setSendSats] = React.useState(initialSats ?? '');
  const [sending, setSending] = React.useState(false);
  const [sendTxid, setSendTxid] = React.useState<string | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);

  // Precedence: a wallet created/imported in this browser for the signed-in
  // identity wins over the identity-derived session account.
  const active = stored?.account ?? session.account;
  const activeSource: RailWalletSource | 'session' | null = stored
    ? stored.record.source
    : session.account
      ? 'session'
      : null;
  // The displayed receive pair is derived at the CURRENT cursor index; the
  // `active` account stays the seed carrier for scans/sends (which derive
  // every index 0..receiveIndex internally).
  const receiveAccount = React.useMemo((): LiquidTestnetAccount | null => {
    if (!active) return null;
    try {
      return receiveIndex === active.index ? active : deriveLiquidTestnetAccountFromSeed(active.seed, receiveIndex);
    } catch {
      return null;
    }
  }, [active, receiveIndex]);
  const receiveAddress = receiveAccount ? (showUnconfidential ? receiveAccount.unconfidentialAddress : receiveAccount.confidentialAddress) : null;
  const explorerAddress = receiveAccount?.unconfidentialAddress ?? null;

  // Per-identity receive cursor: restore on sign-in / identity switch.
  React.useEffect(() => {
    if (!identityPubkey) return;
    // Deferred: a synchronous setState in an effect cascades renders (the
    // repo's react-hooks gate rejects it).
    void Promise.resolve().then(() => setReceiveIndex(readLiquidReceiveIndex(identityPubkey)));
  }, [identityPubkey]);

  // Reload-safe activation: re-derive the stored browser wallet on mount /
  // identity change. A corrupt record degrades to the session account.
  React.useEffect(() => {
    if (!identityPubkey) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const record = loadRailWallet(identityPubkey, 'liquid');
      if (record) {
        try {
          setBrowserWallet({
            pubkey: identityPubkey,
            account: importLiquidTestnetAccountFromMnemonic(record.mnemonic),
            record,
            persisted: true,
          });
        } catch {
          setBrowserWallet(null);
        }
        return;
      }
      // No stored wallet for this identity: adopt a wallet created in this
      // tab while signed out instead of dropping it silently on sign-in.
      const previous = browserWalletRef.current;
      if (previous && !previous.persisted) {
        setBrowserWallet({
          ...previous,
          pubkey: identityPubkey,
          persisted: saveRailWallet(identityPubkey, 'liquid', previous.record),
        });
        return;
      }
      setBrowserWallet(null);
    });
    return () => {
      cancelled = true;
    };
  }, [identityPubkey]);

  React.useEffect(() => {
    if (!receiveAddress) return;
    let cancelled = false;
    QRCode.toDataURL(receiveAddress, { width: 190, margin: 1 })
      .then((url) => {
        if (!cancelled) setQr({ address: receiveAddress, url });
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [receiveAddress]);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!active) return;
    setLoading(true);
    setLoadError(null);
    try {
      const list = await scanLiquidTestnetUtxos(active, {
        receiveIndex,
        ...(fetchFn ? { fetchFn } : {}),
        ...(unblind ? { unblind } : {}),
      });
      setUtxos(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'could not scan the wallet');
    } finally {
      setLoading(false);
    }
  }, [active, receiveIndex, fetchFn, unblind]);

  React.useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const balance = utxos ? balanceBreakdown(utxos, new Set<string>()) : null;

  const copyAddress = (): void => {
    if (!receiveAddress) return;
    void navigator.clipboard?.writeText(receiveAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  const bumpReceiveIndex = (): void => {
    const next = receiveIndex + 1;
    setReceiveIndex(next);
    saveLiquidReceiveIndex(identityPubkey, next);
  };

  const activateBrowserWallet = (account: LiquidTestnetAccount, mnemonic: string, source: RailWalletSource): void => {
    const record: RailWalletRecord = {
      version: 1,
      mnemonic,
      createdAt: Math.floor(Date.now() / 1000),
      source,
    };
    // Persist for the signed-in identity; signed out (or storage-refusing
    // browser) the wallet still works for this tab, it just cannot reload.
    const persisted = identityPubkey ? saveRailWallet(identityPubkey, 'liquid', record) : false;
    setBrowserWallet({ pubkey: identityPubkey, account, record, persisted });
    // A fresh wallet starts its receive chain at index 0.
    setReceiveIndex(0);
    saveLiquidReceiveIndex(identityPubkey, 0);
    setNewMnemonic(source === 'created' ? mnemonic : null);
    setMnemonicInput('');
    // Keep the panel open for a created wallet so the words are shown once;
    // an import has nothing new to reveal.
    setShowImport(source === 'created');
    setImportError(null);
    setRevealWords(false);
    setConfirmForget(false);
  };

  const doImport = (): void => {
    setImportError(null);
    try {
      const account = importLiquidTestnetAccountFromMnemonic(mnemonicInput);
      const mnemonic = normalizeRailWalletMnemonic(mnemonicInput) ?? mnemonicInput.trim();
      activateBrowserWallet(account, mnemonic, 'imported');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'invalid mnemonic');
    }
  };

  const doGenerate = (): void => {
    setImportError(null);
    try {
      const mnemonic = generateLiquidTestnetMnemonic(12);
      activateBrowserWallet(importLiquidTestnetAccountFromMnemonic(mnemonic), mnemonic, 'created');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'could not generate a mnemonic');
    }
  };

  const doForget = (): void => {
    if (!identityPubkey) return;
    clearRailWallet(identityPubkey, 'liquid');
    setBrowserWallet(null);
    setReceiveIndex(0);
    saveLiquidReceiveIndex(identityPubkey, 0);
    setNewMnemonic(null);
    setRevealWords(false);
    setConfirmForget(false);
  };

  const doSend = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!active) return;
    const sats = Number(sendSats);
    setSendError(null);
    setSendTxid(null);
    setSending(true);
    try {
      const outcome = await sendLiquidTestnet(active, {
        to: sendTo.trim(),
        sats: Number.isFinite(sats) ? Math.floor(sats) : 0,
        receiveIndex,
        ...(utxos ? { utxos } : {}),
        ...(fetchFn ? { fetchFn } : {}),
        ...(unblind ? { unblind } : {}),
      });
      if (!outcome.ok) {
        setSendError(outcome.message);
        return;
      }
      setSendTxid(outcome.txid);
      recordRailSend('liquid', Number.isFinite(sats) ? Math.floor(sats) : 0, outcome.txid, outcome.feeSats);
      setSendTo('');
      setSendSats('');
      void refresh();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }} data-testid="liquid-wallet-card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-lg font-bold">Liquid testnet</h3>
        <span
          className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]"
          style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
        >
          {LIQUID_TESTNET_NO_VALUE_BADGE}
        </span>
        {activeSource === 'created' && (
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent-2)' }} data-testid="liquid-wallet-source">created · browser</span>
        )}
        {activeSource === 'imported' && (
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent-2)' }} data-testid="liquid-wallet-source">imported · browser</span>
        )}
      </div>
      <p className={active ? 'mb-1 text-[10px]' : 'mb-3 text-[10px]'} style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        your keys, your coins · confidential (tlq1) + unconfidential (tex1)
      </p>
      {active && (
        <p className="mb-3 text-[10px]" data-testid="liquid-active-wallet" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
          {activeSource === 'session'
            ? 'Active wallet: identity-derived session wallet'
            : `Active wallet: ${activeSource} browser wallet${stored?.persisted ? ' (saved for this identity)' : ' (this tab only - sign in to save)'}`}
        </p>
      )}

      {!active && (
        <div className="mb-3 space-y-2 text-[11px]" style={{ color: 'var(--np-muted)' }}>
          {session.error ? (
            <p style={{ color: 'var(--np-error, #b91c1c)' }}>{session.error}</p>
          ) : (
            <p>
              {identityHex
                ? 'Deriving your Liquid wallet…'
                : 'Sign in with a seed identity to derive your Liquid testnet wallet, or import a mnemonic below.'}
            </p>
          )}
        </div>
      )}

      {active && receiveAddress && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
            <span>Receive</span>
            <span className="flex items-center gap-2" style={{ fontFamily: 'var(--np-font-mono)' }}>
              <span data-testid="liquid-receive-index">index {receiveIndex}</span>
              <button
                type="button"
                onClick={() => setShowUnconfidential((v) => !v)}
                className="underline"
                style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
              >
                {showUnconfidential ? 'confidential tlq1 →' : 'unconfidential tex1 →'}
              </button>
            </span>
          </div>
          {qr?.address === receiveAddress && (
            <div className="flex justify-center">
              <img src={qr.url} alt="Liquid testnet receive address QR" width={190} height={190} className="bg-white p-1" data-testid="liquid-receive-qr" />
            </div>
          )}
          <p className="break-all text-center text-[11px] select-all" style={{ fontFamily: 'var(--np-font-mono)' }}>{receiveAddress}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyAddress} className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
              <Copy size={13} className="mr-1 inline" />{copied ? 'Copied' : 'Copy address'}
            </button>
            {explorerAddress && (
              <a href={liquidTestnetExplorerAddressUrl(explorerAddress)} target="_blank" rel="noreferrer" className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
                <ExternalLink size={13} className="mr-1 inline" />Explorer
              </a>
            )}
            <a
              href={liquidTestnetFaucetUrl(receiveAddress)}
              target="_blank"
              rel="noreferrer"
              data-testid="liquid-faucet-link"
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
            >
              <ExternalLink size={13} className="mr-1 inline" />Get testnet coins
            </a>
            <button
              type="button"
              onClick={bumpReceiveIndex}
              data-testid="liquid-new-address"
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
            >
              New address
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: 'var(--np-rule)' }}>
              <RefreshCw size={13} className="mr-1 inline" />{loading ? 'Scanning…' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center" data-testid="liquid-balance">
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Available</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{balance ? balance.confirmedAvailable.toLocaleString() : '—'}</div>
            </div>
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Unconfirmed</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{balance ? balance.unconfirmed.toLocaleString() : '—'}</div>
            </div>
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>UTXOs</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{utxos ? utxos.length : '—'}</div>
            </div>
          </div>
          {loadError && <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{loadError}</p>}
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            Need coins? "Get testnet coins" opens the public captcha-free faucet
            (<a className="underline" style={{ color: 'var(--np-accent-2)' }} href={LIQUID_TESTNET_FAUCET_BASE} target="_blank" rel="noreferrer">liquidtestnet.com/faucet</a>)
            prefilled with the address above; it pays a fixed 100,000 sats of valueless LBTC. Agents can
            claim from the CLI with <code style={{ fontFamily: 'var(--np-font-mono)' }}>scripts/faucet-claim.mjs</code>.
            Refresh after the faucet confirms.
          </p>
        </div>
      )}

      {active && (
        <form onSubmit={(e) => void doSend(e)} className="mb-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Send LBTC (testnet)</div>
          <input
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            placeholder="tex1… / tlq1… destination (escrow or wallet)"
            data-testid="liquid-send-to"
            className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          />
          <div className="flex gap-2">
            <input
              value={sendSats}
              onChange={(e) => setSendSats(e.target.value)}
              placeholder="sats"
              inputMode="numeric"
              data-testid="liquid-send-amount"
              className="min-w-0 flex-1 rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
          </div>
          <button type="submit" disabled={sending || !sendTo.trim() || !sendSats} className="w-full rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}>
            <ArrowUpRight size={14} className="mr-1 inline" />{sending ? 'Signing & broadcasting…' : 'Send'}
          </button>
          {sendTxid && (
            <a href={liquidTestnetExplorerTxUrl(sendTxid)} target="_blank" rel="noreferrer" className="block text-[11px] underline" style={{ color: 'var(--np-success)' }}>
              Sent · view on blockstream.info
            </a>
          )}
          {sendError && <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{sendError}</p>}
        </form>
      )}

      <div className="border-t pt-3" style={{ borderColor: 'var(--np-rule)' }}>
        {stored && (
          <div className="mb-3 space-y-2 rounded border p-2" style={{ borderColor: 'var(--np-rule)' }} data-testid="liquid-browser-wallet">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent)' }}>
              {stored.record.source} browser wallet
              {stored.persisted ? ' · saved for this identity' : ' · this tab only - sign in to save'}
            </p>
            <button
              type="button"
              onClick={() => setRevealWords((v) => !v)}
              data-testid="liquid-reveal-words"
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <KeyRound size={12} className="mr-1 inline" />{revealWords ? 'Hide recovery words' : 'Reveal recovery words'}
            </button>
            {revealWords && (
              <div className="rounded border p-2" style={{ borderColor: 'var(--np-accent)' }}>
                <p className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent)' }}>
                  Recovery words - the only backup (testnet only, no value)
                </p>
                <p className="break-words text-xs select-all" data-testid="liquid-recovery-words" style={{ fontFamily: 'var(--np-font-mono)' }}>
                  {stored.record.mnemonic}
                </p>
              </div>
            )}
            {stored.persisted && !confirmForget && (
              <button
                type="button"
                onClick={() => setConfirmForget(true)}
                data-testid="liquid-forget-wallet"
                className="text-[10px] uppercase tracking-widest underline"
                style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
              >
                Forget this browser wallet
              </button>
            )}
            {stored.persisted && confirmForget && (
              <div className="space-y-2" data-testid="liquid-forget-confirm">
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--np-error, #b91c1c)' }}>
                  The recovery words are the ONLY backup. If you have not written them down, this wallet and any
                  testnet coins on it are gone for good.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={doForget}
                    data-testid="liquid-forget-confirmed"
                    className="rounded border px-3 py-1.5 text-xs"
                    style={{ borderColor: 'var(--np-error, #b91c1c)', color: 'var(--np-error, #b91c1c)' }}
                  >
                    Yes, forget it
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmForget(false)}
                    className="rounded border px-3 py-1.5 text-xs"
                    style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowImport((s) => !s)}
          className="text-[10px] uppercase tracking-widest underline"
          style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
        >
          <KeyRound size={11} className="mr-1 inline" />{showImport ? 'Hide mnemonic import' : 'Import / generate mnemonic wallet'}
        </button>
        {showImport && (
          <div className="mt-2 space-y-2">
            <textarea
              value={mnemonicInput}
              onChange={(e) => setMnemonicInput(e.target.value)}
              rows={2}
              placeholder="12 or 24 word mnemonic"
              data-testid="liquid-mnemonic-input"
              className="w-full rounded border bg-transparent px-3 py-2 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
            />
            {importError && <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{importError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={doImport} disabled={!mnemonicInput.trim()} className="flex-1 rounded border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: 'var(--np-rule)' }}>
                Import wallet
              </button>
              <button type="button" onClick={doGenerate} className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
                New mnemonic
              </button>
            </div>
            {newMnemonic && (
              <div className="rounded border p-2" style={{ borderColor: 'var(--np-accent)' }}>
                <p className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent)' }}>
                  Write these down - they are the only backup (reveal again above)
                </p>
                <p className="break-words text-xs select-all" style={{ fontFamily: 'var(--np-font-mono)' }}>{newMnemonic}</p>
              </div>
            )}
            <p className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
              A fresh mnemonic wallet is independent of your login seed. When signed in it is saved in this
              browser for your identity (testnet only, no value) and reloads automatically; signed out it stays
              in this tab only. The words are the only backup - write them down.
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1 text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        <ShieldCheck size={11} /> non-custodial · unblinded in-browser · explorer {LIQUID_TESTNET_EXPLORER_BASE.replace('https://', '')}
      </div>
    </div>
  );
}
