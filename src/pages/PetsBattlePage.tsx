import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  deriveBattleEscrowKeypair,
  normalizeEscrowPubkey,
  requestEscrowRelease,
  savePendingEscrowClaim,
  loadPendingEscrowClaims,
  clearPendingEscrowClaim,
  PENDING_CLAIM_MAX_ATTEMPTS,
  type PendingEscrowClaim,
} from '@/pets/battle/lib/cashuEscrow';
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

  const localEscrowPubkey = useMemo(
    () => (escrowKeypair ? (normalizeEscrowPubkey(escrowKeypair.pubkey) ?? escrowKeypair.pubkey) : null),
    [escrowKeypair],
  );

  /**
   * Execute a journaled escrow claim: ask the operator for the release (unless
   * a release token is already journaled — the operator never releases twice,
   * so a receive failure must not trigger a second /release call), then receive
   * the P2PK-locked prize token into the wallet. On success the journal entry
   * is cleared. Throws on failure; the caller keeps the journal for a retry.
   */
  const claimEscrowPrize = useCallback(
    async (claim: PendingEscrowClaim): Promise<'claimed' | 'pending'> => {
      if (!config.petsBattleEscrowServiceUrl || !petsWallet || !escrowKeypair) {
        throw new Error('Escrow claim prerequisites are not ready.');
      }
      let releaseToken = claim.releaseToken;
      if (!releaseToken) {
        const release = await requestEscrowRelease({
          serviceUrl: config.petsBattleEscrowServiceUrl,
          battleId: claim.battleId,
          winnerPubkey: claim.winnerPubkey,
          hostPubkey: claim.hostPubkey,
          guestPubkey: claim.guestPubkey,
          hostDepositToken: claim.hostDepositToken,
          guestDepositToken: claim.guestDepositToken,
          finishedEvent: claim.finishedEvent,
        });
        releaseToken = release?.token;
        if (releaseToken) {
          // Journal the release token BEFORE the receive — losing this string
          // would strand the prize with no way to ask the operator again.
          savePendingEscrowClaim({ ...claim, releaseToken });
        }
      }
      if (!releaseToken) return 'pending';
      const received = await petsWallet.receiveLockedToken(releaseToken, escrowKeypair.privkey);
      if (received <= 0) {
        // receiveToken journaled the token into the wallet's own pending-receive
        // recovery as well, so the prize is doubly protected — but keep OUR
        // journal until the sats actually land.
        throw new Error('The escrow released the prize but the wallet could not receive it yet.');
      }
      clearPendingEscrowClaim(claim.battleId);
      return 'claimed';
    },
    [config.petsBattleEscrowServiceUrl, petsWallet, escrowKeypair],
  );

  // Retry journaled escrow claims once the wallet and escrow key are ready.
  // This is what makes a failed/refresh-interrupted prize claim recoverable
  // instead of stranding both players' locked stakes with the operator.
  const claimRetryRanRef = useRef(false);
  useEffect(() => {
    if (claimRetryRanRef.current) return;
    if (!petsWallet || !escrowKeypair || !localEscrowPubkey || !config.petsBattleEscrowServiceUrl) return;
    const claims = loadPendingEscrowClaims().filter(
      (c) => normalizeEscrowPubkey(c.winnerPubkey) === localEscrowPubkey && c.attempts < PENDING_CLAIM_MAX_ATTEMPTS,
    );
    if (claims.length === 0) return;
    claimRetryRanRef.current = true;
    void (async () => {
      for (const claim of claims) {
        try {
          const outcome = await claimEscrowPrize(claim);
          if (outcome === 'claimed') {
            toast({
              title: 'Battle prize claimed!',
              description: `Recovered ${claim.prizeAmount * 2 > 0 ? `${(claim.prizeAmount * 2).toLocaleString()} ` : ''}real sats from a previous battle.`,
            });
          } else {
            savePendingEscrowClaim({ ...claim, attempts: claim.attempts + 1 });
          }
        } catch (err) {
          console.warn('[PetsBattlePage] escrow claim retry failed:', err);
          savePendingEscrowClaim({ ...claim, attempts: claim.attempts + 1 });
        }
      }
    })();
  }, [petsWallet, escrowKeypair, localEscrowPubkey, config.petsBattleEscrowServiceUrl, claimEscrowPrize, toast]);

  useEffect(() => {
    onFinishRef.current = async (winner) => {
      if (winner === null || payout.isPending) return;

      // In remote matches the authoritative host announces the result. The
      // guest forwards the host-signed finished event it received over the
      // sync channel — sending `{}` would give the escrow operator no
      // verifiable outcome proof and the release request would fail.
      let finishedEvent: NostrEvent | undefined;
      if (remoteRole === 'host') {
        finishedEvent = await sendRemoteFinished(winner) ?? undefined;
      } else if (remoteRole === 'guest') {
        finishedEvent = remote.hostFinishedEvent ?? undefined;
      }

      // Only the local player gets a prize when they win. Host is P1 (index 0),
      // guest is P2 (index 1).
      const localPlayerIndex = remoteRole === 'guest' ? 1 : 0;
      if (winner !== localPlayerIndex) return;

      setPendingPayout(true);
      try {
        if (matchMode === 'real-sats') {
          if (!escrowKeypair || !localEscrowPubkey || !config.petsBattleEscrowServiceUrl || !config.petsBattleEscrowPubkey) {
            toast({ title: 'Escrow not configured', description: 'Cannot claim real-sats prize.', variant: 'destructive' });
            return;
          }
          const hostPubkey = remoteRole === 'host' ? localEscrowPubkey : (remote.escrow.hostEscrowPubkey ?? '');
          const guestPubkey = remoteRole === 'guest' ? localEscrowPubkey : (remote.escrow.guestEscrowPubkey ?? '');
          // Journal everything the release needs BEFORE the first attempt: the
          // deposit tokens live only in React state, so a failed request (or
          // closing the page, or Rematch/Exit wiping the battle state) would
          // otherwise strand both locked stakes with the operator forever.
          // Journaled claims are retried automatically on this page.
          const claim: PendingEscrowClaim = {
            battleId: remote.battleId ?? '',
            winnerPubkey: localEscrowPubkey,
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
            prizeAmount: matchOptions.prizeAmount,
            createdAt: Date.now(),
            attempts: 0,
          };
          savePendingEscrowClaim(claim);
          try {
            const outcome = await claimEscrowPrize(claim);
            if (outcome === 'claimed') {
              toast({ title: 'Battle prize claimed!', description: `You received ${(matchOptions.prizeAmount * 2).toLocaleString()} real sats.` });
            } else {
              savePendingEscrowClaim({ ...claim, attempts: 1 });
              toast({ title: 'Escrow release pending', description: 'The operator will release your prize shortly — your claim is saved locally and retried automatically.', variant: 'default' });
            }
          } catch (claimErr) {
            savePendingEscrowClaim({ ...claim, attempts: 1 });
            const reason = claimErr instanceof Error ? claimErr.message : String(claimErr);
            toast({
              title: 'Prize claim saved — will retry',
              description: `The escrow release failed (${reason}). Your claim is journaled locally and retried automatically when you return to this page.`,
              variant: 'destructive',
            });
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
    remote.hostFinishedEvent,
    escrowKeypair,
    localEscrowPubkey,
    claimEscrowPrize,
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
    // Real-sats: never start the match before both escrow deposits are locked
    // — otherwise one side can fight (and win) with zero sats at stake.
    if (remote.escrow.mode === 'real-sats' && remote.escrow.phase !== 'ready') return;

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
    remote.escrow.phase,
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
