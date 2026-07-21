import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import {
  BattleArena,
  BattleControlsHelp,
  BattleSetup,
  BattleResultOverlay,
  BattleInvitePending,
  useBattleGame,
  useBattlePayout,
  emitBattleInteractionEvent,
} from '@/pets/battle';
import { useRemoteBattle } from '@/pets/battle';
import {
  DEFAULT_PRIZE_SATS,
  DEFAULT_ROUND_DURATION_SECONDS,
} from '@/pets/battle/lib/constants';
import { deriveBattleEscrowKeypair, requestEscrowRelease } from '@/pets/battle/lib/cashuEscrow';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { BattleMatchOptions } from '@/pets/battle';

export default function PetsBattlePage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { updateProfileEvent } = useNostrPetProfile();

  const { wallet: petsWallet, isBao } = usePetsWallet();
  const { config } = useAppContext();
  const { seedPhrase } = useCashuSeed();

  const escrowKeypair = useMemo(() => {
    if (!seedPhrase) return null;
    try {
      return deriveBattleEscrowKeypair(seedPhrase);
    } catch {
      return null;
    }
  }, [seedPhrase]);

  useSeoMeta({
    title: 'Battle Arena | NOSTR Pets',
    description: 'Battle your NOSTR Pets for ₿AO credits',
  });

  useLayoutOptions({
    hideTopBar: true,
    hideBottomNav: true,
    noOverscroll: true,
    rightSidebar: null,
  });

  const [matchOptions, setMatchOptions] = useState<BattleMatchOptions>({
    prizeAmount: DEFAULT_PRIZE_SATS,
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    isAiOpponent: false,
  });
  const [matchMode, setMatchMode] = useState<'demo-sats' | 'btc-sats' | 'real-sats'>('demo-sats');
  const [pendingPayout, setPendingPayout] = useState(false);
  const selectedPetsRef = useRef<{ pet1: PetsCompanion; pet2: PetsCompanion } | null>(null);
  const remote = useRemoteBattle();

  const { state, inputRef, startMatch, resetMatch, onFinishRef, applyHostSnapshot } = useBattleGame(matchOptions);
  const payout = useBattlePayout(updateProfileEvent, petsWallet);
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const { toast } = useToast();

  const { role: remoteRole, sendFinished: sendRemoteFinished } = remote;

  useEffect(() => {
    onFinishRef.current = async (winner) => {
      if (winner === null || payout.isPending) return;

      // In remote matches the authoritative host announces the result.
      let finishedEvent: NostrEvent | undefined;
      if (remoteRole === 'host') {
        finishedEvent = await sendRemoteFinished(winner) ?? undefined;
      }

      // Only the local player gets a prize when they win. Host is P1 (index 0),
      // guest is P2 (index 1).
      const localPlayerIndex = remoteRole === 'guest' ? 1 : 0;
      if (winner !== localPlayerIndex) return;

      setPendingPayout(true);
      try {
        if (matchMode === 'real-sats') {
          if (!escrowKeypair || !config.petsBattleEscrowServiceUrl || !config.petsBattleEscrowPubkey) {
            toast({ title: 'Escrow not configured', description: 'Cannot claim real-sats prize.', variant: 'destructive' });
            return;
          }
          const hostPubkey = remoteRole === 'host' ? escrowKeypair.pubkey : (remote.escrow.hostEscrowPubkey ?? '');
          const guestPubkey = remoteRole === 'guest' ? escrowKeypair.pubkey : (remote.escrow.guestEscrowPubkey ?? '');
          const release = await requestEscrowRelease({
            serviceUrl: config.petsBattleEscrowServiceUrl,
            battleId: remote.battleId ?? '',
            winnerPubkey: escrowKeypair.pubkey,
            hostPubkey,
            guestPubkey,
            hostDepositToken: remote.escrow.hostDepositToken ?? '',
            guestDepositToken: remote.escrow.guestDepositToken ?? '',
            finishedEvent: finishedEvent ? {
              id: finishedEvent.id,
              pubkey: finishedEvent.pubkey,
              kind: finishedEvent.kind,
              created_at: finishedEvent.created_at,
              tags: finishedEvent.tags,
              content: finishedEvent.content,
              sig: finishedEvent.sig,
            } : {},
          });
          if (release?.token && petsWallet && escrowKeypair) {
            await petsWallet.receiveLockedToken(release.token, escrowKeypair.privkey);
            toast({ title: 'Battle prize claimed!', description: `You received ${matchOptions.prizeAmount * 2} real sats.` });
          } else {
            toast({ title: 'Escrow release pending', description: 'The operator will release your prize shortly.', variant: 'default' });
          }
        } else {
          await payout.mutateAsync({
            amount: matchOptions.prizeAmount,
            mode: matchMode,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Payout failed';
        toast({ title: 'Payout failed', description: message, variant: 'destructive' });
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
    remoteRole,
    sendRemoteFinished,
    escrowKeypair,
    config.petsBattleEscrowServiceUrl,
    config.petsBattleEscrowPubkey,
    remote.battleId,
    remote.escrow.hostEscrowPubkey,
    remote.escrow.guestEscrowPubkey,
    remote.escrow.hostDepositToken,
    remote.escrow.guestDepositToken,
    petsWallet,
  ]);

  const handleStart = (
    pet1: PetsCompanion,
    pet2: PetsCompanion,
    prizeAmount: number,
    mode: 'demo-sats' | 'btc-sats',
    isAiOpponent: boolean,
  ) => {
    selectedPetsRef.current = { pet1, pet2 };
    setMatchOptions((prev) => ({ ...prev, prizeAmount, isAiOpponent }));
    setMatchMode(mode);
    startMatch(pet1, pet2);
  };

  // Start a remote match once both sides have agreed on pets.
  useEffect(() => {
    if (remote.phase !== 'accepted' && remote.phase !== 'fighting') return;
    if (!remote.localPet || !remote.opponentPet) return;
    if (state.status !== 'setup') return;

    const isHost = remote.role === 'host';
    const pet1 = isHost ? remote.localPet : remote.opponentPet;
    const pet2 = isHost ? remote.opponentPet : remote.localPet;
    selectedPetsRef.current = { pet1, pet2 };

    setMatchOptions({
      prizeAmount: remote.matchOptions?.prizeAmount ?? DEFAULT_PRIZE_SATS,
      roundDurationSeconds:
        remote.matchOptions?.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS,
      isAiOpponent: false,
      remoteMode: isHost ? 'host' : 'guest',
      onHostSnapshot: remote.sendHostSnapshot,
      onGuestInput: remote.sendGuestInput,
      remoteP2InputRef: isHost ? remote.guestInputRef : undefined,
    });
    setMatchMode(remote.escrow.mode === 'real-sats' ? 'real-sats' : 'demo-sats');
    startMatch(pet1, pet2);
  }, [
    remote.phase,
    remote.localPet,
    remote.opponentPet,
    remote.role,
    remote.matchOptions,
    remote.escrow.mode,
    remote.sendHostSnapshot,
    remote.sendGuestInput,
    remote.guestInputRef,
    state.status,
    startMatch,
  ]);

  // Guest: apply authoritative host snapshots as they arrive.
  useEffect(() => {
    if (remote.role !== 'guest' || !remote.hostSnapshot) return;
    applyHostSnapshot(remote.hostSnapshot);
  }, [remote.role, remote.hostSnapshot, applyHostSnapshot]);

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
    remote.reset();
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
    <main className="flex min-h-screen flex-col p-2 sm:p-4">
      <div className="mx-auto w-full max-w-7xl">
        {state.status === 'setup' ? (
          <>
            <BattleSetup
              ownerPubkey={user.pubkey}
              onStart={handleStart}
              allowBtcSats={isBao}
            />
            <BattleInvitePending />
          </>
        ) : (
          <div className="relative flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-bold sm:text-xl">Battle Arena</h1>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExit}
                className="hidden sm:inline-flex"
              >
                Exit Arena
              </Button>
            </div>

            <BattleControlsHelp variant="inline" />

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
            <div className="flex justify-center sm:hidden">
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
