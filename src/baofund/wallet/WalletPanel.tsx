import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, RefreshCw, ShieldCheck, Trash2, Waypoints, Zap } from 'lucide-react';
import { useWallet } from './useWallet';
import { useNip60Wallet } from './useNip60Wallet';
import { useAuth } from '../auth/useAuth';
import { completeLightningTopUp, loadPendingTopUp } from './cashuWallet';
import { LightningInvoice } from './LightningInvoice';
import { MintDiscovery } from './MintDiscovery';
import { WalletHistory } from './WalletHistory';
import { WalletBackupPanel } from './WalletBackupPanel';
import { QrScanDialog } from './QrScanDialog';
import { SatsPresetPills } from './SatsPresetPills';
import { CashuTokenQr } from './CashuTokenQr';
import { Testnet4WalletCard } from './rails/Testnet4WalletCard';
import type { LightningPayQuote, LightningTopUpQuote } from './types';

// liquidjs-lib + the zkp wasm are heavy: the Liquid card is code-split and
// only fetched when the wallet grid renders.
const LiquidTestnetWalletCard = React.lazy(() =>
  import('./rails/LiquidTestnetWalletCard').then((m) => ({ default: m.LiquidTestnetWalletCard })),
);

/** Parse a user-typed sats amount; undefined when not a positive integer. */
function parseSats(raw: string): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function RailBadge({ kind, children }: { kind: 'testnet' | 'real'; children: React.ReactNode }) {
  const color = kind === 'testnet' ? 'var(--np-accent)' : 'var(--np-success)';
  return (
    <span
      className="ml-2 inline-block border px-1.5 py-0.5 align-middle text-[9px] uppercase tracking-[0.18em]"
      style={{ borderColor: color, color, fontFamily: 'var(--np-font-mono)' }}
    >
      {children}
    </span>
  );
}

