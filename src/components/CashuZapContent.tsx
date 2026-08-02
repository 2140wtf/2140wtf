import { useMemo, useState, useEffect, useRef } from 'react';
import { AlertTriangle, Check, Copy, Loader2, MessageCircle } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ZapAmountInput } from '@/components/ZapAmountInput';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useNutzapInfo } from '@/hooks/useNutzapInfo';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { normalizeMintUrl } from '@/lib/cashu/cashu';

interface CashuZapContentProps {
  /** Event or profile being zapped. */
  target: Event;
  /** Current amount in satoshis (controlled by ZapDialog). */
  amountSats: number | string;
  /** User currency preference. */
  currencyDisplay: 'usd' | 'sats';
  /** BTC price for fiat display. */
  btcPrice: number | undefined;
  /** Called when the amount changes. */
  onAmountChange: (value: number | string) => void;
  /** Called when the Cashu send is successfully published. */
  onSuccess: (result: { amountSats: number; eventId?: string }) => void;
  /** Optional zapped-event context (for zapping a specific note). */
  zappedEvent?: { id: string; kind: number; relay?: string };
}

const CASHU_SATS_PRESETS = [100, 1000, 10000, 100000, 1000000];

/** A Cashu token whose wallet debit succeeded but whose DM delivery did not. */
interface PendingDmToken {
  token: string;
  mintUrl: string;
  amountSats: number;
}

/**
 * Cashu Nutzap send pane inside ZapDialog.
 *
 * Discovers the recipient's kind 10019 Nutzap info, intersects it with the
 * sender's mint balances, and sends a P2PK-locked Nutzap event (kind 9321).
 *
 * When the recipient has not published Nutzap preferences (or the sender does
 * not hold balances on any accepted mint), the pane falls back to a NUT-18
 * Cashu token sent over a NIP-17 encrypted direct message.
 */
