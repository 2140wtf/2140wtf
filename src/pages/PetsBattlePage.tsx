import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBlobbonautProfile } from '@/hooks/useBlobbonautProfile';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import {
  BattleArena,
  BattleSetup,
  BattleResultOverlay,
  useBattleGame,
  useBattlePayout,
  emitBattleInteractionEvent,
} from '@/pets/battle';
import {
  DEFAULT_PRIZE_AMOUNT,
  DEFAULT_ROUND_DURATION_SECONDS,
} from '@/pets/battle/lib/constants';
import type { PetsCompanion } from '@/pets/core/lib/pets';

export default function PetsBattlePage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { updateProfileEvent } = useBlobbonautProfile();

  useSeoMeta({
    title: 'Battle Arena | 2140 Pets',
    description: 'Battle your 2140 Pets for ₿AO credits',
  });

  useLayoutOptions({
    hideTopBar: true,
    hideBottomNav: true,
    noOverscroll: true,
    rightSidebar: null,
  });

  const [matchOptions, setMatchOptions] = useState({
    prizeAmount: DEFAULT_PRIZE_AMOUNT,
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
  });
  const [matchMode, setMatchMode] = useState<'demo-sats' | 'btc-sats'>('demo-sats');
  const [pendingPayout, setPendingPayout] = useState(false);
  const selectedPetsRef = useRef<{ pet1: PetsCompanion; pet2: PetsCompanion } | null>(null);

  const { state, inputRef, startMatch, resetMatch, onFinishRef } = useBattleGame(matchOptions);
  const payout = useBattlePayout(updateProfileEvent);
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const { toast } = useToast();

  useEffect(() => {
    onFinishRef.current = async (winner) => {
      if (winner === null || payout.isPending) return;

      setPendingPayout(true);
      try {
        await payout.mutateAsync({
          amount: matchOptions.prizeAmount,
          mode: matchMode,
        });
      } finally {
        setPendingPayout(false);
      }

      const { pet1, pet2 } = selectedPetsRef.current ?? {};
      if (pet1 && pet2 && user) {
        if (!isEnabled('pets')) {
          toast({ title: 'Pets publishing disabled', description: 'Turn on “Publish pet events” in Settings → Privacy & Publishing to record battles.' });
          return;
        }
        emitBattleInteractionEvent(publishEvent, {
          ownerPubkey: user.pubkey,
          fighterDTags: [pet1.d, pet2.d],
          winnerDTag:
            winner === 0 ? pet1.d : winner === 1 ? pet2.d : 'draw',
          mode: matchMode,
          prizeAmount: matchOptions.prizeAmount,
          durationSeconds: matchOptions.roundDurationSeconds,
          p1Health: Math.max(0, state.fighters[0].health),
          p2Health: Math.max(0, state.fighters[1].health),
        });
      }
    };
  }, [
    onFinishRef,
    payout,
    publishEvent,
    matchOptions.prizeAmount,
    matchOptions.roundDurationSeconds,
    matchMode,
    state.fighters,
    user,
    isEnabled,
    toast,
  ]);

  const handleStart = (
    pet1: PetsCompanion,
    pet2: PetsCompanion,
    prizeAmount: number,
    mode: 'demo-sats' | 'btc-sats',
  ) => {
    selectedPetsRef.current = { pet1, pet2 };
    setMatchOptions((prev) => ({ ...prev, prizeAmount }));
    setMatchMode(mode);
    startMatch(pet1, pet2);
  };

  const handleRematch = () => {
    const { pet1, pet2 } = selectedPetsRef.current ?? {};
    if (pet1 && pet2) {
      resetMatch(pet1, pet2);
      startMatch(pet1, pet2);
    }
  };

  const handleExit = () => {
    const { pet1, pet2 } = selectedPetsRef.current ?? {};
    if (pet1 && pet2) {
      resetMatch(pet1, pet2);
    }
    navigate('/pets');
  };

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-bold">Battle Arena</h1>
          <p className="mt-2 text-muted-foreground">
            Log in to battle your pets and win credits.
          </p>
          <LoginArea className="mt-6" />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <div className="w-full max-w-5xl">
        {state.status === 'setup' ? (
          <BattleSetup
            ownerPubkey={user.pubkey}
            onStart={handleStart}
          />
        ) : (
          <div className="relative">
            <BattleArena state={state} inputRef={inputRef} />
            {state.status === 'finished' && (
              <BattleResultOverlay
                winner={state.winner}
                fighterNames={[
                  state.fighters[0].pet.name,
                  state.fighters[1].pet.name,
                ]}
                prizeAmount={matchOptions.prizeAmount}
                mode={matchMode}
                isPayoutPending={pendingPayout}
                onRematch={handleRematch}
                onExit={handleExit}
              />
            )}
            <div className="mt-3 flex justify-center sm:hidden">
              <Button variant="outline" size="sm" onClick={handleExit}>
                Exit Arena
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