export function WalletPanel(): React.ReactElement {
  const local = useWallet();
  const portable = useNip60Wallet();
  const auth = useAuth();
  const { status: authStatus, nip60Signer, pubkey: authPubkey, seedIdentityHex } = auth;
  const [nutzapCount, setNutzapCount] = React.useState<number | null>(null);
  const [receiveInput, setReceiveInput] = React.useState('');
  const [receiveNote, setReceiveNote] = React.useState('');
  const [localSendAmount, setLocalSendAmount] = React.useState('');
  const [sendResult, setSendResult] = React.useState('');
  const [sendCopied, setSendCopied] = React.useState(false);
  // QR scanner (WS6): which surface the next scan fills, plus the scanned
  // invoice routed into PayInvoicePanel (receive fills its textarea directly).
  const [scanTarget, setScanTarget] = React.useState<null | 'receive' | 'invoice'>(null);
  const [scannedInvoice, setScannedInvoice] = React.useState<string | null>(null);

  // Bind the portable NIP-60 wallet to the AUTHENTICATED identity so the
  // wallet relays/config are keyed by the user, not a duplicate key.
  // (Destructured methods are stable per the hook's contract; the `auth`
  // and `portable` objects change identity per render - trace the fields.)
  const { attachIdentity } = portable;
  React.useEffect(() => {
    if (authStatus === 'ready' && nip60Signer && authPubkey) {
      // Deferred to a microtask: attachIdentity synchronously updates the
      // wallet hook's own state - this is external-system sync, and the
      // deferral keeps the effect body free of reachable sync setState.
      void Promise.resolve().then(() => attachIdentity(nip60Signer, authPubkey, seedIdentityHex?.()));
    }
  }, [authStatus, authPubkey, nip60Signer, seedIdentityHex, attachIdentity]);

  // Sign-out → reset the wallet to 'off' so a different account never sees it.
  const { logout: portableLogout, status: portableStatus } = portable;
  React.useEffect(() => {
    if (authStatus === 'signed-out' && portableStatus !== 'off') portableLogout();
  }, [authStatus, portableStatus, portableLogout]);

  const handleSend = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const amount = parseSats(localSendAmount);
    if (!amount) return;
    try {
      const token = await local.sendSats(amount);
      setSendResult(token);
      setLocalSendAmount('');
    } catch {
      /* error surfaced via local.error */
    }
  };

  const copySendResult = (): void => {
    void navigator.clipboard?.writeText(sendResult).then(() => {
      setSendCopied(true);
      setTimeout(() => setSendCopied(false), 1500);
    }).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        Cashu holds ecash tokens in this browser across one or more mints; the{' '}
        <b>Bitcoin testnet4</b> and <b>Liquid testnet</b> wallets hold no-value testnet coins in this browser and fund the
        on-chain tapscript escrow you can verify on mempool.space / blockstream.info.
      </p>

      <PortableWalletCard portable={portable} nutzapCount={nutzapCount} setNutzapCount={setNutzapCount} auth={auth} />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Total (all mints)</div>
          <div className="text-2xl font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{local.totalBalanceSats.toLocaleString()} sats</div>
        </div>
        <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Active mint</div>
          <div className="text-xl font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>{local.balanceSats.toLocaleString()} sats</div>
        </div>
        <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>₿AO Testnet<RailBadge kind="testnet">non-custodial</RailBadge></div>
          <div className="text-sm font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>on-chain escrow</div>
          <div className="text-[10px]" style={{ color: 'var(--np-muted)' }}>your wallet, your keys</div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Local Cashu - multi-mint */}
        <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }}>
          <h3 className="mb-1 font-serif text-lg font-bold">Cashu Wallet</h3>
          <p className="mb-3 break-all text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
            {local.mints.length} mint{local.mints.length === 1 ? '' : 's'} · keys stay in this browser
          </p>

          <MintPicker local={local} />

          <MintDiscovery
            addedUrls={new Set(local.mints.map((m) => m.mintUrl))}
            onAdd={local.addMint}
            busy={local.isLoading}
          />

          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!receiveInput.trim()) return;
            try {
              await local.receiveToken(receiveInput.trim());
              setReceiveInput('');
              setReceiveNote('Token received.');
            } catch {
              setReceiveNote('');
            }
          }} className="mb-4">
            <label className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Receive token (any mint)</label>
            <textarea value={receiveInput} onChange={(e) => setReceiveInput(e.target.value)} rows={2} placeholder="cashuA… / cashuB…" className="mb-2 w-full rounded border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }} />
            <div className="flex gap-2">
              <button type="submit" disabled={local.isLoading} className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--np-rule)' }}><ArrowDownLeft size={14} className="mr-1 inline" />Receive</button>
              <button
                type="button"
                onClick={() => setScanTarget('receive')}
                data-testid="wallet-scan-receive"
                className="rounded border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--np-rule)' }}
                title="Scan a Cashu token QR (including animated NUT-16 codes)"
              >
                Scan
              </button>
            </div>
            {receiveNote && <div className="mt-2 text-[11px]" style={{ color: 'var(--np-success)' }}>{receiveNote}</div>}
          </form>

          <TopUpPanel local={local} />

          <PayInvoicePanel
            local={local}
            onScan={() => setScanTarget('invoice')}
            scannedValue={scannedInvoice}
            onScannedConsumed={() => setScannedInvoice(null)}
          />

          <form onSubmit={handleSend}>
            <label className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Send sats (from active mint)</label>
            <div className="mb-2">
              <SatsPresetPills value={localSendAmount} onSelect={(sats) => setLocalSendAmount(String(sats))} disabled={local.isLoading} />
            </div>
            <input type="number" min={1} step={1} value={localSendAmount} onChange={(e) => setLocalSendAmount(e.target.value)} placeholder="Amount" className="mb-2 w-full rounded border bg-transparent px-3 py-2 text-sm" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }} />
            <button type="submit" disabled={local.isLoading} className="w-full rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--np-rule)' }}><ArrowUpRight size={14} className="mr-1 inline" />Send token</button>
          </form>
          {sendResult && (
            <div className="mt-3 space-y-2">
              <CashuTokenQr token={sendResult} size={176} caption="Scan with a Cashu wallet" />
              <div className="flex justify-center">
                <button type="button" onClick={copySendResult} className="rounded border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}>
                  {sendCopied ? 'Copied ✓' : 'Copy token'}
                </button>
              </div>
              <div className="break-all rounded bg-black/5 p-2 text-[10px] font-mono">{sendResult}</div>
            </div>
          )}
          {local.error && <div className="mt-2 text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }}>{local.error}</div>}

          <WalletHistory transactions={local.transactions} onClear={local.clearHistory} />
        </div>

        {/* Testnet rails - NON-CUSTODIAL (PUBLIC_TESTNET_PLAN.md §Testnet API:
            no custodial wallet routes on testnet). Keys stay in this browser;
            the platform never holds them. */}
        <Testnet4WalletCard
          identityHex={authStatus === 'ready' ? seedIdentityHex?.() ?? null : null}
          identityPubkey={authStatus === 'ready' ? authPubkey ?? null : null}
        />

        <React.Suspense
          fallback={(
            <div className="border p-4 text-[11px]" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
              Loading the Liquid testnet wallet…
            </div>
          )}
        >
          <LiquidTestnetWalletCard
            identityHex={authStatus === 'ready' ? seedIdentityHex?.() ?? null : null}
            identityPubkey={authStatus === 'ready' ? authPubkey ?? null : null}
          />
        </React.Suspense>
      </div>

      <WalletBackupPanel />

      <QrScanDialog
        open={scanTarget !== null}
        title={scanTarget === 'invoice' ? 'Scan a Lightning invoice' : 'Scan a Cashu token'}
        onResult={(value) => {
          if (scanTarget === 'invoice') setScannedInvoice(value);
          else setReceiveInput(value);
          setScanTarget(null);
        }}
        onClose={() => setScanTarget(null)}
      />
    </div>
  );
}

