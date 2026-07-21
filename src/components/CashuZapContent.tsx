import { useMemo, useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
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
  /** Called when the Nutzap is successfully published. */
  onSuccess: (result: { amountSats: number; eventId: string }) => void;
  /** Optional zapped-event context (for zapping a specific note). */
  zappedEvent?: { id: string; kind: number; relay?: string };
}

const CASHU_SATS_PRESETS = [100, 500, 1000, 5000, 10000];

/**
 * Cashu Nutzap send pane inside ZapDialog.
 *
 * Discovers the recipient's kind 10019 Nutzap info, intersects it with the
 * sender's mint balances, and sends a P2PK-locked Nutzap event (kind 9321).
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
  const { data: nutzapInfo } = useNutzapInfo(target.pubkey);
  const [memo, setMemo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [editingAmount, setEditingAmount] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Compute the intersection of sender mints (with balances) and recipient
  // accepted mints. Mints are keyed by normalized URL for stable comparison.
  const availableMints = useMemo(() => {
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

  // Default to the wallet's current mint if it overlaps and has balance,
  // otherwise the first available mint.
  const [selectedMintUrl, setSelectedMintUrl] = useState('');
  useEffect(() => {
    if (selectedMintUrl) return;
    const currentNormalized = normalizeMintUrl(wallet.mintUrl);
    const currentAvailable =
      currentNormalized !== null &&
      availableMints.some((m) => normalizeMintUrl(m.url) === currentNormalized);
    if (currentAvailable) {
      setSelectedMintUrl(wallet.mintUrl);
    } else if (availableMints[0]) {
      setSelectedMintUrl(availableMints[0].url);
    }
  }, [availableMints, wallet.mintUrl, selectedMintUrl]);

  const numericSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  const selectedBalance = useMemo(() => {
    if (!selectedMintUrl) return 0;
    const normalized = normalizeMintUrl(selectedMintUrl);
    return normalized !== null ? (wallet.balances[normalized] ?? 0) : 0;
  }, [selectedMintUrl, wallet.balances]);

  const { format: formatMoney } = useFormatMoney();
  const primaryDisplay = formatMoney(numericSats);

  const canSend =
    numericSats > 0 &&
    selectedMintUrl &&
    selectedBalance >= numericSats &&
    !wallet.loading &&
    !isSending;

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
      const recipient = nip19.npubEncode(target.pubkey);
      const ok = await wallet.sendNutzap(numericSats, recipient, selectedMintUrl, {
        memo,
        zappedEvent,
      });
      if (!ok) {
        setError('Nutzap could not be sent. It may be queued for retry.');
        return;
      }
      // sendNutzap stores the published event in wallet.nutzaps[0] (newest).
      const publishedEvent = wallet.nutzaps[0];
      if (!publishedEvent) {
        setError('Sent, but the published event id was not returned.');
        return;
      }
      onSuccess({ amountSats: numericSats, eventId: publishedEvent.id });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send Nutzap.');
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

  if (!nutzapInfo) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Looking up Nutzap receive info…</p>
      </div>
    );
  }

  if (availableMints.length === 0) {
    return (
      <div className="px-4 py-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          This user accepts Nutzaps on mints you do not currently hold balances in.
        </p>
        <p className="text-xs text-muted-foreground">
          Accepted: {nutzapInfo.mints.map((m) => m.replace(/^https?:\/\//, '')).join(', ')}
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
        disabled={isSending}
        inputRef={amountInputRef}
        editing={editingAmount}
        onEditingChange={setEditingAmount}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>Balance on selected mint</span>
        <span className="font-medium tabular-nums">{selectedBalance.toLocaleString()} sats</span>
      </div>

      <Select value={selectedMintUrl} onValueChange={setSelectedMintUrl} disabled={isSending}>
        <SelectTrigger>
          <SelectValue placeholder="Select mint" />
        </SelectTrigger>
        <SelectContent>
          {availableMints.map((m) => {
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
        disabled={isSending}
        maxLength={200}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="button" onClick={handleSend} disabled={!canSend} className="w-full">
        {isSending ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            Sending Nutzap…
          </>
        ) : (
          <>Send {primaryDisplay || `${numericSats.toLocaleString()} sats`}</>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        Sends a NIP-61 Nutzap (kind 9321) locked to the recipient's Cashu pubkey.
      </p>
    </div>
  );
}