export function CashuZapContent({
  target,
  amountSats,
  currencyDisplay,
  btcPrice,
  onAmountChange,
  onSuccess,
  zappedEvent,
}: CashuZapContentProps) {
  const wallet = useCashuWalletContext();
  const { data: nutzapInfo, isLoading: nutzapInfoLoading } = useNutzapInfo(target.pubkey);
  const { sendMessage: sendDm, isPending: isDmSending } = useNip17SendMessage();
  const { user } = useCurrentUser();
  const [memo, setMemo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [editingAmount, setEditingAmount] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Outbox for the NUT-18 DM fallback: sendToken debits the wallet and clears
  // its send-recovery journal after encoding, so the returned bearer token is
  // the ONLY copy of the sats. It is persisted here BEFORE the DM is
  // attempted, and only cleared once the DM is delivered (or the user
  // explicitly dismisses it) — a DM failure or a dialog close can never burn
  // the money.
  const dmOutboxKey = `bao_cashu_zap_dm_outbox_${user?.pubkey ?? 'anon'}_${target.pubkey}`;
  const [pendingDmToken, setPendingDmToken] = useLocalStorage<PendingDmToken | null>(dmOutboxKey, null);
  const [copiedPendingToken, setCopiedPendingToken] = useState(false);

  const numericSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  // Mints that the recipient accepts for Nutzaps and that the sender has a
  // balance on.
  const nutzapMints = useMemo(() => {
    if (!nutzapInfo) return [];
    const accepted = new Set(
      nutzapInfo.mints.map(normalizeMintUrl).filter((u): u is string => u !== null),
    );
    return wallet.allMints.filter((m) => {
      const normalized = normalizeMintUrl(m.url);
      if (!normalized) return false;
      return accepted.has(normalized) && (wallet.balances[normalized] ?? 0) > 0;
    });
  }, [nutzapInfo, wallet.allMints, wallet.balances]);

  // All mints the sender holds a balance on — used for the NIP-17 DM fallback.
  const dmMints = useMemo(() => {
    return wallet.allMints.filter((m) => {
      const normalized = normalizeMintUrl(m.url);
      return normalized !== null && (wallet.balances[normalized] ?? 0) > 0;
    });
  }, [wallet.allMints, wallet.balances]);

  const isNutzapMode = nutzapInfo !== null && nutzapMints.length > 0;
  const activeMints = isNutzapMode ? nutzapMints : dmMints;

  const [selectedMintUrl, setSelectedMintUrl] = useState('');
  useEffect(() => {
    if (selectedMintUrl) return;
    const currentNormalized = normalizeMintUrl(wallet.mintUrl);
    const currentAvailable =
      currentNormalized !== null &&
      activeMints.some((m) => normalizeMintUrl(m.url) === currentNormalized);
    if (currentAvailable) {
      setSelectedMintUrl(wallet.mintUrl);
    } else if (activeMints[0]) {
      setSelectedMintUrl(activeMints[0].url);
    }
  }, [activeMints, wallet.mintUrl, selectedMintUrl]);

  const selectedBalance = useMemo(() => {
    if (!selectedMintUrl) return 0;
    const normalized = normalizeMintUrl(selectedMintUrl);
    return normalized !== null ? (wallet.balances[normalized] ?? 0) : 0;
  }, [selectedMintUrl, wallet.balances]);

  const { format: formatMoney } = useFormatMoney();
  const primaryDisplay = formatMoney(numericSats);

  const isBusy = isSending || isDmSending || wallet.loading;
  const canSend =
    numericSats > 0 &&
    selectedMintUrl &&
    selectedBalance >= numericSats &&
    !isBusy;

  const handleSend = async () => {
    setError('');
    if (numericSats <= 0) {
      setError('Enter an amount.');
      return;
    }
    if (!selectedMintUrl) {
      setError('Select a mint.');
      return;
    }
    if (selectedBalance < numericSats) {
      setError(`Insufficient balance on ${selectedMintUrl.replace(/^https?:\/\//, '')}.`);
      return;
    }

    setIsSending(true);
    try {
      if (isNutzapMode) {
        const recipient = nip19.npubEncode(target.pubkey);
        const result = await wallet.sendNutzap(numericSats, recipient, selectedMintUrl, {
          memo,
          zappedEvent,
        });
        if (result.status === 'failed') {
          setError(wallet.error || 'Nutzap could not be sent.');
          return;
        }
        if (result.status === 'pending') {
          // Sats left the wallet; the nutzap event is queued for auto-retry.
          // There is no event id yet — report the pending state honestly.
          onSuccess({ amountSats: numericSats, eventId: undefined });
          return;
        }
        if (result.status === 'unknown') {
          // The mint may have committed — do NOT retry. sendNutzap already set
          // a wallet error explaining the check-balance-first rule.
          setError(wallet.error || 'Payment outcome unknown — check your wallet balance before trying again.');
          return;
        }
        // Sent: the result carries the published event id (sendNutzap does not
        // add sent events to wallet.nutzaps — that list is RECEIVED nutzaps).
        onSuccess({ amountSats: numericSats, eventId: result.eventId });
        return;
      }

      // NUT-18 fallback: send a Cashu token over a NIP-17 DM.
      const token = await wallet.sendToken(numericSats, memo, undefined, selectedMintUrl);
      if (!token) {
        setError(wallet.error || 'Failed to create Cashu token.');
        return;
      }
      // The wallet is already debited — persist the bearer token BEFORE the
      // DM attempt so a DM failure (DMs disabled in publish preferences,
      // relays down) can never strand the sats.
      setPendingDmToken({ token, mintUrl: selectedMintUrl, amountSats: numericSats });
      try {
        await sendDm({ recipientPubkey: target.pubkey, content: token });
        setPendingDmToken(null);
        onSuccess({ amountSats: numericSats });
      } catch (dmErr) {
        setError(
          dmErr instanceof Error
            ? `The token was created but the DM failed: ${dmErr.message}. The token is saved below — copy it or retry the DM. Do NOT send again.`
            : 'The token was created but the DM failed. The token is saved below — copy it or retry the DM. Do NOT send again.',
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send Cashu.');
    } finally {
      setIsSending(false);
    }
  };

  const handleRetryDm = async () => {
    if (!pendingDmToken) return;
    setError('');
    setIsSending(true);
    try {
      await sendDm({ recipientPubkey: target.pubkey, content: pendingDmToken.token });
      setPendingDmToken(null);
      onSuccess({ amountSats: pendingDmToken.amountSats });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send the DM.');
    } finally {
      setIsSending(false);
    }
  };

  const copyPendingToken = async () => {
    if (!pendingDmToken) return;
    try {
      await navigator.clipboard.writeText(pendingDmToken.token);
      setCopiedPendingToken(true);
      setTimeout(() => setCopiedPendingToken(false), 2000);
    } catch {
      setError('Clipboard is not available — select and copy the token manually.');
    }
  };

  if (!wallet.seedAvailable || !wallet.seedPhrase) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          Cashu wallet is not available. Make sure you are logged in with a signer that supports NIP-44.
        </p>
      </div>
    );
  }

  if (nutzapInfoLoading) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Looking up Nutzap receive info…</p>
      </div>
    );
  }

  // An undelivered DM token replaces the send form: the sats it carries are
  // already out of the wallet, so the user must recover or deliver THIS token
  // before generating another one (a new send would overwrite the outbox).
  if (pendingDmToken) {
    return (
      <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
        <div className="rounded-lg border border-amber-500/50 bg-card p-3 space-y-2 text-foreground">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle className="size-4 text-amber-500" />
            Token created, DM not delivered
          </p>
          <p className="text-xs text-muted-foreground">
            Your wallet was debited {pendingDmToken.amountSats.toLocaleString()} sats, but the
            encrypted DM to the recipient could not be sent. The token below IS the money — copy
            it and deliver it yourself, or retry the DM. It is stored in this browser until you
            dismiss it.
          </p>
          <div className="rounded-lg border bg-muted p-3 font-mono text-xs break-all">
            {pendingDmToken.token}
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyPendingToken}>
            {copiedPendingToken ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
            {copiedPendingToken ? 'Copied' : 'Copy token'}
          </Button>
          <Button type="button" size="sm" onClick={handleRetryDm} disabled={isSending || isDmSending}>
            {isSending || isDmSending ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Sending DM…
              </>
            ) : (
              'Retry DM'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPendingDmToken(null)}
            disabled={isSending || isDmSending}
          >
            I saved it — dismiss
          </Button>
        </div>
      </div>
    );
  }

  if (activeMints.length === 0) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          You do not have a Cashu balance on any mint.
        </p>
        <p className="text-xs text-muted-foreground">
          Deposit sats into your Cashu wallet before sending.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      <ZapAmountInput
        amountSats={amountSats}
        onChange={(value) => {
          onAmountChange(value);
          setError('');
        }}
        btcPrice={btcPrice}
        currencyDisplay={currencyDisplay}
        presets={CASHU_SATS_PRESETS}
        disabled={isBusy}
        inputRef={amountInputRef}
        editing={editingAmount}
        onEditingChange={setEditingAmount}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>Balance on selected mint</span>
        <span className="font-medium tabular-nums">{selectedBalance.toLocaleString()} sats</span>
      </div>

      <Select value={selectedMintUrl} onValueChange={setSelectedMintUrl} disabled={isBusy}>
        <SelectTrigger>
          <SelectValue placeholder="Select mint" />
        </SelectTrigger>
        <SelectContent>
          {activeMints.map((m) => {
            const normalized = normalizeMintUrl(m.url);
            if (!normalized) return null;
            return (
              <SelectItem key={normalized} value={m.url}>
                {m.name} ({(wallet.balances[normalized] ?? 0).toLocaleString()} sats)
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Input
        placeholder="Memo (optional)"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        disabled={isBusy}
        maxLength={200}
      />

      {(error || wallet.error) && <p className="text-xs text-destructive">{error || wallet.error}</p>}

      <Button type="button" onClick={handleSend} disabled={!canSend} className="w-full">
        {isBusy ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            {isNutzapMode ? 'Sending Nutzap…' : 'Sending Cashu token…'}
          </>
        ) : (
          <>Send {primaryDisplay || `${numericSats.toLocaleString()} sats`}</>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1">
        {isNutzapMode ? (
          <>Sends a NIP-61 Nutzap (kind 9321) locked to the recipient&apos;s Cashu pubkey.</>
        ) : (
          <>
            <MessageCircle className="size-3" />
            Sends a NUT-18 Cashu token over a NIP-17 encrypted direct message.
          </>
        )}
      </p>
    </div>
  );
}
