import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft } from 'lucide-react';
import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import {
  ChaseCanvas,
  ChaseHud,
  ChaseStartScreen,
  ChaseEndScreen,
  useChaseGame,
  useChasePayout,
  type ChaseMode,
  CHASE_FIAT_COST,
} from '@/pets/chase';

const PET_WIDTH = 64;
const PET_HEIGHT = 64;

function DashboardLoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
      <Skeleton className="size-16 rounded-2xl" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

export default function ChaseBtcPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading, updateProfileEvent } = useNostrPetProfile();
  const { companions, isLoading: collectionLoading } = usePetssCollection();

  const { wallet: petsWallet, isCashu } = usePetsWallet();

  const [mode, setMode] = useState<ChaseMode>('fiat');
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useSeoMeta({
    title: 'Chase BTC | NOSTR Pets',
    description: 'Run the ₿AO payment rails and collect demo sats',
  });

  useLayoutOptions({
    hideTopBar: true,
    hideBottomNav: true,
    noOverscroll: true,
    rightSidebar: null,
  });

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const groundY = useMemo(() => Math.floor(containerSize.height * 0.78), [containerSize.height]);
  const petX = useMemo(() => Math.floor(containerSize.width * 0.15), [containerSize.width]);

  const companion: PetsCompanion | null = useMemo(() => {
    if (!user?.pubkey) return null;
    const selectedD = profile?.currentCompanion;
    if (selectedD) {
      const found = companions.find((c) => c.d === selectedD);
      if (found) return found;
    }
    return companions[0] ?? null;
  }, [companions, profile?.currentCompanion, user?.pubkey]);

  const { state, status, startRun, resetRun, jump, duck } = useChaseGame({
    mode,
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    groundY,
    petX,
    petWidth: PET_WIDTH,
    petHeight: PET_HEIGHT,
  });

  const payout = useChasePayout(updateProfileEvent, petsWallet);

  // In real-money mode the BAO faucet is not available, so sats mode is disabled.
  useEffect(() => {
    if (isCashu && mode === 'sats') {
      setMode('fiat');
    }
  }, [isCashu, mode]);

  const handleStart = useCallback(
    (selectedMode: ChaseMode) => {
      setMode(selectedMode);
      resetRun();
      // Defer start so reset completes and mode state is stable.
      requestAnimationFrame(() => {
        startRun();
      });
    },
    [resetRun, startRun],
  );

  const handleRetry = useCallback(() => {
    if (mode === 'fiat' && (profile?.coins ?? 0) < CHASE_FIAT_COST) {
      return;
    }
    handleStart(mode);
  }, [handleStart, mode, profile?.coins]);

  const handleClaimSats = useCallback(async () => {
    if (mode !== 'sats') return { success: false, claimedAmount: 0, message: 'Not in sats mode' };
    if (payout.isPending) return { success: false, claimedAmount: 0, message: 'Claim already in progress' };
    try {
      const result = await payout.mutateAsync({
        satsWon: state.result.satsWon,
        coinsCollected: state.result.coinsCollected,
        mode: 'sats',
      });
      return { success: true, claimedAmount: result.claimedSats };
    } catch (error) {
      return {
        success: false,
        claimedAmount: 0,
        message: error instanceof Error ? error.message : 'Claim failed',
      };
    }
  }, [mode, payout, state.result.coinsCollected, state.result.satsWon]);

  const handlePointerDown = useCallback(() => {
    if (status === 'running') {
      jump();
    }
  }, [jump, status]);

  const handlePointerDownDuck = useCallback(
    (active: boolean) => {
      if (status === 'running') {
        duck(active);
      }
    },
    [duck, status],
  );

  const coins = profile?.coins ?? 0;
  const sats = profile?.sats ?? 0;
  const isLoading = profileLoading || collectionLoading;

  if (!user) {
    return (
      <main className="flex flex-col items-center justify-center p-6 gap-6 min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <h1 className="text-2xl font-bold">Chase BTC</h1>
          <p className="text-muted-foreground">Log in to chase the ₿AO rails.</p>
          <LoginArea className="mt-2" />
        </div>
      </main>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate('/pets')}>
          <ChevronLeft className="size-4 mr-1" />
          Back
        </Button>
        <h1 className="font-semibold text-sm sm:text-base">Chase BTC</h1>
        <div className="w-16" />
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerUp={() => handlePointerDownDuck(false)}
        onPointerLeave={() => handlePointerDownDuck(false)}
        onPointerCancel={() => handlePointerDownDuck(false)}
      >
        {isLoading || containerSize.width === 0 ? (
          <DashboardLoadingState />
        ) : (
          <>
            {containerSize.width > 0 && containerSize.height > 0 && (
              <ChaseCanvas state={state} width={containerSize.width} height={containerSize.height} groundY={groundY} />
            )}

            {companion && status !== 'idle' && (
              <div
                className="absolute pointer-events-none transition-transform will-change-transform"
                style={{
                  left: petX,
                  top: state.petY,
                  width: PET_WIDTH,
                  height: PET_HEIGHT,
                  transform: state.isDucking ? 'scaleY(0.65) translateY(35%)' : undefined,
                }}
              >
                <PetsStageVisual
                  companion={companion}
                  size="md"
                  animated={status === 'running'}
                  reaction="happy"
                  facing="right"
                  className="size-full"
                />
              </div>
            )}

            {status === 'running' && <ChaseHud state={state} mode={mode} />}

            {status === 'idle' && (
              <ChaseStartScreen coins={coins} sats={sats} onStart={handleStart} allowSatsMode={!isCashu} />
            )}

            {status === 'ended' && (
              <ChaseEndScreen
                result={state.result}
                mode={mode}
                onRetry={handleRetry}
                onExit={() => navigate('/pets')}
                onClaimSats={mode === 'sats' ? handleClaimSats : undefined}
                isClaiming={payout.isPending}
              />
            )}

            {status === 'running' && (
              <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
                <div className="rounded-full bg-background/90 px-4 py-2 text-xs font-medium shadow-sm border text-muted-foreground">
                  Tap / Space / ↑ to jump · ↓ to duck
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
