import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
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
  BattleTouchControls,
  useBattleGame,
  useBattlePayout,
  emitBattleInteractionEvent,
} from '@/pets/battle';
import { useRemoteBattle } from '@/pets/battle';
import { useIsLandscape, useIsTouchDevice } from '@/pets/battle/lib/useMediaQuery';
import { Maximize, Minimize } from 'lucide-react';
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
  checkEscrowDepositSpentState,
  loadPendingBattleDeposits,
  clearPendingBattleDeposit,
  PENDING_CLAIM_MAX_ATTEMPTS,
  type PendingEscrowClaim,
} from '@/pets/battle/lib/cashuEscrow';
import { BATTLE_ATTESTATION_KIND, BATTLE_ATTESTATION_RELAY, BATTLE_ATTESTATION_TAG } from '@/pets/battle/lib/battleMessages';
import { getMultisigDepositLocktime } from '@/lib/cashu/escrowMultisig';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { BattleMatchOptions } from '@/pets/battle';

export default function PetsBattlePage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { updateProfileEvent } = useNostrPetProfile();
  const { nostr } = useNostr();

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

  const { role: remoteRole, sendFinished: sendRemoteFinished, sendAttestation } = remote;

  const isTouch = useIsTouchDevice();
  const isLandscape = useIsLandscape();

  // Which fighters are human on THIS device: both for local two-player, just
  // P1 against the bot, and exactly one side per device in remote matches
  // (host = P1, guest = P2). Only humans get touch buttons / keyboard help.
  const humanPlayers = useMemo(() => {
    if (matchOptions.remoteMode === 'host') return { p1: true, p2: false };
    if (matchOptions.remoteMode === 'guest') return { p1: false, p2: true };
    if (matchOptions.isAiOpponent) return { p1: true, p2: false };
    return { p1: true, p2: true };
  }, [matchOptions.remoteMode, matchOptions.isAiOpponent]);

  // Fullscreen battle: on touch devices entering fullscreen also asks the OS
  // for landscape (either way up — the player can flip the phone freely).
  const battleSectionRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        try { screen.orientation.unlock(); } catch { /* not locked */ }
      } else {
        await battleSectionRef.current?.requestFullscreen();
        try {
          // lock('landscape') still allows flipping between the two landscape
          // orientations; unsupported platforms (iOS Safari) just throw.
          await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape');
        } catch { /* orientation lock unsupported */ }
      }
    } catch { /* fullscreen unsupported */ }
  }, []);

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
   *
   * Guarded against concurrent execution: the hydration effect's intermediate
   * journal saves re-render the page, which re-fires the retry effect while
   * the first claim is still awaiting the operator — an in-flight battle
   * returns 'busy' so the operator never sees two /release posts for it.
   */
  const claimInflightRef = useRef(new Set<string>());
  const claimEscrowPrize = useCallback(
    async (claim: PendingEscrowClaim): Promise<'claimed' | 'pending' | 'busy'> => {
      if (!config.petsBattleEscrowServiceUrl || !petsWallet || !escrowKeypair) {
        throw new Error('Escrow claim prerequisites are not ready.');
      }
      if (claimInflightRef.current.has(claim.battleId)) return 'busy';
      claimInflightRef.current.add(claim.battleId);
      try {
      // Deferred claim: both players' result attestations are required — the
      // operator releases only when they agree. Posting without them would be
      // rejected and burn an attempt.
      if (!claim.ownAttestation || !claim.opponentAttestation) return 'pending';
      let releaseToken = claim.releaseToken;
      if (!releaseToken) {
        const hostAttestation = claim.localRole === 'host' ? claim.ownAttestation : claim.opponentAttestation;
        const guestAttestation = claim.localRole === 'guest' ? claim.ownAttestation : claim.opponentAttestation;
        let release;
        try {
          release = await requestEscrowRelease({
            serviceUrl: config.petsBattleEscrowServiceUrl,
            battleId: claim.battleId,
            winnerPubkey: claim.winnerPubkey,
            hostPubkey: claim.hostPubkey,
            guestPubkey: claim.guestPubkey,
            hostDepositToken: claim.hostDepositToken,
            guestDepositToken: claim.guestDepositToken,
            hostAttestation,
            guestAttestation,
          });
        } catch (err) {
          // The opponent may have published several conflicting attestations
          // (griefing): on a disagreement rejection, discard THIS one and let
          // the hydration effect try another event from the relay set.
          if (err instanceof Error && /disagree/i.test(err.message)) {
            const triedId = typeof claim.opponentAttestation.id === 'string' ? claim.opponentAttestation.id : null;
            savePendingEscrowClaim({
              ...claim,
              opponentAttestation: undefined,
              triedAttestationIds: triedId
                ? [...(claim.triedAttestationIds ?? []), triedId]
                : claim.triedAttestationIds,
            });
            return 'pending';
          }
          throw err;
        }
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
      } finally {
        claimInflightRef.current.delete(claim.battleId);
      }
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
      (c) =>
        normalizeEscrowPubkey(c.winnerPubkey) === localEscrowPubkey &&
        c.attempts < PENDING_CLAIM_MAX_ATTEMPTS &&
        // Deferred claims (still waiting for an attestation) are hydrated by
        // the attestation effect below, not retried blind.
        c.ownAttestation && c.opponentAttestation,
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
          } else if (outcome === 'pending') {
            savePendingEscrowClaim({ ...claim, attempts: claim.attempts + 1 });
          }
          // 'busy': a concurrent execution owns this battle's journal — leave it.
        } catch (err) {
          console.warn('[PetsBattlePage] escrow claim retry failed:', err);
          savePendingEscrowClaim({ ...claim, attempts: claim.attempts + 1 });
        }
      }
    })();
  }, [petsWallet, escrowKeypair, localEscrowPubkey, config.petsBattleEscrowServiceUrl, claimEscrowPrize, toast]);

  // Attestation hydration: a claim can only fire once BOTH players' result
  // attestations are journaled (the operator releases only when they agree).
  // The opponent's attestation is published by their app at battle end and
  // found here via relay query; our own is re-published when missing (e.g.
  // the first publish raced a closed tab). Runs on mount and polls while any
  // deferred claim exists — the opponent's attestation typically lands within
  // seconds of the finish. Hydrating the journal before executing keeps every
  // step idempotent across re-renders and reloads.
  useEffect(() => {
    if (!petsWallet || !escrowKeypair || !localEscrowPubkey) return;
    if (!config.petsBattleEscrowServiceUrl || !config.petsBattleEscrowPubkey) return;
    let cancelled = false;

    const hydrate = async () => {
      const deferred = loadPendingEscrowClaims().filter(
        (c) =>
          normalizeEscrowPubkey(c.winnerPubkey) === localEscrowPubkey &&
          c.attempts < PENDING_CLAIM_MAX_ATTEMPTS &&
          (!c.ownAttestation || !c.opponentAttestation),
      );
      for (const claim of deferred) {
        if (cancelled) return;
        try {
          let own = claim.ownAttestation;
          if (!own) {
            // The claim only exists when the local player won: host = 0, guest = 1.
            const ev = await sendAttestation(
              claim.localRole === 'host' ? 0 : 1,
              escrowKeypair.privkey,
              config.petsBattleEscrowPubkey!,
              claim.opponentNostrPubkey
                ? { battleId: claim.battleId, opponentPubkey: claim.opponentNostrPubkey }
                : undefined,
            );
            if (ev) {
              own = { id: ev.id, pubkey: ev.pubkey, kind: ev.kind, created_at: ev.created_at, tags: ev.tags, content: ev.content, sig: ev.sig };
            }
          }

          let opponent = claim.opponentAttestation;
          if (!opponent && claim.opponentNostrPubkey) {
            // Query the pool AND the ₿AO rendezvous relay explicitly: the
            // opponent pins their attestation there regardless of relay
            // settings, so this is the guaranteed shared bulletin board.
            const filter = {
              kinds: [BATTLE_ATTESTATION_KIND],
              '#e': [claim.battleId],
              '#t': [BATTLE_ATTESTATION_TAG],
              authors: [claim.opponentNostrPubkey],
              limit: 10,
            };
            const [poolEvents, baoEvents] = await Promise.all([
              nostr.query([filter]),
              nostr.relay(BATTLE_ATTESTATION_RELAY).query([filter]).catch(() => []),
            ]);
            const events = [...poolEvents, ...baoEvents];
            const tried = new Set(claim.triedAttestationIds ?? []);
            const found = events.find((ev) => !tried.has(ev.id));
            if (found) {
              opponent = { id: found.id, pubkey: found.pubkey, kind: found.kind, created_at: found.created_at, tags: found.tags, content: found.content, sig: found.sig };
            }
          }

          if (!own || !opponent) {
            if (own !== claim.ownAttestation) savePendingEscrowClaim({ ...claim, ownAttestation: own });
            continue;
          }

          const hydrated: PendingEscrowClaim = { ...claim, ownAttestation: own, opponentAttestation: opponent };
          savePendingEscrowClaim(hydrated);
          const outcome = await claimEscrowPrize(hydrated);
          // No `cancelled` check here: a stale run that COMPLETED the claim
          // must still report it — the prize is already in the wallet and the
          // toaster is global (unmounting mid-claim must not eat the toast).
          if (outcome === 'claimed') {
            toast({ title: 'Battle prize claimed!', description: `You received ${(hydrated.prizeAmount * 2).toLocaleString()} real sats.` });
          } else if (outcome === 'pending') {
            const journaled = loadPendingEscrowClaims().find((c) => c.battleId === hydrated.battleId) ?? hydrated;
            savePendingEscrowClaim({ ...journaled, attempts: journaled.attempts + 1 });
          }
          // 'busy': a concurrent execution owns this battle's journal — leave it.
        } catch (err) {
          console.warn('[PetsBattlePage] attestation hydration failed:', err);
          const journaled = loadPendingEscrowClaims().find((c) => c.battleId === claim.battleId) ?? claim;
          savePendingEscrowClaim({ ...journaled, attempts: journaled.attempts + 1 });
        }
      }
    };

    void hydrate();
    const interval = setInterval(() => {
      const stillDeferred = loadPendingEscrowClaims().some(
        (c) =>
          normalizeEscrowPubkey(c.winnerPubkey) === localEscrowPubkey &&
          c.attempts < PENDING_CLAIM_MAX_ATTEMPTS &&
          (!c.ownAttestation || !c.opponentAttestation),
      );
      if (stillDeferred) void hydrate();
    }, 8_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sendAttestation, nostr, petsWallet, escrowKeypair, localEscrowPubkey, config.petsBattleEscrowServiceUrl, config.petsBattleEscrowPubkey, claimEscrowPrize, toast]);

  // Sweep stale escrow-DEPOSIT journals from abandoned battles. Each journaled
  // token is the only handle on a stake the wallet was already debited for.
  // Post-locktime the depositor's own refund key alone reclaims it (2-of-3
  // multisig: no operator, no opponent). Already-spent proofs mean the stake
  // resolved elsewhere (release/claim) → drop the entry. Unverifiable → keep
  // the journal for the next visit rather than risk abandoning real sats.
  const depositSweepRanRef = useRef(false);
  useEffect(() => {
    if (depositSweepRanRef.current) return;
    if (!petsWallet || !escrowKeypair) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stale = loadPendingBattleDeposits().filter((d) => {
      const locktime = getMultisigDepositLocktime(d.token);
      // Non-multisig (legacy) or locktime still in the future → not ours to sweep.
      return locktime !== null && locktime <= nowSeconds;
    });
    if (stale.length === 0) return;
    depositSweepRanRef.current = true;
    void (async () => {
      for (const deposit of stale) {
        try {
          const spentState = await checkEscrowDepositSpentState(deposit.token);
          if (spentState?.includes('already spent')) {
            clearPendingBattleDeposit(deposit.battleId);
            continue;
          }
          if (spentState !== null) continue; // unverifiable/pending — retry next visit
          const received = await petsWallet.receiveLockedToken(deposit.token, escrowKeypair.privkey);
          if (received > 0) {
            clearPendingBattleDeposit(deposit.battleId);
            toast({
              title: 'Battle stake refunded',
              description: `Reclaimed ${received.toLocaleString()} sats from an abandoned battle.`,
            });
          }
        } catch (err) {
          console.warn('[PetsBattlePage] stale deposit reclaim failed:', err);
        }
      }
    })();
  }, [petsWallet, escrowKeypair, toast]);

  useEffect(() => {
    onFinishRef.current = async (winner) => {
      if (winner === null || payout.isPending) return;

      // In remote matches the authoritative host announces the result to the
      // guest (UI sync). The escrow no longer relies on that event: BOTH
      // players publish a result attestation encrypted to the operator, and
      // the operator co-signs only when the two agree.
      if (remoteRole === 'host') {
        await sendRemoteFinished(winner);
      }

      // Publish OUR attestation the moment the outcome is known locally — for
      // the guest this fires from the final battle-state snapshot, which can
      // arrive before the host's battle-finished event; either way the
      // attestation must be on the relays before the winner can claim.
      let ownAttestation: Record<string, unknown> | undefined;
      if (matchMode === 'real-sats' && escrowKeypair && config.petsBattleEscrowPubkey && remote.battleId) {
        const att = await sendAttestation(winner, escrowKeypair.privkey, config.petsBattleEscrowPubkey);
        if (att) {
          ownAttestation = { id: att.id, pubkey: att.pubkey, kind: att.kind, created_at: att.created_at, tags: att.tags, content: att.content, sig: att.sig };
        }
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
          // The claim stays DEFERRED until the opponent's attestation is found
          // on the relays (hydration effect above) — the operator releases
          // only when both players attest the same winner.
          const claim: PendingEscrowClaim = {
            battleId: remote.battleId ?? '',
            localRole: remoteRole === 'guest' ? 'guest' : 'host',
            opponentNostrPubkey: remote.opponentPubkey ?? '',
            winnerPubkey: localEscrowPubkey,
            hostPubkey,
            guestPubkey,
            hostDepositToken: remote.escrow.hostDepositToken ?? '',
            guestDepositToken: remote.escrow.guestDepositToken ?? '',
            ownAttestation,
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
              toast({
                title: 'Prize claim saved — awaiting opponent confirmation',
                description: "The escrow releases automatically the moment your opponent's matching result confirmation is found. Your claim is journaled locally and fires on its own.",
              });
            }
          } catch (claimErr) {
            // Re-read the journal before re-saving: claimEscrowPrize may have
            // journaled the operator's releaseToken before the wallet receive
            // failed. Re-saving the stale pre-release `claim` would clobber
            // the token and force a second /release the operator refuses.
            const journaled =
              loadPendingEscrowClaims().find((c) => c.battleId === claim.battleId) ?? claim;
            savePendingEscrowClaim({ ...journaled, attempts: journaled.attempts + 1 });
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
    sendAttestation,
    remote.hostFinishedEvent,
    remote.opponentPubkey,
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
          <div
            ref={battleSectionRef}
            className={
              isFullscreen
                ? 'relative flex h-full flex-col justify-center gap-2 overflow-y-auto bg-slate-950 p-2'
                : 'relative flex flex-col gap-3'
            }
          >
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-lg font-bold sm:text-xl">Battle Arena</h1>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen battle'}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen battle'}
                >
                  {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExit}
                  className="hidden sm:inline-flex"
                >
                  Exit Arena
                </Button>
              </div>
            </div>

            <BattleControlsHelp variant="inline" players={humanPlayers} />

            <BattleArena state={state} inputRef={inputRef} players={humanPlayers} />

            {/* Portrait touch play: buttons below the battle, thumbs never
                cover the fight. Landscape renders edge overlays instead. */}
            {isTouch && !isLandscape && (
              <BattleTouchControls inputRef={inputRef} players={humanPlayers} layout="below" />
            )}

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
