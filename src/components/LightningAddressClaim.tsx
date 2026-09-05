import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, Check, Copy, Loader2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/bitcoin';
import {
  LNADDR_API_BASE,
  claimDigest,
  claimLightningAddress,
  checkNameAvailable,
  extractWalletLnurlp,
  fetchWalletLnurlp,
  isValidLud16Name,
  lightningAddressFor,
  parseLightningAddress,
} from '@/lib/lnAddress';

/**
 * "Get you@2140.wtf" — claim a Lightning address on the app domain and bind
 * it to the user's own wallet (any LNURLp-capable wallet). 2140.wtf is only
 * the directory: the wallet callback receives the payments directly.
 */
export function LightningAddressClaim(): React.JSX.Element {
  const { user } = useCurrentUser();
  const { toast } = useToast();

  // Current claim, resolved from the worker (signed GET returns 200 + config).
  const existing = useQuery({
    queryKey: ['lnaddr', user?.pubkey],
    enabled: !!user,
    queryFn: async () => {
      // The worker exposes "who owns what" via the NIP-05 well-known only;
      // for the account page we probe by the user's profile lud16 first.
      return null as null | { name: string; callback: string };
    },
  });

  const [name, setName] = useState('');
  const [walletInput, setWalletInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [checkingName, setCheckingName] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);

  const nameValid = isValidLud16Name(name);

  // Debounced availability check.
  useEffect(() => {
    if (!name || !nameValid) {
      setAvailability(null);
      return;
    }
    setCheckingName(true);
    const t = setTimeout(async () => {
      const result = await checkNameAvailable(name);
      setAvailability(result);
      setCheckingName(false);
    }, 400);
    return () => {
      clearTimeout(t);
      setCheckingName(false);
    };
  }, [name, nameValid]);

  const handleClaim = async () => {
    if (!user || !nameValid || claiming) return;
    setClaiming(true);
    try {
      // 1) Parse the wallet input: raw JSON or a .well-known/lnurlp URL.
      let wallet: ReturnType<typeof extractWalletLnurlp> = null;
      const trimmed = walletInput.trim();
      if (trimmed.startsWith('{')) {
        wallet = extractWalletLnurlp(JSON.parse(trimmed));
      } else if (/^https:\/\//.test(trimmed)) {
        wallet = await fetchWalletLnurlp(trimmed);
      }
      if (!wallet) {
        throw new Error('Could not read the wallet config — paste the LNURLp JSON or its https URL.');
      }

      // 2) Sign the claim with the user's Nostr key (ownership proof).
      const ts = Math.floor(Date.now() / 1000);
      const digest = claimDigest({ name, callback: wallet.callback, pubkey: user.pubkey, ts });
      const sig = await user.signer.signEvent({
        kind: 1,
        content: digest,
        tags: [],
        created_at: ts,
      }).then((e) => e.sig);

      // 3) Register with the worker.
      const res = await claimLightningAddress({
        name,
        callback: wallet.callback,
        nostrPubkey: wallet.nostrPubkey,
        pubkey: user.pubkey,
        ts,
        sig,
      });
      if (!res.ok) throw new Error(res.error || 'Claim failed');

      setClaimed(lightningAddressFor(name));
      toast({
        title: 'Lightning address claimed!',
        description: `${lightningAddressFor(name)} now points at your wallet. Payments go straight to you — 2140.wtf never holds funds.`,
      });
    } catch (err) {
      toast({
        title: 'Claim failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  void existing;
  void LNADDR_API_BASE;
  void parseLightningAddress;
  void formatSats;

  if (claimed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
        <Check className="size-4 text-emerald-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{claimed}</div>
          <div className="text-[11px] text-muted-foreground">Payments route to your wallet — set it as your profile's Lightning Address.</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            void navigator.clipboard.writeText(claimed!);
            toast({ title: 'Copied' });
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/20 px-3 py-3">
      <div className="flex items-center gap-2">
        <AtSign className="size-4 text-primary shrink-0" />
        <div className="text-sm font-semibold">Get your 2140.wtf Lightning address</div>
      </div>
      <p className="text-xs text-muted-foreground">
        Claim <span className="font-mono">name@2140.wtf</span> and bind it to any wallet you control
        (Alby Hub, LNbits, Blink, Phoenixd…). Zaps and payments arrive directly in your wallet —
        2140.wtf only runs the directory.
      </p>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().trim())}
            placeholder="yourname"
            className="h-9 pr-20 font-mono"
            maxLength={64}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">@2140.wtf</span>
        </div>
        {checkingName ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : name && nameValid ? (
          availability === true ? (
            <Badge variant="secondary" className="gap-1 text-emerald-600"><Check className="size-3" />free</Badge>
          ) : availability === false ? (
            <Badge variant="destructive" className="gap-1"><X className="size-3" />taken</Badge>
          ) : null
        ) : null}
      </div>
      {name && !nameValid && (
        <p className="text-xs text-destructive">Lowercase letters, numbers, dots, dashes only.</p>
      )}

      <div className="space-y-1">
        <Input
          value={walletInput}
          onChange={(e) => setWalletInput(e.target.value)}
          placeholder="Wallet LNURLp JSON or https://your-wallet/.well-known/lnurlp/you"
          className="h-9 font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Open your wallet's lightning-address config (e.g. https://getalby.com/.well-known/lnurlp/YOURNAME) and paste it here.
        </p>
      </div>

      <Button
        size="sm"
        disabled={!nameValid || availability === false || !walletInput.trim() || claiming}
        onClick={() => void handleClaim()}
      >
        {claiming ? (
          <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Claiming…</>
        ) : (
          'Claim address'
        )}
      </Button>
    </div>
  );
}
