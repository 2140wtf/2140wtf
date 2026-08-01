/**
 * PetsHatchingCeremony - Immersive hatching experience for every new egg
 *
 * Flow:
 *   1. Dark screen, egg silently created in background
 *   2. Huge breathing egg appears. No text. No UI.
 *   3. Click egg 4 times through crack stages with intensifying shakes
 *   4. Final click -> egg bursts into light, actual hatch mutation fires
 *   5. Flash clears -> hatched baby pets revealed center screen with glow/sparkles
 *   6. Typewriter dialog appears below pets (click to complete line / advance)
 *   7. Naming prompt, then ceremony complete
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { ChevronLeft, Dices, Egg, Loader2 } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchBlockHeight } from '@/lib/bitcoin';
import { impactLight, impactMedium, impactHeavy, notificationSuccess } from '@/lib/haptics';
import { cn } from '@/lib/utils';

import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchFreshNostrPetProfile } from '@/pets/core/lib/fetchFreshNostrPetProfile';
import { useCurrentBlockHeight, isPetOldEnough, getStoredBirthBlockHeight } from '@/pets/core/lib/pets-life';

import {
  KIND_PETS_STATE,
  KIND_NOSTR_PET_PROFILE,
  INITIAL_NOSTR_PET_SATS,
  BAO_PET_STARTER_GRANT_SATS,
  PETS_PREVIEW_REROLL_SATS,
  STAT_MAX,
  buildNostrPetProfileTags,
  updateNostrPetProfileTags,
  updatePetsTags,
  parsePetsEvent,
  type NostrPetProfile,
  type PetsCompanion,
} from '@/pets/core/lib/pets';
import { usePetsStarterGrant } from '@/pets/core/hooks/usePetsStarterGrant';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { validateAndRepairPetsTags } from '@/pets/core/lib/pets-tag-schema';
import { serializeEvolutionContent } from '@/pets/core/lib/missions';
import { createEvolveMissions } from '@/pets/actions/lib/evolution-missions';
import { writeEvolutionToStorage } from '@/pets/actions/lib/daily-mission-tracker';
import { getStreakTagUpdates } from '@/pets/actions/lib/pets-streak';

import {
  generateEggPreview,
  generateEggPreviewForCategory,
  previewToEventTags,
  previewToPetsCompanion,
  type PetsEggPreview,
} from '../lib/pets-preview';
import type { PetsBreedCategory } from '@/pets/core/lib/pet-categories';

import { useTypewriter } from '../hooks/useTypewriter';
import { buildRevealGradient } from '../lib/ceremony-colors';

// ─── Dialog Lines ─────────────────────────────────────────────────────────────

const BIRTH_DIALOG: string[] = [
  'Something stirs...',
  'A tiny life has chosen you. It knows only warmth, and your presence.',
];

const NAMING_DIALOG = 'Every life deserves a name.\nWhat will you call this one?';

// ─── Phase Machine ────────────────────────────────────────────────────────────

type CeremonyPhase =
  | 'loading'
  | 'error'
  | 'preview'     // pre-publish: keep this egg (free) or pay to reroll
  | 'egg'
  | 'crack_1'
  | 'crack_2'
  | 'crack_3'
  | 'hatching'    // egg burst + hatch mutation
  | 'reveal'      // flash clearing, baby pets fading in with glow
  | 'dialog'      // typewriter dialog lines
  | 'naming'
  | 'complete';

// Module-level guard: prevents duplicate egg creation if the component remounts
// (e.g. React strict mode, parent re-render causing unmount/remount).
// Tracks pubkeys that have already started setup in this browser session.
const setupInFlightFor = new Set<string>();

// Module-level guard: prevents duplicate starter-grant claims for the same
// egg if the component remounts. The underlying grant handler still enforces
// the real cap (BAO API for testnet, profile state for real mode).
const starterGrantAttemptedFor = new Set<string>();

// ─── Props ────────────────────────────────────────────────────────────────────

interface PetsHatchingCeremonyProps {
  profile: NostrPetProfile | null;
  updateProfileEvent: (event: NostrEvent) => void;
  updateCompanionEvent: (event: NostrEvent) => void;
  invalidateProfile: () => void;
  invalidateCompanion: () => void;
  setStoredSelectedD: (d: string) => void;
  onComplete?: () => void;
  /** Breed category to constrain the newly created egg. */
  breedCategory?: PetsBreedCategory;
  /** If provided, skip egg creation and start from the cracking phase with this existing egg. */
  existingCompanion?: PetsCompanion | null;
  /** If true, only create the egg and skip the hatching ceremony. The egg stays an egg. */
  eggOnly?: boolean;
  /** Optional exit handler. When provided, a back button is shown so the user can leave the ceremony. */
  onExit?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PetsHatchingCeremony({
  profile,
  updateProfileEvent,
  updateCompanionEvent,
  invalidateProfile,
  invalidateCompanion,
  setStoredSelectedD,
  onComplete,
  onExit,
  breedCategory,
  existingCompanion,
  eggOnly = false,
}: PetsHatchingCeremonyProps) {
  const isExistingEgg = !!existingCompanion;
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { data: authorData } = useAuthor(user?.pubkey);
  const { isBao: isBaoWalletMode, wallet: activeWallet } = usePetsWallet();
  const { config } = useAppContext();
  const currentBlockHeight = useCurrentBlockHeight(config.esploraApis);
  // Prefer the exact birth_block tag written at egg creation (same as
  // PetsPage's room-egg gate and useStartIncubation); fall back to the
  // 10-minute estimate only for legacy eggs without the tag. Using the
  // estimate for tag-bearing eggs kept the ceremony blocked after the room
  // had already (correctly) let the user in.
  const eggTooYoung = isExistingEgg && !isPetOldEnough(
    existingCompanion?.event.created_at,
    currentBlockHeight,
    getStoredBirthBlockHeight(existingCompanion?.event.tags),
  );
  const starterGrant = usePetsStarterGrant();

  // ── Core state ──
  const [phase, setPhase] = useState<CeremonyPhase>('loading');
  const [preview, setPreview] = useState<PetsEggPreview | null>(null);
  const [name, setName] = useState(existingCompanion?.name ?? '');
  const [isNaming, setIsNaming] = useState(false);
  const [eggVisible, setEggVisible] = useState(false);

  // Reveal phase state
  const [petsVisible, setPetsVisible] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [, setShowRevealGlow] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  // Dialog state
  const [dialogLineIndex, setDialogLineIndex] = useState(0);
  const [dialogActive, setDialogActive] = useState(false);
  const [namingVisible, setNamingVisible] = useState(false);

  // Retry state: increments when the user presses Retry on the error screen.
  const [retryCount, setRetryCount] = useState(0);

  // Preview/reroll state (pre-publish egg preview)
  const [isRerolling, setIsRerolling] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [rerollCount, setRerollCount] = useState(0);

  // Refs
  const setupAttempted = useRef(false);
  const setupStarted = useRef(false);
  const hatchTriggered = useRef(false);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearAllTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  }, []);
  useEffect(() => () => clearAllTimeouts(), [clearAllTimeouts]);

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timeoutRefs.current = timeoutRefs.current.filter((t) => t !== id);
      fn();
    }, ms);
    timeoutRefs.current.push(id);
    return id;
  }, []);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const nameInputRef = useRef<HTMLInputElement>(null);
  const eggContainerRef = useRef<HTMLDivElement>(null);
  const entrancePlayed = useRef(false);
  const eggTagsRef = useRef<string[][] | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // ── Companion visuals ──
  const eggCompanion = useMemo(
    () => preview ? previewToPetsCompanion(preview) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview?.d],
  );

  // Baby companion (same visual data but stage=baby)
  const babyCompanion = useMemo((): PetsCompanion | null => {
    if (!eggCompanion) return null;
    return { ...eggCompanion, stage: 'baby', state: 'active' as const, progressionState: 'evolving' as const };
  }, [eggCompanion]);

  const eggColor = preview?.visualTraits.baseColor ?? '#f59e0b';

  // Derive reveal background from baby's base color
  const revealBg = useMemo(() => buildRevealGradient(eggColor), [eggColor]);

  // ── Typewriter for current dialog line ──
  const currentDialogText = phase === 'dialog' ? (BIRTH_DIALOG[dialogLineIndex] ?? '') : '';
  const dialogTypewriter = useTypewriter(currentDialogText, dialogActive);

  const namingTypewriter = useTypewriter(NAMING_DIALOG, namingVisible);

  // ── Fast-path setup for existing eggs (no publishing needed) ──
  useEffect(() => {
    if (!isExistingEgg || setupAttempted.current || !existingCompanion) return;
    setupAttempted.current = true;

    // Build a minimal preview from the existing companion
    const fakePreview: PetsEggPreview = {
      d: existingCompanion.d,
      petId: existingCompanion.d,
      ownerPubkey: user?.pubkey ?? '',
      name: existingCompanion.name,
      stage: 'egg',
      state: 'active' as const,
      progressionState: (existingCompanion.progressionState === 'incubating' ? 'incubating' : 'none') as 'incubating' | 'none',
      seed: existingCompanion.seed ?? '',
      stats: {
        hunger: existingCompanion.stats.hunger ?? STAT_MAX,
        happiness: existingCompanion.stats.happiness ?? STAT_MAX,
        health: existingCompanion.stats.health ?? STAT_MAX,
        hygiene: existingCompanion.stats.hygiene ?? STAT_MAX,
        energy: existingCompanion.stats.energy ?? STAT_MAX,
      },
      visualTraits: existingCompanion.visualTraits,
      createdAt: Math.floor(Date.now() / 1000),
    };
    setPreview(fakePreview);
    previewRef.current = fakePreview;
    eggTagsRef.current = existingCompanion.allTags;

    setPhase('egg');
    scheduleTimeout(() => setEggVisible(true), 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExistingEgg, existingCompanion?.d]);

  // ── Silent setup: create profile + egg (new egg flow only) ──
  useEffect(() => {
    if (isExistingEgg) return; // Skip for existing eggs
    // Wait for the breed category to be supplied before minting. This prevents
    // a race where the component mounts before the picker state has propagated
    // and creates a random uncategorized egg.
    if (!breedCategory) return;
    // On retry, reset the attempt guard so setup can run again.
    if (retryCount > 0) {
      setupAttempted.current = false;
      if (user?.pubkey) setupInFlightFor.delete(user.pubkey);
    }
    if (setupAttempted.current || !user?.pubkey) return;
    // Module-level guard: if another mount already started setup for this pubkey, skip
    if (setupInFlightFor.has(user.pubkey)) return;
    setupAttempted.current = true;
    setupInFlightFor.add(user.pubkey);

    const setup = async () => {
      // Mark that the async work has begun — cleanup must NOT release the
      // module-level guard once this point is reached, because setup() will
      // release it in its own finally block when the work completes.
      setupStarted.current = true;

      try {
        // Re-read the latest profile from the ref before deciding whether to
        // create one. The prop may have resolved while the initial timeout was
        // pending.
        const startingProfile = profileRef.current;

        // 1. Create profile if needed
        if (!startingProfile && !profileRef.current) {
          const suggestedName =
            authorData?.metadata?.name ||
            authorData?.metadata?.display_name ||
            'NOSTR Pet';

          const baseTags = buildNostrPetProfileTags(user.pubkey);
          const tagsWithName = [
            ...baseTags,
            ['name', suggestedName],
            ['sats', INITIAL_NOSTR_PET_SATS.toString()],
          ];

          const profileEvent = await publishEvent({
            kind: KIND_NOSTR_PET_PROFILE,
            content: '',
            tags: tagsWithName,
          });
          if (!mountedRef.current) return;

          updateProfileEvent(profileEvent);
          invalidateProfile();
        }

        // 2. Generate the egg preview. Nothing is published yet — in the
        //    preview phase the user keeps this egg (free) or pays to reroll;
        //    the egg event is only minted when they commit to hatching.
        const eggPreview = breedCategory
          ? generateEggPreviewForCategory(user.pubkey, breedCategory, 'Egg')
          : generateEggPreview(user.pubkey, 'Egg');
        setPreview(eggPreview);
        previewRef.current = eggPreview;
        if (!mountedRef.current) return;

        setPhase('preview');
      } catch (error) {
        console.error('[HatchingCeremony] Setup failed:', error);
        if (!mountedRef.current) return;
        toast({
          title: 'Something went wrong',
          description: 'Failed to set up your NOSTR PET. Please try again.',
          variant: 'destructive',
        });
        setPhase('error');
      } finally {
        // Clear module-level guard so future adoptions can create new eggs
        if (user?.pubkey) setupInFlightFor.delete(user.pubkey);
      }
    };

    const timer = scheduleTimeout(setup, 600);
    return () => {
      clearTimeout(timer);
      timeoutRefs.current = timeoutRefs.current.filter((t) => t !== timer);
      // Only release the module-level guard if setup() never started.
      // If setup() already began, it owns the guard and will release it
      // in its own finally block when the async work completes.
      if (!setupStarted.current && user?.pubkey) {
        setupInFlightFor.delete(user.pubkey);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.pubkey, breedCategory, retryCount]);

  useEffect(() => {
    if (profile) profileRef.current = profile;
  }, [profile]);

  // ── Preview phase: pay the reroll fee over the active rail ──
  // Both modes pay the 2140 treasury by Cashu nutzap — demo over the BAO
  // signet mint, mainnet over the user's real mint.
  const payRerollFee = useCallback(async (): Promise<boolean> => {
    if (!activeWallet) {
      toast({
        title: 'No wallet connected',
        description: 'Set up your pets wallet in the Wallet tab before rerolling.',
        variant: 'destructive',
      });
      return false;
    }
    const treasuryNpub = config.petsTreasuryNpub;
    if (!treasuryNpub) {
      toast({
        title: 'Reroll unavailable',
        description: 'No treasury is configured to receive reroll payments.',
        variant: 'destructive',
      });
      return false;
    }
    const result = await activeWallet.sendNutzap(
      PETS_PREVIEW_REROLL_SATS,
      treasuryNpub,
      activeWallet.mintUrl,
      { memo: 'Pets egg reroll' },
    );
    if (result.status === 'pending') {
      // The sats left the wallet but the nutzap event is queued for retry.
      // Honor the payment — do NOT make the user pay again.
      toast({
        title: 'Payment sent',
        description: 'The payment is being delivered — no need to pay again.',
      });
      return true;
    }
    if (result.status === 'unknown') {
      // The mint may have committed — honor nothing, but do NOT invite a
      // blind retry either: a second payment cannot be clawed back.
      toast({
        title: 'Payment outcome unknown',
        description: 'The mint may still have processed it. Check your wallet balance before paying again.',
        variant: 'destructive',
      });
      return false;
    }
    if (result.status !== 'sent') {
      toast({
        title: 'Payment failed',
        description: 'The reroll payment did not go through. Your egg was not changed.',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  }, [activeWallet, config.petsTreasuryNpub]);

  // ── Preview phase: pay and generate a fresh egg ──
  const handleReroll = useCallback(async () => {
    if (!user?.pubkey || isRerolling || isCommitting) return;
    setIsRerolling(true);
    try {
      const paid = await payRerollFee();
      if (!paid || !mountedRef.current) return;

      const fresh = breedCategory
        ? generateEggPreviewForCategory(user.pubkey, breedCategory, 'Egg')
        : generateEggPreview(user.pubkey, 'Egg');
      setPreview(fresh);
      previewRef.current = fresh;
      setRerollCount((c) => c + 1);
      impactLight();
    } finally {
      if (mountedRef.current) setIsRerolling(false);
    }
  }, [user?.pubkey, breedCategory, isRerolling, isCommitting, payRerollFee]);

  // ── Preview phase: commit — publish the egg, grant starter sats, link has[] ──
  const commitToHatch = useCallback(async () => {
    const eggPreview = previewRef.current;
    if (!user?.pubkey || !eggPreview || isCommitting || isRerolling) return;
    setIsCommitting(true);

    try {
      // 1. Fetch the current block height and publish the egg event with a
      //    birth_block tag. This makes hatching gates real instead of estimated.
      let birthBlockHeight: number | undefined;
      try {
        birthBlockHeight = await fetchBlockHeight(config.esploraApis, AbortSignal.timeout(15000));
      } catch (e) {
        console.warn('[HatchingCeremony] Failed to fetch birth block height:', e);
      }
      const eggTags = previewToEventTags(eggPreview, birthBlockHeight);
      eggTagsRef.current = eggTags;

      const eggEvent = await publishEvent({
        kind: KIND_PETS_STATE,
        content: 'A new NOSTR PET egg!',
        tags: eggTags,
        created_at: eggPreview.createdAt,
      });
      if (!mountedRef.current) return;

      updateCompanionEvent(eggEvent);

      // 2. Award starter sats for the new egg (best-effort, demo mode only).
      //    This claims BAO signet sats from the faucet into the BAO wallet.
      //    Mainnet mode has no starter grant — real sats are never free.
      //    Await it before writing the profile `has[]` tag so concurrent
      //    profile updates stay serialized.
      if (isBaoWalletMode && !starterGrantAttemptedFor.has(eggPreview.d)) {
        starterGrantAttemptedFor.add(eggPreview.d);
        try {
          // The grant is best-effort: a failure must never block hatching —
          // and neither may a hung call. The faucet fetch has no internal
          // timeout, so cap the wait here (a dead endpoint otherwise stalls
          // the commit for minutes on the kernel TCP timeout).
          await Promise.race([
            starterGrant.mutateAsync(BAO_PET_STARTER_GRANT_SATS),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Starter grant timed out')), 15_000),
            ),
          ]);
        } catch (grantError) {
          // Grant failure must never block hatching.
          console.warn('[HatchingCeremony] Starter grant failed:', grantError);
        }
      }
      if (!mountedRef.current) return;

      // 3. Update profile with has[] entry. Fetch fresh profile first because
      //    the starter grant (or a concurrent update) may have changed it.
      const profileBeforeHas = profileRef.current;
      const freshProfile = await fetchFreshNostrPetProfile(nostr, user.pubkey);
      if (!mountedRef.current) return;

      const baseProfile = freshProfile ?? profileBeforeHas;
      if (baseProfile) {
        const baseTags = baseProfile.allTags;
        const baseContent = baseProfile.event.content ?? '';
        const prevEvent = baseProfile.event;

        const existingHas = baseTags
          .filter(([k]) => k === 'has')
          .map(([, v]) => v);
        const newHas = [...existingHas, eggPreview.d];

        const updatedTags = updateNostrPetProfileTags(baseTags, {
          has: newHas,
        });

        const updatedProfileEvent = await publishEvent({
          kind: KIND_NOSTR_PET_PROFILE,
          content: baseContent,
          tags: updatedTags,
          prev: prevEvent,
        });
        if (!mountedRef.current) return;

        updateProfileEvent(updatedProfileEvent);
      }

      setStoredSelectedD(eggPreview.d);
      invalidateProfile();
      invalidateCompanion();

      // eggOnly (adoption) mode: the egg stays an egg — complete immediately
      // without entering the cracking ceremony.
      if (eggOnly) {
        setPhase('complete');
        onCompleteRef.current?.();
        return;
      }

      setPhase('egg');
      scheduleTimeout(() => setEggVisible(true), 200);
    } catch (error) {
      console.error('[HatchingCeremony] Commit failed:', error);
      if (!mountedRef.current) return;
      toast({
        title: 'Something went wrong',
        description: 'Failed to create your egg. Please try again.',
        variant: 'destructive',
      });
      setPhase('error');
    } finally {
      if (mountedRef.current) setIsCommitting(false);
    }
  }, [
    user?.pubkey,
    isCommitting,
    isRerolling,
    publishEvent,
    updateCompanionEvent,
    isBaoWalletMode,
    starterGrant,
    nostr,
    updateProfileEvent,
    setStoredSelectedD,
    invalidateProfile,
    invalidateCompanion,
    scheduleTimeout,
    eggOnly,
    config.esploraApis,
  ]);

  // eggOnly mode commits from the preview phase and completes there, so it
  // never reaches the egg phase — no auto-complete timer needed.

  // Play entrance animation once
  useEffect(() => {
    if (eggVisible && !entrancePlayed.current && eggContainerRef.current) {
      entrancePlayed.current = true;
      const el = eggContainerRef.current;
      el.classList.add('animate-egg-onboard-entrance');
      const onEnd = () => {
        el.classList.remove('animate-egg-onboard-entrance');
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd);
    }
  }, [eggVisible]);

  // ── Shake (DOM-only, no re-render) ──
  const triggerShake = useCallback((cls: string) => {
    const el = eggContainerRef.current;
    if (!el) return;
    el.classList.remove(
      'animate-egg-onboard-shake-light',
      'animate-egg-onboard-shake-medium',
      'animate-egg-onboard-shake-heavy',
    );
    void el.offsetWidth;
    el.classList.add(cls);
  }, []);

  // ── Execute the actual hatch: egg -> baby ──
  const executeHatch = useCallback(async () => {
    const tags = eggTagsRef.current;
    if (!tags) return;
    if (!user?.pubkey) return;

    const now = Math.floor(Date.now() / 1000);
    const nowStr = now.toString();

    // Build a synthetic event from the current egg tags so we can parse it into
    // a companion, apply decay, validate tags, and seed evolution missions the
    // same way the canonical usePetsHatch path does.
    const syntheticEggEvent: NostrEvent = {
      kind: KIND_PETS_STATE,
      pubkey: user.pubkey,
      created_at: now,
      id: '',
      sig: '',
      content: '',
      tags,
    };

    const eggCompanion = parsePetsEvent(syntheticEggEvent);
    const streakUpdates = eggCompanion ? getStreakTagUpdates(eggCompanion) ?? {} : {};

    // Hatching resets the baby to peak condition.
    const babyStats = {
      hunger: STAT_MAX,
      happiness: STAT_MAX,
      health: STAT_MAX,
      hygiene: STAT_MAX,
      energy: STAT_MAX,
    };

    const mergedTags = updatePetsTags(tags, {
      stage: 'baby',
      state: 'active',
      hunger: babyStats.hunger.toString(),
      happiness: babyStats.happiness.toString(),
      health: babyStats.health.toString(),
      hygiene: babyStats.hygiene.toString(),
      energy: babyStats.energy.toString(),
      ...streakUpdates,
      last_interaction: nowStr,
      last_decay_at: nowStr,
    });

    // Validate and clean up task tags from the egg stage.
    const repairResult = validateAndRepairPetsTags(mergedTags, tags, { cleanupTaskTags: true });
    if (repairResult.errors.length > 0) {
      console.error('[Hatch ceremony] Tag validation errors:', repairResult.errors);
      throw new Error(`Tag validation failed: ${repairResult.errors.join(', ')}`);
    }

    // Auto-start evolution for the newly hatched baby.
    const babyTags = updatePetsTags(repairResult.tags, {
      progression_state: 'evolving',
      progression_started_at: nowStr,
    });

    // Seed evolution missions into the 31124 content.
    const evolveMissions = createEvolveMissions();
    const content = serializeEvolutionContent(JSON.stringify({}), evolveMissions);

    const event = await publishEvent({
      kind: KIND_PETS_STATE,
      content,
      tags: babyTags,
    });

    eggTagsRef.current = babyTags;
    updateCompanionEvent(event);
    invalidateCompanion();

    if (user?.pubkey) {
      writeEvolutionToStorage(evolveMissions, user.pubkey, eggCompanion?.d ?? previewRef.current?.d ?? '');
      window.dispatchEvent(new CustomEvent('daily-missions-updated', { detail: { evolution: true, d: eggCompanion?.d } }));
    }
  }, [publishEvent, updateCompanionEvent, invalidateCompanion, user?.pubkey]);

  // ── Egg click ──
  const handleEggClick = useCallback(() => {
    if (phase === 'hatching') return;

    // Existing eggs that aren't old enough yet are blocked from cracking.
    // The waiting UI explains the Bitcoin-block delay and offers an exit.
    if (eggTooYoung) return;

    if (phase === 'egg') {
      triggerShake('animate-egg-onboard-shake-light');
      impactLight();
      setPhase('crack_1');
    } else if (phase === 'crack_1') {
      triggerShake('animate-egg-onboard-shake-medium');
      impactMedium();
      setPhase('crack_2');
    } else if (phase === 'crack_2') {
      triggerShake('animate-egg-onboard-shake-heavy');
      impactHeavy();
      setPhase('crack_3');
    } else if (phase === 'crack_3') {
      if (hatchTriggered.current) return;

      // Existing eggs must be old enough (~ one real Bitcoin block) before
      // they can hatch.
      if (eggTooYoung) {
        toast({
          title: 'Egg not ready',
          description: 'Wait until at least one Bitcoin block is mined (~10 min) before hatching.',
        });
        return;
      }

      hatchTriggered.current = true;

      // Final click -> hatch!
      notificationSuccess();
      setPhase('hatching');
      setShowFlash(true);

      // Fire the actual hatch mutation and only reveal on success.
      executeHatch()
        .then(() => {
          // After flash, reveal the baby
          scheduleTimeout(() => {
            setShowFlash(false);
            setShowRevealGlow(true);
            setPhase('reveal');

            // Fade in pets
            scheduleTimeout(() => setPetsVisible(true), 400);

            // After pets settles, start dialog
            scheduleTimeout(() => {
              setPhase('dialog');
              setDialogLineIndex(0);
              setDialogActive(true);
            }, 2200);
          }, 1400);
        })
        .catch((err) => {
          console.error('Hatch failed:', err);
          hatchTriggered.current = false;
          setShowFlash(false);
          setPhase('crack_3');
          toast({
            title: 'Hatching failed',
            description: err instanceof Error ? err.message : 'Could not hatch your pet. Please try again.',
            variant: 'destructive',
          });
        });
    }
  }, [phase, triggerShake, executeHatch, scheduleTimeout, eggTooYoung]);

  // ── Dialog click: complete line or advance ──
  const handleDialogClick = useCallback(() => {
    if (phase !== 'dialog') return;

    if (!dialogTypewriter.done) {
      // Complete the current line instantly
      dialogTypewriter.complete();
      return;
    }

    // Advance to next line
    const nextIndex = dialogLineIndex + 1;
    if (nextIndex < BIRTH_DIALOG.length) {
      setDialogActive(false);
      setDialogLineIndex(nextIndex);
      // Small pause before next line starts
      scheduleTimeout(() => setDialogActive(true), 150);
    } else {
      // All lines done -> naming
      setDialogActive(false);
      scheduleTimeout(() => {
        setPhase('naming');
        scheduleTimeout(() => {
          setNamingVisible(true);
          scheduleTimeout(() => nameInputRef.current?.focus(), 600);
        }, 200);
      }, 400);
    }
  }, [phase, dialogTypewriter, dialogLineIndex, scheduleTimeout]);

  // ── Complete ceremony ──
  const completeCeremony = useCallback(async (finalName: string) => {
    // Update egg/baby name if changed
    const currentTags = eggTagsRef.current;
    if (currentTags && finalName !== (previewRef.current?.name ?? 'Egg')) {
      const namedTags = updatePetsTags(currentTags, { name: finalName });
      const event = await publishEvent({
        kind: KIND_PETS_STATE,
        content: `${finalName} is a baby Pets.`,
        tags: namedTags,
      });
      if (!mountedRef.current) return;
      updateCompanionEvent(event);
    }

    // Mark onboarding done
    const currentProfile = profileRef.current;
    if (currentProfile && user?.pubkey) {
      const freshProfile = await fetchFreshNostrPetProfile(nostr, user.pubkey);
      if (!mountedRef.current) return;

      const baseEvent = freshProfile?.event ?? currentProfile.event;
      const updatedTags = updateNostrPetProfileTags(baseEvent.tags, {
        pets_onboarding_done: 'true',
      });
      const profileEvent = await publishEvent({
        kind: KIND_NOSTR_PET_PROFILE,
        content: baseEvent.content ?? '',
        tags: updatedTags,
        prev: baseEvent,
      });
      if (!mountedRef.current) return;
      updateProfileEvent(profileEvent);
    }

    invalidateProfile();
    invalidateCompanion();
  }, [nostr, user?.pubkey, publishEvent, updateCompanionEvent, updateProfileEvent, invalidateProfile, invalidateCompanion]);

  // ── Naming submit ──
  const handleNameSubmit = useCallback(async () => {
    if (isNaming || !name.trim()) return;
    setIsNaming(true);

    try {
      await completeCeremony(name.trim());
      setNamingVisible(false);
      // Fade to white, then complete
      scheduleTimeout(() => {
        setFadeOut(true);
        scheduleTimeout(() => {
          setPhase('complete');
          onComplete?.();
        }, 2200);
      }, 600);
    } catch (error) {
      console.error('[HatchingCeremony] Naming failed:', error);
      toast({
        title: 'Failed to save name',
        description: error instanceof Error ? error.message : 'Your NOSTR PET was created, but the name could not be saved. Please try again.',
        variant: 'destructive',
      });
      // Keep the naming UI open so the user can retry instead of silently
      // advancing to the complete phase and losing the chance to fix the name.
    } finally {
      setIsNaming(false);
    }
  }, [name, isNaming, completeCeremony, onComplete, scheduleTimeout]);

  // ── Tour visual state for EggGraphic crack rendering ──
  const tourVisualState = useMemo(() => {
    switch (phase) {
      case 'crack_1': return 'crack_stage_1' as const;
      case 'crack_2': return 'crack_stage_2' as const;
      case 'crack_3': return 'crack_stage_3' as const;
      case 'hatching': return 'opening' as const;
      default: return 'idle' as const;
    }
  }, [phase]);

  // ── Render ──

  const isEggPhase = phase === 'egg' || phase === 'crack_1' || phase === 'crack_2' || phase === 'crack_3';
  const isHatching = phase === 'hatching';
  const showBaby = phase === 'reveal' || phase === 'dialog' || phase === 'naming';

  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, #0a1a2a 0%, #081520 50%, #060f18 100%)' }}
      >
        <div
          className="absolute size-32 rounded-full opacity-20 animate-pulse"
          style={{ background: `radial-gradient(circle, ${eggColor}40 0%, transparent 70%)` }}
        />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6"
        style={{ background: 'radial-gradient(ellipse at center, #2a0a0a 0%, #150505 50%, #0a0202 100%)' }}
      >
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-white">Couldn’t hatch your PET</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Something went wrong while creating your egg. You can retry or come back later.
          </p>
        </div>
        <Button
          onClick={() => {
            setPhase('loading');
            setRetryCount((c) => c + 1);
          }}
        >
          Try Again
        </Button>
      </div>
    );
  }

  if (phase === 'preview') {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 overflow-hidden select-none"
        style={{ background: 'radial-gradient(ellipse at center, #0a1a2a 0%, #081520 50%, #060f18 100%)' }}
      >
        {onExit && (
          <button
            onClick={onExit}
            className="absolute top-4 left-4 z-50 flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="size-5" />
            Back
          </button>
        )}
        {/* Ambient glow behind the pet */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 45%, ${eggColor}25 0%, transparent 60%)`,
          }}
        />

        <div className="text-center space-y-1 relative">
          <h2 className="text-xl font-semibold text-white flex items-center justify-center gap-2">
            <Egg className="size-5" style={{ color: eggColor }} />
            Your egg is ready
          </h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            This is the NOSTR PET waiting inside. Keep it for free, or reroll for a new one.
          </p>
        </div>

        {eggCompanion && (
          <div className="relative">
            <div
              className="absolute -inset-10 rounded-full blur-2xl"
              style={{
                background: `radial-gradient(circle, ${eggColor}50 0%, transparent 70%)`,
              }}
            />
            <PetsStageVisual
              companion={eggCompanion}
              size="lg"
              animated
              onEggClick={commitToHatch}
              className="size-52 sm:size-60 relative"
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-3 relative w-full max-w-xs">
          <Button
            size="lg"
            className="w-full"
            disabled={isCommitting || isRerolling}
            onClick={commitToHatch}
          >
            {isCommitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating your egg…
              </>
            ) : (
              eggOnly ? 'Keep this egg — Free' : 'Hatch this egg — Free'
            )}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full border-white/50 bg-transparent hover:bg-white/10"
            style={{ color: 'white' }}
            disabled={isCommitting || isRerolling}
            onClick={handleReroll}
          >
            {isRerolling ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Rerolling…
              </>
            ) : (
              <>
                <Dices className="size-4" />
                Reroll — {PETS_PREVIEW_REROLL_SATS} sats
              </>
            )}
          </Button>
          {rerollCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Rerolled {rerollCount} {rerollCount === 1 ? 'time' : 'times'}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden select-none"
      style={{
        background: showBaby
          ? revealBg
          : 'radial-gradient(ellipse at center, #0a1a2a 0%, #081520 50%, #060f18 100%)',
        transition: 'background 2s ease-out',
      }}
      onClick={phase === 'dialog' ? handleDialogClick : undefined}
    >
      {onExit && isEggPhase && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExit();
          }}
          className="absolute top-4 left-4 z-50 flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
          Back
        </button>
      )}
      {/* ── Ambient background glow (egg phase only) ── */}
      {!showBaby && (
        <div
          className="absolute inset-0 transition-opacity"
          style={{
            transitionDuration: '3000ms',
            background: `radial-gradient(ellipse at 50% 50%, ${eggColor}30 0%, transparent 60%)`,
            opacity: (isEggPhase || isHatching) ? 0.07 : 0.05,
          }}
        />
      )}

      {/* ── Vignette shadow for reveal phase — adds depth so pets pops ── */}
      {showBaby && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.25) 100%)',
          }}
        />
      )}

      {/* ── Floating particles (egg phase) ── */}
      {isEggPhase && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                left: `${20 + (i * 12) % 60}%`,
                bottom: '40%',
                backgroundColor: `${eggColor}40`,
                animation: `onboard-particle-rise ${4 + i * 0.7}s ease-out ${i * 0.8}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* ── The Egg ── */}
      {(isEggPhase || isHatching) && eggCompanion && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={eggContainerRef}
            className={cn(
              'relative',
              !eggTooYoung && 'cursor-pointer',
              eggVisible ? '' : 'opacity-0',
              eggVisible && isEggPhase && 'animate-egg-onboard-breathe',
              isHatching && 'animate-egg-onboard-burst',
            )}
          >
            <div
              className="absolute -inset-12 rounded-full blur-2xl transition-opacity duration-1000"
              style={{
                background: `radial-gradient(circle, ${eggColor}50 0%, transparent 70%)`,
                opacity: phase === 'crack_3' ? 0.5 : phase === 'crack_2' ? 0.35 : phase === 'crack_1' ? 0.25 : 0.15,
              }}
            />
            <PetsStageVisual
              companion={eggCompanion}
              size="lg"
              animated
              className="size-56 sm:size-64 md:size-72"
              tourVisualState={tourVisualState}
              onEggClick={eggTooYoung ? undefined : handleEggClick}
            />
          </div>
        </div>
      )}

      {/* ── Waiting overlay for eggs that are not old enough yet ── */}
      {eggTooYoung && isEggPhase && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8 z-50">
          <div className="relative max-w-md w-full text-center p-6 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md">
            <h3 className="text-lg font-semibold text-white mb-2">Egg not ready</h3>
            <p className="text-sm text-white/70 mb-4">
              Wait until at least one Bitcoin block is mined (~10 min) before hatching.
            </p>
            {onExit && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onExit();
                }}
                variant="outline"
                className="border-white/30 text-white bg-white/10 hover:bg-white/20 hover:text-white"
              >
                Back to pet
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Screen flash ── */}
      {showFlash && (
        <div
          className="absolute inset-0 bg-white animate-onboard-screen-flash pointer-events-none"
          style={{ zIndex: 80 }}
        />
      )}

      {/* ── Hatched baby pets with golden incandescence ── */}
      {showBaby && babyCompanion && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ paddingBottom: '18%' }}
        >
          {/* Rotating golden incandescence */}
          <div className={cn(
            'absolute animate-onboard-golden-fadein',
            petsVisible ? '' : 'opacity-0',
          )}>
            <div
              className="animate-onboard-golden-rotate"
              style={{
                width: 900,
                height: 900,
                background: `conic-gradient(
                  from 0deg,
                  rgba(255, 250, 230, 0.18) 0deg,
                  rgba(255, 245, 210, 0.50) 50deg,
                  rgba(255, 250, 235, 0.22) 100deg,
                  rgba(255, 248, 220, 0.15) 150deg,
                  rgba(255, 245, 210, 0.48) 210deg,
                  rgba(255, 250, 230, 0.20) 270deg,
                  rgba(255, 248, 220, 0.15) 320deg,
                  rgba(255, 250, 230, 0.18) 360deg
                )`,
                borderRadius: '50%',
                filter: 'blur(30px)',
              }}
            />
          </div>

          {/* Bright white-gold shine directly behind pets */}
          <div
            className={cn(
              'absolute rounded-full transition-opacity duration-1000',
              petsVisible ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              width: 320,
              height: 320,
              background: 'radial-gradient(circle, rgba(255,255,245,0.70) 0%, rgba(255,250,225,0.30) 40%, transparent 70%)',
            }}
          />

          {/* Wider golden halo */}
          <div
            className={cn(
              'absolute rounded-full transition-opacity [transition-duration:2000ms]',
              petsVisible ? 'opacity-100' : 'opacity-0',
            )}
            style={{
              width: 700,
              height: 700,
              background: 'radial-gradient(circle, rgba(255, 248, 210, 0.40) 0%, rgba(255, 240, 190, 0.18) 40%, transparent 65%)',
              filter: 'blur(15px)',
            }}
          />

          {/* ── Sparkles everywhere ── */}

          {/* Inner ring - bright twinkling sparkles */}
          {Array.from({ length: 20 }).map((_, i) => {
            const angle = (i / 20) * Math.PI * 2;
            const r = 80 + (i % 4) * 35;
            const size = 4 + (i % 3) * 3;
            return (
              <div
                key={`inner-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * r}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * r}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background: i % 2 === 0
                    ? 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 40%, transparent 70%)'
                    : 'radial-gradient(circle, rgba(255,240,130,1) 0%, rgba(255,220,80,0.3) 50%, transparent 70%)',
                  animation: `onboard-sparkle-twinkle ${1.5 + (i % 6) * 0.5}s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            );
          })}

          {/* Outer ring - larger, slower sparkles */}
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i / 16) * Math.PI * 2 + 0.3;
            const r = 170 + (i % 3) * 50;
            const size = 5 + (i % 4) * 3;
            return (
              <div
                key={`outer-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `calc(50% + ${Math.cos(angle) * r}px - ${size / 2}px)`,
                  top: `calc(50% + ${Math.sin(angle) * r}px - ${size / 2}px)`,
                  borderRadius: '50%',
                  background: i % 3 === 0
                    ? 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 60%)'
                    : 'radial-gradient(circle, rgba(255,235,120,0.85) 0%, transparent 60%)',
                  animation: `onboard-sparkle-twinkle ${2.5 + (i % 5) * 0.7}s ease-in-out ${i * 0.25}s infinite`,
                }}
              />
            );
          })}

          {/* Scattered wide-field sparkles */}
          {Array.from({ length: 24 }).map((_, i) => {
            const x = (Math.sin(i * 2.7 + 1.3) * 0.5 + 0.5) * 80 + 10;
            const y = (Math.cos(i * 3.1 + 0.7) * 0.5 + 0.5) * 70 + 10;
            const size = 3 + (i % 3) * 2;
            return (
              <div
                key={`field-${i}`}
                className="absolute"
                style={{
                  width: size,
                  height: size,
                  left: `${x}%`,
                  top: `${y}%`,
                  borderRadius: '50%',
                  background: i % 4 === 0
                    ? 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, transparent 70%)'
                    : 'radial-gradient(circle, rgba(255,240,160,0.8) 0%, transparent 70%)',
                  animation: `onboard-sparkle-twinkle ${2 + (i % 7) * 0.6}s ease-in-out ${i * 0.18}s infinite`,
                }}
              />
            );
          })}

          {/* Drifting light motes rising from below */}
          {Array.from({ length: 10 }).map((_, i) => {
            const x = (Math.sin(i * 1.9) * 0.5 + 0.5) * 70 + 15;
            return (
              <div
                key={`drift-${i}`}
                className="absolute"
                style={{
                  width: 5 + (i % 3) * 3,
                  height: 5 + (i % 3) * 3,
                  left: `${x}%`,
                  bottom: '20%',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(255,250,200,0.9) 0%, rgba(255,230,120,0.3) 50%, transparent 100%)',
                  animation: `onboard-sparkle-drift ${4 + i * 0.5}s ease-out ${i * 0.5}s infinite`,
                }}
              />
            );
          })}

          {/* The baby pets */}
          <div className={cn(
            'relative transition-opacity duration-1000',
            petsVisible ? 'opacity-100' : 'opacity-0',
          )}>
            <PetsStageVisual
              companion={babyCompanion}
              size="lg"
              animated
              className="size-[30rem] sm:size-[36rem] md:size-[44rem]"
            />
          </div>
        </div>
      )}

      {/* ── Dialog text (no box, blur behind) ── */}
      {phase === 'dialog' && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8">
          <div className="relative max-w-md w-full text-center">
            {/* Soft feathered backdrop with shadow */}
            <div
              className="absolute -inset-32"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(0,30,50,0.40) 0%, rgba(0,30,50,0.18) 35%, transparent 65%)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                mask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
                WebkitMask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
              }}
            />

            {/* Speaker */}
            <div className="relative">
              <p className="text-[11px] text-white/50 tracking-[0.2em] uppercase mb-3">
                ???
              </p>

              {/* Typewriter text */}
              <p className="text-base sm:text-lg text-white leading-relaxed font-light min-h-[3em]">
                {dialogTypewriter.displayed}
                {!dialogTypewriter.done && (
                  <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
                )}
              </p>

              {/* Advance indicator */}
              {dialogTypewriter.done && (
                <div className="mt-4 animate-onboard-continue-pulse">
                  <span className="text-xs text-white/30">&#9660;</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Naming ── */}
      {phase === 'naming' && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-28 sm:pb-36 px-8">
          <div className={cn(
            'relative max-w-md w-full text-center',
            namingVisible ? 'animate-onboard-soft-fade-in' : 'opacity-0',
          )}>
            {/* Soft feathered backdrop with shadow */}
            <div
              className="absolute -inset-32"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(0,30,50,0.40) 0%, rgba(0,30,50,0.18) 35%, transparent 65%)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                mask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
                WebkitMask: 'radial-gradient(ellipse at center, black 25%, transparent 65%)',
              }}
            />

            <div className="relative">
              {/* Speaker */}
              <p className="text-[11px] text-white/50 tracking-[0.2em] uppercase mb-3">
                ???
              </p>

              {/* Typewriter question */}
              <p className="text-base sm:text-lg text-white/85 leading-relaxed font-light mb-6 min-h-[1.5em] whitespace-pre-line">
                {namingTypewriter.displayed}
                {!namingTypewriter.done && (
                  <span className="inline-block w-[2px] h-[1em] bg-white/50 ml-0.5 animate-pulse align-text-bottom" />
                )}
              </p>

              {/* Input + confirm (appear after typewriter done) */}
              {namingTypewriter.done && (
                <div className="space-y-3 animate-onboard-soft-fade-in">
                  <Input
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="..."
                    maxLength={32}
                    autoFocus
                    className={cn(
                      'text-center text-lg font-light h-12',
                      'bg-white/10 border-transparent text-white placeholder:text-white/30',
                      'focus:bg-white/[0.25] focus:border-transparent focus:ring-0 focus:outline-none',
                      'focus-visible:ring-0 focus-visible:ring-offset-0',
                      'focus:shadow-[0_0_15px_rgba(255,255,255,0.15),0_0_40px_rgba(255,250,230,0.08)]',
                      'transition-all duration-300',
                      'rounded-full transition-shadow duration-500',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && name.trim()) handleNameSubmit();
                    }}
                  />

                  {name.trim() && (
                    <Button
                      onClick={handleNameSubmit}
                      disabled={isNaming}
                      className={cn(
                        'max-w-[12rem] mx-auto h-10 px-8 text-sm font-light tracking-wide',
                        'bg-white/15 hover:bg-white/22 text-white/80 border-transparent',
                        'rounded-full transition-all duration-300',
                        'focus-visible:ring-0 focus-visible:ring-offset-0',
                      )}
                      variant="ghost"
                    >
                      That&apos;s the one.
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Fade to white on completion ── */}
      {fadeOut && (
        <div
          className="absolute inset-0 bg-white pointer-events-none"
          style={{
            zIndex: 90,
            animation: 'pets-fade-to-white 2s ease-in forwards',
          }}
        />
      )}
    </div>
  );
}
