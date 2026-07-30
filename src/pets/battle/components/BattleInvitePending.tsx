import { useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, Swords, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppContext } from '@/hooks/useAppContext';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { useBattleInvites } from '../hooks/useBattleInvites';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import { getAvatarShape } from '@/lib/avatarShape';
import { DEFAULT_PRIZE_SATS } from '../lib/constants';
import { deriveBattleEscrowKeypair } from '../lib/cashuEscrow';

export function BattleInvitePending() {
  const { pendingInvite, isLoading, accept, decline } = useBattleInvites();
  const { companions, isLoading: petsLoading } = usePetssCollection();
  const { config } = useAppContext();
  const { wallet: petsWallet, isCashu } = usePetsWallet();
  const { seedPhrase, available: seedAvailable } = useCashuSeed();
  const [petId, setPetId] = useState<string>('');

  const escrowKeypair = useMemo(() => {
    if (!seedPhrase) return null;
    try {
      return deriveBattleEscrowKeypair(seedPhrase);
    } catch {
      return null;
    }
  }, [seedPhrase]);

  const escrowConfigured = !!config.petsBattleEscrowPubkey && !!config.petsBattleEscrowServiceUrl;
  const isRealSatsInvite = pendingInvite?.mode === 'real-sats';
  // The stake is set by the CHALLENGER — never display a hardcoded default:
  // accepting auto-locks this exact amount from the wallet in escrow.
  const stakeSats = pendingInvite?.prizeAmount ?? DEFAULT_PRIZE_SATS;
  // Mint coordination: the escrow operator rejects mixed-mint releases, so
  // the guest must stake from the SAME mint the host advertised. A guest
  // whose wallet lacks that mint (or the balance at it) must REFUSE here —
  // accepting would lock the guest's stake from the wrong mint and strand
  // both players' sats with the operator.
  const agreedMint = pendingInvite?.hostDepositMint ? safeNormalizeMintUrl(pendingInvite.hostDepositMint) : '';
  const hasAgreedMint = !!agreedMint && !!petsWallet?.allMints.some((m) => safeNormalizeMintUrl(m.url) === agreedMint);
  const agreedMintBalance = hasAgreedMint ? (petsWallet!.balances[agreedMint] ?? 0) : 0;
  // Never let a player accept a stake they cannot lock: accepting debits the
  // wallet immediately, and a guest who cannot deposit leaves the host
  // waiting on escrow forever.
  const hasStakeBalance = agreedMint
    ? hasAgreedMint && agreedMintBalance >= stakeSats
    : (petsWallet?.totalBalance ?? 0) >= stakeSats;
  const canAcceptRealSats = isRealSatsInvite && isCashu && seedAvailable && escrowConfigured && !!escrowKeypair && hasStakeBalance;
  const isNonDefaultStake = isRealSatsInvite && stakeSats !== DEFAULT_PRIZE_SATS;
  const [stakeAcknowledged, setStakeAcknowledged] = useState(false);

  const eligiblePets = companions.filter(
    (pet) => pet.stage === 'baby' || pet.stage === 'adult',
  );
  const selectedPet = eligiblePets.find((pet) => pet.d === petId);

  const author = useAuthor(pendingInvite?.inviterPubkey ?? '');
  const metadata = author.data?.metadata;
  const name = pendingInvite ? metadata?.name ?? genUserName(pendingInvite.inviterPubkey) : '';
  const avatarShape = getAvatarShape(metadata);

  if (!pendingInvite) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Swords className="size-5 text-primary" />
            Battle Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className={avatarShape}>
              <AvatarImage src={metadata?.picture} alt={name} />
              <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">
                {nip19.npubEncode(pendingInvite.inviterPubkey).slice(0, 24)}…
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <p>
              <span className="font-medium">Prize:</span> {stakeSats.toLocaleString()} {' '}
              {isRealSatsInvite ? 'real sats' : 'demo sats'}
            </p>
            <p>
              <span className="font-medium">Their fighter:</span>{' '}
              {pendingInvite.inviterPet.name} ({pendingInvite.inviterPet.stage})
            </p>
            {isRealSatsInvite && (
              <p className="text-muted-foreground">
                Accepting locks {stakeSats.toLocaleString()} real sats from your wallet in escrow. The winner claims both stakes.
              </p>
            )}
            {isRealSatsInvite && agreedMint && (
              <p className="text-muted-foreground">
                Stakes lock from mint: {agreedMint.replace(/^https?:\/\//, '')}
              </p>
            )}
            {isNonDefaultStake && (
              <p className="text-amber-600 dark:text-amber-400">
                This challenger set a non-standard stake of {stakeSats.toLocaleString()} sats (the default is {DEFAULT_PRIZE_SATS.toLocaleString()}). Only accept if you agreed to this amount.
              </p>
            )}
            {isRealSatsInvite && agreedMint && !hasAgreedMint && isCashu && (
              <p className="text-destructive">
                The challenger stakes from mint {agreedMint.replace(/^https?:\/\//, '')}, which your wallet doesn't use — the escrow operator can only pay out matching-mint stakes. Add this mint in the Wallet tab first.
              </p>
            )}
            {isRealSatsInvite && agreedMint && hasAgreedMint && agreedMintBalance < stakeSats && isCashu && (
              <p className="text-destructive">
                Insufficient balance at the battle mint — accepting locks {stakeSats.toLocaleString()} sats from {agreedMint.replace(/^https?:\/\//, '')} but you have {agreedMintBalance.toLocaleString()} there. Top up that mint first.
              </p>
            )}
            {isRealSatsInvite && !agreedMint && !canAcceptRealSats && !hasStakeBalance && isCashu && (
              <p className="text-destructive">
                Insufficient balance — accepting locks {stakeSats.toLocaleString()} sats but your wallet has {(petsWallet?.totalBalance ?? 0).toLocaleString()}. Top up your Cashu wallet first.
              </p>
            )}
            {isRealSatsInvite && !canAcceptRealSats && (hasStakeBalance || !isCashu) && (
              <p className="text-destructive">
                Switch to real Cashu and configure battle escrow to accept real-sats battles.
              </p>
            )}
          </div>

          {isNonDefaultStake && canAcceptRealSats && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={stakeAcknowledged}
                onChange={(e) => setStakeAcknowledged(e.target.checked)}
              />
              <span>
                I understand {stakeSats.toLocaleString()} real sats will be locked from my wallet when I accept.
              </span>
            </label>
          )}

          {petsLoading ? (
            <p className="text-sm text-muted-foreground">Loading your pets…</p>
          ) : eligiblePets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You need a hatched pet to accept a battle.
            </p>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Choose your fighter
              </label>
              <Select value={petId} onValueChange={setPetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose your pet" />
                </SelectTrigger>
                <SelectContent>
                  {eligiblePets.map((pet) => (
                    <SelectItem key={pet.d} value={pet.d}>
                      {pet.name} ({pet.stage})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => decline()}
              disabled={isLoading}
            >
              <X className="mr-2 size-4" />
              Decline
            </Button>
            <Button
              className="flex-1"
              disabled={!selectedPet || isLoading || (isRealSatsInvite && !canAcceptRealSats) || (isNonDefaultStake && !stakeAcknowledged)}
              onClick={() => selectedPet && accept(selectedPet, escrowKeypair?.pubkey)}
            >
              <Check className="mr-2 size-4" />
              Accept
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
