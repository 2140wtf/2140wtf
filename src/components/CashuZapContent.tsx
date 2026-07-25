import { useMemo, useState, useEffect, useRef } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
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

const CASHU_SATS_PRESETS = [100, 500, 1000, 5000, 10000];

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
  const [memo, setMemo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [editingAmount, setEditingAmount] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

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
        if (result === 'failed') {
          setError(wallet.error || 'Nutzap could not be sent.');
          return;
        }
        if (result === 'pending') {
          // Sats left the wallet; the nutzap event is queued for auto-retry.
          // There is no event id yet — report the pending state honestly.
          onSuccess({ amountSats: numericSats, eventId: undefined });
          return;
        }
        // sendNutzap stores the published event in wallet.nutzaps[0] (newest).
        const publishedEvent = wallet.nutzaps[0];
        if (!publishedEvent) {
          setError('Sent, but the published event id was not returned.');
          return;
        }
        onSuccess({ amountSats: numericSats, eventId: publishedEvent.id });
        return;
      }

      // NUT-18 fallback: send a Cashu token over a NIP-17 DM.
      const token = await wallet.sendToken(numericSats, memo, undefined, selectedMintUrl);
      if (!token) {
        setError(wallet.error || 'Failed to create Cashu token.');
        return;
      }
      await sendDm({ recipientPubkey: target.pubkey, content: token });
      onSuccess({ amountSats: numericSats });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send Cashu.');
    } finally {
      setIsSending(false);
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
