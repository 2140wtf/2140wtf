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
import { getAvatarShape } from '@/lib/avatarShape';
import { DEFAULT_PRIZE_SATS } from '../lib/constants';
import { deriveBattleEscrowKeypair } from '../lib/cashuEscrow';

export function BattleInvitePending() {
  const { pendingInvite, isLoading, accept, decline } = useBattleInvites();
  const { companions, isLoading: petsLoading } = usePetssCollection();
  const { config } = useAppContext();
  const { isCashu } = usePetsWallet();
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
  const canAcceptRealSats = isRealSatsInvite && isCashu && seedAvailable && escrowConfigured && !!escrowKeypair;

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
              <span className="font-medium">Prize:</span> {DEFAULT_PRIZE_SATS.toLocaleString()} {' '}
              {isRealSatsInvite ? 'real sats' : 'demo sats'}
            </p>
            <p>
              <span className="font-medium">Their fighter:</span>{' '}
              {pendingInvite.inviterPet.name} ({pendingInvite.inviterPet.stage})
            </p>
            {isRealSatsInvite && !canAcceptRealSats && (
              <p className="text-destructive">
                Switch to real Cashu and configure battle escrow to accept real-sats battles.
              </p>
            )}
          </div>

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
              disabled={!selectedPet || isLoading || (isRealSatsInvite && !canAcceptRealSats)}
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
