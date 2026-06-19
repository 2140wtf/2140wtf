import { useEffect, useMemo, useState } from 'react';
import { Swords, Trophy, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { createRivalCompanion } from '../lib/rival';
import { DEFAULT_PRIZE_AMOUNT } from '../lib/constants';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export interface BattleSetupProps {
  ownerPubkey: string;
  onStart: (pet1: PetsCompanion, pet2: PetsCompanion, prizeAmount: number, mode: 'demo' | 'real') => void;
  className?: string;
}

export function BattleSetup({ ownerPubkey, onStart, className }: BattleSetupProps) {
  const { companions, isLoading } = usePetssCollection();
  const { profile } = useBlobbonautProfile();

  const eligiblePets = useMemo(
    () => companions.filter((pet) => pet.stage === 'baby' || pet.stage === 'adult'),
    [companions],
  );

  const [pet1Id, setPet1Id] = useState<string>('');
  const [pet2Id, setPet2Id] = useState<string>('');

  useEffect(() => {
    if (eligiblePets.length > 0 && !pet1Id) {
      setPet1Id(eligiblePets[0].d);
    }
    if (eligiblePets.length > 1 && !pet2Id) {
      setPet2Id(eligiblePets[1].d);
    }
    if (eligiblePets.length === 1 && !pet2Id) {
      setPet2Id('rival');
    }
  }, [eligiblePets, pet1Id, pet2Id]);

  const pet1 = useMemo(
    () => eligiblePets.find((pet) => pet.d === pet1Id) ?? eligiblePets[0],
    [eligiblePets, pet1Id],
  );
  const pet2 = useMemo(() => {
    if (pet2Id === 'rival') {
      return createRivalCompanion(ownerPubkey, 1);
    }
    return eligiblePets.find((pet) => pet.d === pet2Id) ?? createRivalCompanion(ownerPubkey, 1);
  }, [eligiblePets, ownerPubkey, pet2Id]);

  const walletMode = profile?.walletMode ?? 'demo';
  const isRealDisabled = walletMode === 'real';

  const handleStart = () => {
    if (!pet1 || !pet2) return;
    onStart(pet1, pet2, DEFAULT_PRIZE_AMOUNT, walletMode);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading your pets…
        </CardContent>
      </Card>
    );
  }

  if (eligiblePets.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center text-muted-foreground">
          You need a hatched pet to battle. Hatch an egg first!
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="size-5 text-primary" />
          Battle Arena
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Player 1
            </label>
            <Select value={pet1Id} onValueChange={setPet1Id}>
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

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Player 2
            </label>
            <Select value={pet2Id} onValueChange={setPet2Id}>
              <SelectTrigger>
                <SelectValue placeholder="Choose rival" />
              </SelectTrigger>
              <SelectContent>
                {eligiblePets.map((pet) => (
                  <SelectItem key={pet.d} value={pet.d}>
                    {pet.name} ({pet.stage})
                  </SelectItem>
                ))}
                <SelectItem value="rival">Rival Blob</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg bg-muted p-3 text-sm">
          <Trophy className="size-5 text-amber-500" />
          <div className="flex-1">
            <p className="font-medium">
              Winner prize: {DEFAULT_PRIZE_AMOUNT} BAO coins
            </p>
            <p className="text-muted-foreground">
              One prize per day. Real sats mode coming soon.
            </p>
          </div>
        </div>

        {isRealDisabled && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700">
            <Info className="size-4 shrink-0" />
            <p>
              Your profile is in real-sats mode. Demo battle rewards are paused
              until real Cashu payouts are enabled.
            </p>
          </div>
        )}

        <Button
          size="lg"
          className="w-full"
          onClick={handleStart}
          disabled={!pet1 || !pet2}
        >
          <Swords className="mr-2 size-4" />
          Start Battle
        </Button>
      </CardContent>
    </Card>
  );
}
