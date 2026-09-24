import React from 'react';
import QRCode from 'qrcode';
import { ArrowUpRight, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { PendingSpentTracker, balanceBreakdown } from '../angorPatterns';
import { recordRailSend } from '../walletHistory';
import {
  deriveTestnet4Account,
  generateTestnet4Mnemonic,
  importTestnet4AccountFromMnemonic,
  scanTestnet4Utxos,
  sendTestnet4,
  testnet4AddressAt,
  type Testnet4Account,
  type Testnet4FeeTier,
  type Testnet4Utxo,
} from './testnet4Account';
import {
  TESTNET4_EXPLORER_BASE,
  TESTNET4_NO_VALUE_BADGE,
  testnet4ExplorerAddressUrl,
  testnet4ExplorerTxUrl,
} from '../../lib/testnet4Rail';
import {
  clearRailWallet,
  loadRailWallet,
  normalizeRailWalletMnemonic,
  readTestnet4Cursors,
  saveRailWallet,
  saveTestnet4Cursors,
  type RailWalletRecord,
  type RailWalletSource,
} from './railWalletStore';

/**
 * Testnet4WalletCard — the live Bitcoin-testnet4 holding wallet on /wallet.
 *
 * Markets-parity account (frozen cross-app derivation), non-custodial:
 * keys stay in the browser. A created/imported mnemonic wallet is stored per
 * identity (`rails/railWalletStore.ts`) and re-activates on reload; it takes
 * precedence over the identity-derived session account. The words are the
 * only backup — reveal/forget are explicit, confirmed actions.
 * Balance is the UTXO set, shown as confirmed-available / unconfirmed /
 * reserved — never a single optimistic number.
 */
export interface Testnet4WalletCardProps {
  /** Seed identity hex (useAuth.seedIdentityHex()); null when unavailable. */
  identityHex: string | null;
  /** Signed-in pubkey for per-identity cursor storage; null = signed out. */
  identityPubkey: string | null;
  /** Pre-fill for the send form (e.g. the pledge modal's escrow address). */
  initialTo?: string;
  initialSats?: string;
  /** Injected for tests. */
  fetchFn?: typeof fetch;
}

/** Session-scoped reservations shared by every card instance in the tab. */
const SESSION_TRACKER = new PendingSpentTracker();
const EMPTY_RESERVED: ReadonlySet<string> = new Set<string>();

/** The active created/imported wallet, pinned to the identity that owns it. */
interface BrowserWalletState {
  pubkey: string | null;
  account: Testnet4Account;
  record: RailWalletRecord;
  /** False while signed out / storage-refusing: the wallet is tab-only. */
  persisted: boolean;
}

export function Testnet4WalletCard({ identityHex, identityPubkey, initialTo, initialSats, fetchFn }: Testnet4WalletCardProps): React.ReactElement {
  // The session account is a pure function of the signed-in seed identity -
  // derive during render (memo) instead of mirroring props into state.
  const session = React.useMemo((): { account: Testnet4Account | null; error: string | null } => {
    if (!identityHex) return { account: null, error: null };
    try {
      return { account: deriveTestnet4Account(identityHex), error: null };
    } catch (e) {
      return { account: null, error: e instanceof Error ? e.message : 'could not derive the testnet4 account' };
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
  const [changeIndex, setChangeIndex] = React.useState(0);
  const [reservedKeys, setReservedKeys] = React.useState<ReadonlySet<string>>(EMPTY_RESERVED);
  const [utxos, setUtxos] = React.useState<Testnet4Utxo[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [qr, setQr] = React.useState<{ address: string; url: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const [sendTo, setSendTo] = React.useState(initialTo ?? '');
  const [sendSats, setSendSats] = React.useState(initialSats ?? '');
  const [feeTier, setFeeTier] = React.useState<Testnet4FeeTier>('hour');
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
  const receiveAt = active ? testnet4AddressAt(active, 0, receiveIndex) : null;
  const receiveAddress = receiveAt?.address ?? null;

  // Per-identity cursor persistence (addresses/indexes only — never keys).
  // Helpers live in railWalletStore so the drawer can read the same cursors.
  React.useEffect(() => {
    if (!identityPubkey) return;
    // Deferred: a synchronous setState in an effect cascades renders (the
    // repo's react-hooks gate rejects it).
    void Promise.resolve().then(() => {
      const cursors = readTestnet4Cursors(identityPubkey);
      setReceiveIndex(cursors.receiveIndex);
      setChangeIndex(cursors.changeIndex);
      setReservedKeys(EMPTY_RESERVED);
    });
  }, [identityPubkey]);

  // Reload-safe activation: re-derive the stored browser wallet on mount /
  // identity change. A corrupt record degrades to the session account.
  React.useEffect(() => {
    if (!identityPubkey) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const record = loadRailWallet(identityPubkey, 'testnet4');
      if (record) {
        try {
          setBrowserWallet({
            pubkey: identityPubkey,
            account: importTestnet4AccountFromMnemonic(record.mnemonic),
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
          persisted: saveRailWallet(identityPubkey, 'testnet4', previous.record),
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
    if (!identityPubkey || !active || active.source !== 'session') return;
    saveTestnet4Cursors(identityPubkey, { receiveIndex, changeIndex });
  }, [identityPubkey, active, receiveIndex, changeIndex]);

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
      const list = await scanTestnet4Utxos(active, {
        receiveIndex,
        changeIndex,
        ...(fetchFn ? { fetchFn } : {}),
      });
      setUtxos(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'could not scan the wallet');
    } finally {
      setLoading(false);
    }
  }, [active, receiveIndex, changeIndex, fetchFn]);

  React.useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const balance = utxos ? balanceBreakdown(utxos, reservedKeys as Set<string>) : null;

  const copyAddress = (): void => {
    if (!receiveAddress) return;
    void navigator.clipboard?.writeText(receiveAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  const activateBrowserWallet = (account: Testnet4Account, mnemonic: string, source: RailWalletSource): void => {
    const record: RailWalletRecord = {
      version: 1,
      mnemonic,
      createdAt: Math.floor(Date.now() / 1000),
      source,
    };
    // Persist for the signed-in identity; signed out (or storage-refusing
    // browser) the wallet still works for this tab, it just cannot reload.
    const persisted = identityPubkey ? saveRailWallet(identityPubkey, 'testnet4', record) : false;
    setBrowserWallet({ pubkey: identityPubkey, account, record, persisted });
    setNewMnemonic(source === 'created' ? mnemonic : null);
    setMnemonicInput('');
    setShowImport(false);
    setImportError(null);
    setRevealWords(false);
    setConfirmForget(false);
    setReceiveIndex(0);
    setChangeIndex(0);
  };

  const doImport = (): void => {
    setImportError(null);
    try {
      const account = importTestnet4AccountFromMnemonic(mnemonicInput);
      const mnemonic = normalizeRailWalletMnemonic(mnemonicInput) ?? mnemonicInput.trim();
      activateBrowserWallet(account, mnemonic, 'imported');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'invalid mnemonic');
    }
  };

  const doGenerate = (): void => {
    setImportError(null);
    try {
      const mnemonic = generateTestnet4Mnemonic(12);
      activateBrowserWallet(importTestnet4AccountFromMnemonic(mnemonic), mnemonic, 'created');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'could not generate a mnemonic');
    }
  };

  const doForget = (): void => {
    if (!identityPubkey) return;
    clearRailWallet(identityPubkey, 'testnet4');
    setBrowserWallet(null);
    setNewMnemonic(null);
    setRevealWords(false);
    setConfirmForget(false);
    setReceiveIndex(0);
    setChangeIndex(0);
  };

  const doSend = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!active) return;
    const sats = Number(sendSats);
    setSendError(null);
    setSendTxid(null);
    setSending(true);
    try {
      const outcome = await sendTestnet4(active, {
        to: sendTo.trim(),
        sats: Number.isFinite(sats) ? Math.floor(sats) : 0,
        feeTier,
        receiveIndex,
        changeIndex,
        reserved: SESSION_TRACKER,
        ...(fetchFn ? { fetchFn } : {}),
      });
      if (!outcome.ok) {
        setSendError(outcome.message);
        return;
      }
      setSendTxid(outcome.txid);
      recordRailSend('l1', Number.isFinite(sats) ? Math.floor(sats) : 0, outcome.txid, outcome.feeSats);
      setSendTo('');
      setSendSats('');
      setReservedKeys(SESSION_TRACKER.reservedSet());
      if (outcome.changeAddress) setChangeIndex((i) => i + 1);
      void refresh();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }} data-testid="testnet4-wallet-card">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-lg font-bold">Bitcoin testnet4</h3>
        <span
          className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]"
          style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
        >
          {TESTNET4_NO_VALUE_BADGE}
        </span>
        {activeSource === 'created' && (
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent-2)' }} data-testid="testnet4-wallet-source">created · browser</span>
        )}
        {activeSource === 'imported' && (
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent-2)' }} data-testid="testnet4-wallet-source">imported · browser</span>
        )}
      </div>
      <p className={active ? 'mb-1 text-[10px]' : 'mb-3 text-[10px]'} style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        your keys, your coins · BIP-84 · on-chain escrow funding
      </p>
      {active && (
        <p className="mb-3 text-[10px]" data-testid="testnet4-active-wallet" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
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
                ? 'Deriving your testnet4 wallet…'
                : 'Sign in with a seed identity to derive your testnet4 wallet, or import a mnemonic below.'}
            </p>
          )}
        </div>
      )}

      {active && receiveAt && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
            <span>Receive</span>
            <span style={{ fontFamily: 'var(--np-font-mono)' }}>{receiveAt.path}</span>
          </div>
          {qr?.address === receiveAt.address && (
            <div className="flex justify-center">
              <img src={qr.url} alt="testnet4 receive address QR" width={190} height={190} className="bg-white p-1" data-testid="testnet4-receive-qr" />
            </div>
          )}
          <p className="break-all text-center text-[11px] select-all" style={{ fontFamily: 'var(--np-font-mono)' }}>{receiveAt.address}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyAddress} className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
              <Copy size={13} className="mr-1 inline" />{copied ? 'Copied' : 'Copy address'}
            </button>
            <a href={testnet4ExplorerAddressUrl(receiveAt.address)} target="_blank" rel="noreferrer" className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
              <ExternalLink size={13} className="mr-1 inline" />Explorer
            </a>
            <button type="button" onClick={() => setReceiveIndex((i) => i + 1)} className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
              New address
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: 'var(--np-rule)' }}>
              <RefreshCw size={13} className="mr-1 inline" />{loading ? 'Scanning…' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center" data-testid="testnet4-balance">
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Available</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{balance ? balance.confirmedAvailable.toLocaleString() : '—'}</div>
            </div>
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Unconfirmed</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{balance ? balance.unconfirmed.toLocaleString() : '—'}</div>
            </div>
            <div className="border p-2" style={{ borderColor: 'var(--np-rule)' }}>
              <div className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Reserved</div>
              <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{balance ? balance.reserved.toLocaleString() : '—'}</div>
            </div>
          </div>
          {loadError && <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{loadError}</p>}
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            Need coins? Use a public testnet4 faucet, then send to this address -{' '}
            <a className="underline" style={{ color: 'var(--np-accent-2)' }} href="https://mempool.space/testnet4/faucet" target="_blank" rel="noreferrer">
              mempool.space/testnet4/faucet
            </a>
          </p>
        </div>
      )}

      {active && (
        <form onSubmit={(e) => void doSend(e)} className="mb-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Send testnet4</div>
          <input
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            placeholder="tb1… destination (escrow or wallet)"
            data-testid="testnet4-send-to"
            className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          />
          <div className="flex gap-2">
            <input
              value={sendSats}
              onChange={(e) => setSendSats(e.target.value)}
              placeholder="sats"
              inputMode="numeric"
              data-testid="testnet4-send-amount"
              className="min-w-0 flex-1 rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <select
              value={feeTier}
              onChange={(e) => setFeeTier(e.target.value as Testnet4FeeTier)}
              className="rounded border bg-transparent px-2 py-2 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <option value="economy">economy</option>
              <option value="hour">~1h</option>
              <option value="halfHour">~30m</option>
              <option value="fastest">fastest</option>
            </select>
          </div>
          <button type="submit" disabled={sending || !sendTo.trim() || !sendSats} className="w-full rounded border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}>
            <ArrowUpRight size={14} className="mr-1 inline" />{sending ? 'Signing & broadcasting…' : 'Send'}
          </button>
          {sendTxid && (
            <a href={testnet4ExplorerTxUrl(sendTxid)} target="_blank" rel="noreferrer" className="block text-[11px] underline" style={{ color: 'var(--np-success)' }}>
              Sent · view on mempool.space
            </a>
          )}
          {sendError && <p className="text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{sendError}</p>}
        </form>
      )}

      <div className="border-t pt-3" style={{ borderColor: 'var(--np-rule)' }}>
        {stored && (
          <div className="mb-3 space-y-2 rounded border p-2" style={{ borderColor: 'var(--np-rule)' }} data-testid="testnet4-browser-wallet">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-accent)' }}>
              {stored.record.source} browser wallet
              {stored.persisted ? ' · saved for this identity' : ' · this tab only - sign in to save'}
            </p>
            <button
              type="button"
              onClick={() => setRevealWords((v) => !v)}
              data-testid="testnet4-reveal-words"
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
                <p className="break-words text-xs select-all" data-testid="testnet4-recovery-words" style={{ fontFamily: 'var(--np-font-mono)' }}>
                  {stored.record.mnemonic}
                </p>
              </div>
            )}
            {stored.persisted && !confirmForget && (
              <button
                type="button"
                onClick={() => setConfirmForget(true)}
                data-testid="testnet4-forget-wallet"
                className="text-[10px] uppercase tracking-widest underline"
                style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}
              >
                Forget this browser wallet
              </button>
            )}
            {stored.persisted && confirmForget && (
              <div className="space-y-2" data-testid="testnet4-forget-confirm">
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--np-error, #b91c1c)' }}>
                  The recovery words are the ONLY backup. If you have not written them down, this wallet and any
                  testnet coins on it are gone for good.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={doForget}
                    data-testid="testnet4-forget-confirmed"
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
              data-testid="testnet4-mnemonic-input"
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
        <ShieldCheck size={11} /> non-custodial · explorer {TESTNET4_EXPLORER_BASE.replace('https://', '')} · {utxos ? `${utxos.length} utxo(s)` : 'balance not scanned'}
      </div>
    </div>
  );
}