/** Mint selector + add/remove, with per-mint balances. */
function MintPicker({ local }: { local: ReturnType<typeof useWallet> }): React.ReactElement {
  const [newMint, setNewMint] = React.useState('');
  const [note, setNote] = React.useState<string | null>(null);

  const addMint = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const url = newMint.trim();
    if (!url) return;
    setNote(null);
    try {
      await local.addMint(url);
      setNewMint('');
      setNote(`Active mint: ${url}`);
    } catch {
      /* error surfaced via local.error */
    }
  };

  const removeActive = async (): Promise<void> => {
    setNote(null);
    try {
      await local.removeMint(local.mintUrl);
    } catch {
      /* error surfaced via local.error */
    }
  };

  return (
    <div className="mb-4 space-y-2">
      <label className="block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Mint</label>
      <div className="flex items-center gap-2">
        <select
          value={local.mintUrl}
          onChange={(e) => void local.setMintUrl(e.target.value)}
          data-testid="wallet-mint-select"
          className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        >
          {local.mints.map((m) => (
            <option key={m.mintUrl} value={m.mintUrl}>
              {m.mintUrl} · {m.balanceSats.toLocaleString()} sats
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void removeActive()}
          disabled={local.proofs.length > 0 || local.isLoading}
          title={local.proofs.length > 0 ? 'Move or redeem this mint\'s proofs first' : 'Remove this mint'}
          className="rounded border p-1.5 disabled:opacity-40"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}
          aria-label="Remove active mint"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <form onSubmit={(e) => void addMint(e)} className="flex items-center gap-2">
        <input
          type="url"
          value={newMint}
          onChange={(e) => setNewMint(e.target.value)}
          placeholder="https://mint.example.com"
          className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1.5 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
        />
        <button type="submit" disabled={local.isLoading} className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--np-rule)' }}>
          <Plus size={13} className="mr-1 inline" />Add
        </button>
      </form>
      {note && <div className="text-[10px]" style={{ color: 'var(--np-muted)' }}>{note}</div>}
    </div>
  );
}

/** NUT-04: create a bolt11 invoice and show it as a scannable QR. */
function TopUpPanel({ local }: { local: ReturnType<typeof useWallet> }): React.ReactElement {
  const [amount, setAmount] = React.useState('100');
  const [topUp, setTopUp] = React.useState<LightningTopUpQuote | null>(null);
  const [msg, setMsg] = React.useState('');

  // Resume an open quote after a reload/tab switch (NUT-04 has no auto-refund).
  React.useEffect(() => {
    const pending = loadPendingTopUp();
    if (!pending) return;
    void Promise.resolve().then(() => {
      setTopUp(pending);
      setMsg(`Invoice for ${pending.amountSats.toLocaleString()} sats at ${pending.mintUrl} is still open - pay it and the sats mint automatically.`);
    });
  }, []);

  React.useEffect(() => {
    if (!topUp) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        // Call the module directly: the poll must not toggle the hook's
        // shared isLoading (every 4s the whole wallet UI would lock while a
        // slow mint quote check is in flight). The store-change listener
        // refreshes the balance once the mint commits.
        const res = await completeLightningTopUp(topUp.quoteId, topUp.mintUrl);
        if (cancelled) return;
        if (res.state === 'paid') {
          setMsg(`Paid - minted ${res.minted.toLocaleString()} sats (mint balance ${res.balanceAfter.toLocaleString()}).`);
          setTopUp(null);
        }
      } catch (e) {
        if (!cancelled) setMsg(`Waiting for the mint… (${e instanceof Error ? e.message : 'retrying'})`);
      }
    };
    const iv = setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [topUp]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    // One open quote at a time: replacing it orphans a paid invoice (NUT-04
    // has no auto-refund and the quote id is the only recovery handle).
    if (topUp) return;
    const sats = parseSats(amount);
    if (!sats) return;
    setMsg('');
    try {
      const quote = await local.createTopUp(sats);
      setTopUp(quote);
      setMsg(`Invoice for ${quote.amountSats.toLocaleString()} sats at ${quote.mintUrl} - pay from any Lightning wallet.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not create the invoice');
    }
  };

  return (
    <div className="mb-5 border-t pt-4" style={{ borderColor: 'var(--np-rule)' }}>
      <h4 className="mb-2 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
        <Zap size={11} className="mr-1 inline" />Top up with Lightning
      </h4>
      <form onSubmit={(e) => void create(e)} className="mb-3">
        <div className="mb-2">
          <SatsPresetPills value={amount} onSelect={(sats) => setAmount(String(sats))} disabled={local.isLoading} />
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="sats"
            className="w-28 rounded border bg-transparent px-2 py-1 text-sm"
            style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
          />
          <button type="submit" disabled={local.isLoading || Boolean(topUp)} className="flex-1 rounded border px-3 py-1.5 text-sm disabled:opacity-50" style={{ borderColor: 'var(--np-rule)' }}>
            Create invoice
          </button>
        </div>
      </form>
      {topUp && (
        <div className="mb-3">
          <LightningInvoice
            invoice={topUp.invoice}
            amountSats={topUp.amountSats}
            caption={`Pay ${topUp.amountSats.toLocaleString()} sats with any Lightning wallet`}
            status={msg}
            size={176}
          />
        </div>
      )}
      {!topUp && msg && <div className="mb-3 text-[11px]" style={{ color: 'var(--np-muted)' }}>{msg}</div>}
    </div>
  );
}

/** NUT-05: paste a bolt11 invoice and pay it from this wallet. */
function PayInvoicePanel({
  local,
  onScan,
  scannedValue,
  onScannedConsumed,
}: {
  local: ReturnType<typeof useWallet>;
  onScan?: () => void;
  scannedValue?: string | null;
  onScannedConsumed?: () => void;
}): React.ReactElement {
  const [input, setInput] = React.useState('');
  const [quote, setQuote] = React.useState<LightningPayQuote | null>(null);
  const [msg, setMsg] = React.useState('');

  // A scanned invoice fills the field and clears any previous quote. The
  // state update is deferred (react-hooks/set-state-in-effect).
  React.useEffect(() => {
    if (!scannedValue) return;
    void Promise.resolve().then(() => {
      setInput(scannedValue);
      setQuote(null);
      setMsg('Scanned invoice - get a payment quote when ready.');
      onScannedConsumed?.();
    });
  }, [scannedValue, onScannedConsumed]);

  const getQuote = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setMsg('');
    setQuote(null);
    try {
      setQuote(await local.quotePayment(input));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not quote that invoice');
    }
  };

  const pay = async (): Promise<void> => {
    if (!quote) return;
    try {
      const res = await local.payQuotedInvoice(quote.quote, quote.mintUrl);
      setMsg(res.paid
        ? `Paid ${quote.amountSats.toLocaleString()} sats (fee reserve ${quote.feeReserveSats}, change ${res.changeSats}) - balance ${res.balanceAfter.toLocaleString()}.`
        : `Payment state: ${res.state} - check the invoice with the recipient.`);
      setQuote(null);
      setInput('');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Payment failed');
    }
  };

  return (
    <div className="mb-5 border-t pt-4" style={{ borderColor: 'var(--np-rule)' }}>
      <h4 className="mb-2 text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Pay a Lightning invoice</h4>
      <form onSubmit={(e) => void getQuote(e)}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // The quote is bound to the invoice it was created from; editing
            // the text must not leave a stale "Pay" button that melts the OLD
            // invoice.
            setQuote(null);
          }}
          rows={2}
          placeholder="lnbc… (paste any Lightning invoice)"
          className="mb-2 w-full rounded border bg-transparent px-3 py-2 text-sm"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
        />
        <div className="flex gap-2">
          <button type="submit" disabled={local.isLoading} className="flex-1 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--np-rule)' }}>
            Get payment quote
          </button>
          {onScan && (
            <button
              type="button"
              onClick={onScan}
              data-testid="wallet-scan-invoice"
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)' }}
              title="Scan a Lightning invoice QR"
            >
              Scan
            </button>
          )}
        </div>
      </form>
      {quote && (
        <div className="mt-2 rounded border p-2 text-[11px]" style={{ borderColor: 'var(--np-rule)' }}>
          <div>
            Amount: {quote.amountSats.toLocaleString()} sats · max fee: {quote.feeReserveSats} sats · mint {quote.mintUrl}
          </div>
          {typeof quote.quote.request === 'string' && quote.quote.request && (
            <div className="mt-0.5 break-all font-mono text-[9px]" style={{ color: 'var(--np-muted)' }}>
              invoice {quote.quote.request.slice(0, 24)}…
            </div>
          )}
          <button
            type="button"
            onClick={() => void pay()}
            disabled={local.isLoading}
            className="mt-2 w-full rounded border px-3 py-1.5 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--np-accent-2)', color: 'var(--np-accent-2)' }}
          >
            Pay {quote.amountSats.toLocaleString()} sats
          </button>
        </div>
      )}
      {msg && <div className="mt-2 text-[11px]" style={{ color: 'var(--np-muted)' }}>{msg}</div>}
    </div>
  );
}

function PortableWalletCard({
  portable,
  nutzapCount,
  setNutzapCount,
  auth,
}: {
  portable: ReturnType<typeof useNip60Wallet>;
  nutzapCount: number | null;
  setNutzapCount: (v: number | null) => void;
  auth: ReturnType<typeof useAuth>;
}) {
  const { status, identityPubkey, relays, mints, activeMint, walletPubkey, adopted, error, lastSyncAt } = portable;

  const [claimState, setClaimState] = React.useState<{ busy: boolean; note: string }>({
    busy: false,
    note: '',
  });

  const handleScan = async () => {
    const found = await portable.scanNutzaps();
    if (found === null) {
      setNutzapCount(null);
      setClaimState({ busy: false, note: 'could not reach the relay - try again' });
      return;
    }
    setNutzapCount(found.length);
    setClaimState({ busy: false, note: found.length > 0 ? `${found.length} incoming nutzap${found.length === 1 ? '' : 's'} found` : 'no incoming nutzaps' });
  };

  /** Full NIP-61 claim loop: swap at mint → merge → mark claimed. */
  const handleClaim = async () => {
    setClaimState({ busy: true, note: 'claiming…' });
    try {
      const res = await portable.claimNutzaps();
      const remaining = await portable.scanNutzaps();
      setNutzapCount(remaining?.length ?? null);
      setClaimState({
        busy: false,
        note: res.claimed > 0
          ? `claimed ${res.claimed} · +${res.sats} sats${res.failures.length > 0 ? ` · ${res.failures.length} failed` : ''}`
          : res.skippedOtherMint > 0
            ? `${res.skippedOtherMint} on a mint that is not added yet - add that mint above, then claim`
            : 'nothing new to claim',
      });
    } catch (e) {
      setClaimState({ busy: false, note: `claim failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <section
      className="border p-4"
      style={{ borderColor: 'var(--np-rule)', background: 'var(--np-paper)' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold">Portable Cashu Wallet (NIP-60)</h3>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-success)' }}>
          relays travel with you
        </span>
      </div>

      {status === 'off' && (
        <div>
          <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            The wallet syncs under your signed-in account (Sign in via the top bar). Keys and
            balance live as encrypted <b>NIP-60 events on your own relays</b> (kind:10002) -
            the same wallet works across 2140, bao.markets, and any device.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
            {auth.status === 'ready' && !auth.nip60Signer
              ? 'Your sign-in method cannot encrypt wallet events (NIP-44 unsupported) - use a seed or passkey for the portable wallet.'
              : 'Waiting for your account…'}
          </p>
        </div>
      )}

      {status === 'loading' && (
        <p className="text-xs" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
          Resolving your relays (kind 10002) and syncing NIP-60 events as{' '}
          <span style={{ color: 'var(--np-ink)' }}>{auth.pubkey?.slice(0, 12) ?? '…'}…</span>
        </p>
      )}

      {status === 'error' && (
        <p className="text-xs" style={{ color: 'var(--np-danger)' }}>Error: {error}</p>
      )}

      {status === 'ready' && identityPubkey && (
        <div>
          <div className="mb-2 grid gap-1 text-[11px]" style={{ fontFamily: 'var(--np-font-mono)' }}>
            <div className="flex items-center gap-1" style={{ color: 'var(--np-muted)' }}>
              <ShieldCheck size={12} /> identity{' '}
              <span style={{ color: 'var(--np-ink)' }}>{identityPubkey.slice(0, 12)}…</span>
            </div>
            <div className="flex items-center gap-1" style={{ color: 'var(--np-muted)' }}>
              <Waypoints size={12} /> relays ({relays.length}):{' '}
              <span style={{ color: 'var(--np-ink)' }}>
                {relays.slice(0, 3).join(' · ')}{relays.length > 3 ? ' · …' : ''}
              </span>
            </div>
            {walletPubkey && (
              <div className="flex items-center gap-1" style={{ color: 'var(--np-muted)' }}>
                <ShieldCheck size={12} /> wallet key{' '}
                <span style={{ color: 'var(--np-ink)' }}>{walletPubkey.slice(0, 12)}…</span>
                {adopted ? (
                  <span className="uppercase tracking-wider" style={{ color: 'var(--np-accent-2)' }}>adopted</span>
                ) : null}
              </div>
            )}
            {lastSyncAt && (
              <div className="flex items-center gap-1" style={{ color: 'var(--np-muted)' }}>
                <RefreshCw size={12} /> last sync {new Date(lastSyncAt).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ fontFamily: 'var(--np-font-mono)' }}>
            <label className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>
              Mint
            </label>
            <select
              value={activeMint ?? ''}
              onChange={(e) => void portable.setActiveMint(e.target.value)}
              data-testid="portable-mint-select"
              className="rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', maxWidth: '16rem' }}
            >
              {mints.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void portable.refresh()}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest"
              style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
            >
              Sync now
            </button>
            <button
              type="button"
              onClick={() => void handleScan()}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest"
              style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)' }}
            >
              Scan nutzaps{nutzapCount !== null ? ` · ${nutzapCount}` : ''}
            </button>
            <button
              type="button"
              disabled={claimState.busy || nutzapCount === 0}
              onClick={() => void handleClaim()}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-widest"
              style={{
                borderColor: 'var(--np-rule)',
                fontFamily: 'var(--np-font-mono)',
                opacity: claimState.busy || nutzapCount === 0 ? 0.5 : 1,
                color: nutzapCount ? 'var(--np-success)' : undefined,
              }}
            >
              {claimState.busy ? 'Claiming…' : `Claim${nutzapCount ? ` (${nutzapCount})` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => portable.logout()}
              className="ml-auto rounded border px-2 py-1 text-[10px] uppercase tracking-widest"
              style={{ borderColor: 'var(--np-rule)', fontFamily: 'var(--np-font-mono)', color: 'var(--np-muted)' }}
            >
              Sign out
            </button>
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }}>
            The balance above reflects the wallet synced from your relays. Sends and receives
            publish NIP-60 token events to {relays.length} relay{relays.length === 1 ? '' : 's'}.
            {claimState.note && <span style={{ color: 'var(--np-accent)' }}> {claimState.note}</span>}
          </p>
        </div>
      )}
    </section>
  );
}
