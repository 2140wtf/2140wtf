/**
 * usePetsOnboarding - Hook to manage Pets onboarding flow
 * 
 * This hook orchestrates the entire onboarding process:
 * 1. Auto profile creation (using kind 0 name, no user input needed)
 * 2. Adoption question (if profile exists but no pets)
 * 3. Egg preview with reroll/adopt
 * 
 * CRITICAL: The initial step is derived from the profile state, not hardcoded.
 * This ensures correct behavior on page refresh.
 * 
 * Profile creation is automatic - when the user enters Pets for the first time,
 * the profile is created using their kind 0 display_name/name, falling back to
 * "NOSTR Pet" if no name is available. This eliminates the need for a manual
 * name entry step.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthor } from '@/hooks/useAuthor';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';

import { updateNostrPetProfile } from '@/pets/core/lib/profile-sats';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

import {
  KIND_PETS_STATE,
  KIND_NOSTR_PET_PROFILE,
  INITIAL_NOSTR_PET_SATS,
  PETS_PREVIEW_REROLL_SATS,
  PETS_ADOPTION_SATS,
  buildNostrPetProfileTags,
  updateNostrPetProfileTags,
  type NostrPetProfile,
} from '@/pets/core/lib/pets';

import {
  generateEggPreview,
  updatePreviewName,
  previewToEventTags,
  type PetsEggPreview,
} from '../lib/pets-preview';

// ─── Types ────────────────────────────────────────────────────────────────────

/** 
 * Onboarding steps:
 * - 'creating-profile': Auto-creating profile (no user input needed)
 * - 'adoption-question': Ask if user wants to adopt a NOSTR PET
 * - 'preview': Show egg preview with reroll/adopt options
 */
export type OnboardingStep = 'creating-profile' | 'adoption-question' | 'preview';

export interface OnboardingState {
  /** Current step in the onboarding flow */
  step: OnboardingStep;
  /** Whether an action is in progress */
  isProcessing: boolean;
  /** Which specific action is processing */
  actionInProgress: 'create-profile' | 'reroll' | 'adopt' | null;
  /** Current preview (null until preview step) */
  preview: PetsEggPreview | null;
  /** Whether the current preview is the first (free) one */
  isFirstPreview: boolean;
  /** Temporary demo sats for preview phase (before profile exists) */
  previewSats: number;
  /** Name set during profile creation (for adoption step display) */
  nostrPetName: string | undefined;
}

export interface OnboardingActions {
  /** Start the adoption preview flow */
  startAdoptionPreview: () => void;
  /** Generate a new preview (reroll) */
  rerollPreview: () => Promise<void>;
  /** Update the name in the current preview */
  setPreviewName: (name: string) => void;
  /** Adopt the current preview */
  adoptPreview: () => Promise<void>;
}

export interface UsePetsOnboardingResult {
  /** Current onboarding state */
  state: OnboardingState;
  /** Actions to control onboarding */
  actions: OnboardingActions;
  /** Suggested name from kind 0 metadata */
  suggestedName: string | undefined;
  /** Current demo-sat balance (from profile or preview state) */
  sats: number;
}

// ─── Helper: Derive Initial Step ──────────────────────────────────────────────

/**
 * Derive the correct initial onboarding step based on profile state and mode.
 * 
 * Normal mode:
 * - No profile → 'creating-profile' (auto-create using kind 0 name)
 * - Profile exists, no pets → 'adoption-question'
 * - Profile exists with pets → should not be in onboarding at all
 * 
 * Adoption-only mode (for "Adopt another NOSTR PET"):
 * - Profile must exist → 'preview' (skip straight to egg preview)
 * - No profile → error case, should not happen
 */
function deriveInitialStep(
  profile: NostrPetProfile | null, 
  adoptionOnly: boolean
): OnboardingStep {
  // Adoption-only mode: skip to preview if profile exists
  if (adoptionOnly && profile) {
    return 'preview';
  }
  
  if (!profile) {
    return 'creating-profile';
  }
  
  // Profile exists but no pets (normal onboarding)
  return 'adoption-question';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UsePetsOnboardingOptions {
  /** Current profile (null if doesn't exist) */
  profile: NostrPetProfile | null;
  /** Called to update profile event in cache after publishing */
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void;
  /** Called to update companion event in cache after publishing */
  updateCompanionEvent: (event: import('@nostrify/nostrify').NostrEvent) => void;
  /** Called to invalidate profile query */
  invalidateProfile: () => void;
  /** Called to invalidate companion query */
  invalidateCompanion: () => void;
  /** Called to update localStorage selection */
  setStoredSelectedD: (d: string) => void;
  /** Called when onboarding is complete */
  onComplete?: () => void;
  /** 
   * If true, skip profile creation and adoption question, go directly to preview.
   * Use this for "Adopt another NOSTR PET" flow for existing users.
   * Requires profile to be non-null.
   */
  adoptionOnly?: boolean;
  /** External Cashu wallet, required when profile.walletMode is 'btc-sats'. */
  externalWallet?: (CashuWalletState & CashuWalletActions) | null;
}

export function usePetsOnboarding({
  profile,
  updateProfileEvent,
  updateCompanionEvent,
  invalidateProfile,
  invalidateCompanion,
  setStoredSelectedD,
  onComplete,
  adoptionOnly = false,
  externalWallet,
}: UsePetsOnboardingOptions): UsePetsOnboardingResult {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  // Real-sats payments (reroll/adoption) go to the 2140 treasury as nutzaps.
  const payTreasury = useCallback(
    async (amount: number, memo: string) => {
      const treasuryNpub = config.petsTreasuryNpub;
      if (!treasuryNpub) throw new Error('Pets treasury is not configured.');
      if (!externalWallet?.mintUrl) {
        throw new Error('Select a mint in your Cashu wallet before paying with sats.');
      }
      const result = await externalWallet.sendNutzap(amount, treasuryNpub, externalWallet.mintUrl, { memo });
      // 'sent' or 'pending' both mean the sats are gone (pending auto-retries);
      // only 'failed' means nothing was committed and the caller may retry.
      if (result.status === 'failed') throw new Error(externalWallet.error ?? 'Payment to the Pets treasury failed.');
      // 'unknown' means the mint may have committed: do not grant the purchase
      // but do not invite a blind retry either.
      if (result.status === 'unknown') {
        throw new Error('The payment outcome is unknown — the mint may still have processed it. Check your Cashu wallet balance before paying again; if it decreased, do NOT pay again and contact support.');
      }
    },
    [config.petsTreasuryNpub, externalWallet],
  );
  
  // Get kind 0 metadata for name suggestion
  const { data: authorData } = useAuthor(user?.pubkey);
  
  // Suggested name from kind 0: display_name > name > undefined
  const suggestedName = useMemo(() => {
    if (!authorData?.metadata) return undefined;
    return authorData.metadata.name || authorData.metadata.display_name || undefined;
  }, [authorData?.metadata]);
  
  // ─── State ────────────────────────────────────────────────────────────────────
  
  // Derive initial step from profile and adoptionOnly mode
  const initialStep = deriveInitialStep(profile, adoptionOnly);
  
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<'create-profile' | 'reroll' | 'adopt' | null>(null);
  
  // For adoption-only mode, generate preview immediately
  const [preview, setPreview] = useState<PetsEggPreview | null>(() => {
    if (adoptionOnly && profile && user?.pubkey) {
      // Generate initial preview for adoption-only mode
      return generateEggPreview(user.pubkey, 'Egg');
    }
    return null;
  });
  const [isFirstPreview, setIsFirstPreview] = useState(true);
  const [previewSats] = useState(INITIAL_NOSTR_PET_SATS);
  const [nostrPetName, setNostrPetName] = useState<string | undefined>(profile?.name);
  
  // ─── Sync step with profile changes ─────────────────────────────────────────
  // Ensure step is ALWAYS correct based on profile state.
  // This handles all cases: initial mount, cache load, relay fetch, profile creation.
  // NOTE: In adoptionOnly mode, we don't auto-transition based on profile state changes.
  useEffect(() => {
    // Skip sync logic in adoptionOnly mode - step is explicitly controlled
    if (adoptionOnly) {
      console.log('[usePetsOnboarding] adoptionOnly mode - skipping auto-sync');
      return;
    }
    
    const correctStep = deriveInitialStep(profile, false);
    
    // Debug log
    console.log('[usePetsOnboarding] State sync check:', {
      hasProfile: !!profile,
      profileName: profile?.name,
      profileHasLength: profile?.has?.length ?? 0,
      currentStep: step,
      derivedStep: correctStep,
    });
    
    // Case 1: Step is 'creating-profile' but profile exists → move to 'adoption-question'
    // This handles profile loading from cache/relay after initial render
    if (step === 'creating-profile' && profile) {
      console.log('[usePetsOnboarding] Profile loaded, moving to adoption-question');
      setStep('adoption-question');
      setNostrPetName(profile.name);
      return;
    }
    
    // Case 2: Step is 'adoption-question' but no profile → move back to 'creating-profile'
    // This handles edge cases where profile becomes null (shouldn't happen normally)
    if (step === 'adoption-question' && !profile) {
      console.log('[usePetsOnboarding] Profile lost, moving back to creating-profile');
      setStep('creating-profile');
      setNostrPetName(undefined);
      return;
    }
    
    // Case 3: Step is 'preview' but no profile → move back to 'creating-profile'
    // User somehow got to preview without a profile (shouldn't happen)
    if (step === 'preview' && !profile) {
      console.log('[usePetsOnboarding] No profile in preview step, moving back to creating-profile');
      setStep('creating-profile');
      setPreview(null);
      setNostrPetName(undefined);
      return;
    }
  }, [profile, step, adoptionOnly]);
  
  // ─── Derived State ──────────────────────────────────────────────────────────
  
  // Demo sats: from profile if exists, otherwise from preview state
  const sats = profile?.sats ?? previewSats;
  
  // ─── Auto Profile Creation ────────────────────────────────────────────────────
  
  // Track if we've already attempted to create profile (to avoid duplicates)
  const profileCreationAttempted = useRef(false);
  
  /**
   * Auto-create profile when step is 'creating-profile'.
   * Uses the user's kind 0 name, falling back to "NOSTR Pet" if not available.
   */
  useEffect(() => {
    // Only run when step is 'creating-profile'
    if (step !== 'creating-profile') {
      profileCreationAttempted.current = false; // Reset when leaving this step
      return;
    }
    
    // Skip if already attempting or no user
    if (profileCreationAttempted.current || !user?.pubkey) return;
    
    // Skip if profile already exists (loading from cache/relay)
    if (profile) return;
    
    // Skip if already processing
    if (isProcessing) return;
    
    // Mark as attempted to prevent duplicate calls
    profileCreationAttempted.current = true;
    
    // Determine the name to use: kind 0 name or fallback
    const name = suggestedName || 'NOSTR Pet';
    
    console.log('[usePetsOnboarding] Auto-creating profile with name:', name);
    
    const createProfileAsync = async () => {
      setIsProcessing(true);
      setActionInProgress('create-profile');
      
      try {
        // Build tags with name and initial demo sats
        const baseTags = buildNostrPetProfileTags(user.pubkey);
        const tagsWithName = [
          ...baseTags,
          ['name', name],
          ['sats', INITIAL_NOSTR_PET_SATS.toString()],
        ];
        
        const event = await publishEvent({
          kind: KIND_NOSTR_PET_PROFILE,
          content: '',
          tags: tagsWithName,
        });
        
        updateProfileEvent(event);
        setNostrPetName(name);
        invalidateProfile();
        
        toast({
          title: 'Welcome to NOSTR PETS!',
          description: `Your profile has been created, ${name}!`,
        });
        
        // Move to adoption question step
        setStep('adoption-question');
      } catch (error) {
        console.error('Failed to create profile:', error);
        toast({
          title: 'Failed to create profile',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
        // Reset so user can retry
        profileCreationAttempted.current = false;
      } finally {
        setIsProcessing(false);
        setActionInProgress(null);
      }
    };
    
    createProfileAsync();
  }, [step, user?.pubkey, profile, isProcessing, suggestedName, publishEvent, updateProfileEvent, invalidateProfile]);
  
  // ─── Actions ──────────────────────────────────────────────────────────────────
  
  /**
   * Start the adoption preview flow
   */
  const startAdoptionPreview = useCallback(() => {
    if (!user?.pubkey) return;
    
    // Generate first free preview with a default name
    const newPreview = generateEggPreview(user.pubkey, 'Egg');
    setPreview(newPreview);
    setIsFirstPreview(true);
    setStep('preview');
  }, [user?.pubkey]);
  
  /**
   * Update the name in the current preview
   */
  const setPreviewName = useCallback((name: string) => {
    if (!preview) return;
    setPreview(updatePreviewName(preview, name));
  }, [preview]);
  
  /**
   * Generate a new preview (reroll) - costs demo sats in BAO signet mode, real sats in Cashu mode
   */
  const rerollPreview = useCallback(async () => {
    if (!user?.pubkey || !profile) return;

    const isCashuMode = profile.walletMode === 'cashu';
    const rerollCostSats = PETS_PREVIEW_REROLL_SATS;

    // Check if can afford
    if (!isCashuMode && sats < rerollCostSats) {
      toast({
        title: 'Not enough demo sats',
        description: `You need ${rerollCostSats.toLocaleString()} demo sats to try another.`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    setActionInProgress('reroll');

    try {
      if (isCashuMode) {
        // Pay with real sats; no profile sats update needed for a reroll.
        // Skip the wallet call when the reroll cost is zero to avoid the
        // external payment hook rejecting non-positive amounts.
        if (rerollCostSats > 0) {
          await payTreasury(rerollCostSats, 'Pets reroll');
        }
      } else {
        // Deduct demo sats through the serialized profile updater so concurrent
        // actions cannot overwrite each other.
        const updateResult = await updateNostrPetProfile(
          nostr,
          publishEvent,
          user.pubkey,
          (freshProfile) => {
            if (!freshProfile) {
              throw new Error('Profile not found on relays');
            }
            if (freshProfile.sats < rerollCostSats) {
              throw new Error(
                `Not enough demo sats. You need ${rerollCostSats.toLocaleString()} but have ${freshProfile.sats.toLocaleString()}.`
              );
            }
            const newSats = freshProfile.sats - rerollCostSats;
            return {
              tags: updateNostrPetProfileTags(freshProfile.event.tags, {
                sats: newSats.toString(),
              }),
              content: freshProfile.event.content,
              meta: { newSats },
            };
          }
        );

        if (updateResult?.event) {
          updateProfileEvent(updateResult.event);
        }
      }
      
      // Preserve the current name when rerolling
      const currentName = preview?.name ?? 'Egg';
      
      // Debug: log previous preview identity
      console.log('[Reroll] Previous preview:', {
        d: preview?.d,
        seed: preview?.seed?.slice(0, 16) + '...',
        petId: preview?.petId,
      });
      
      // Then generate new preview with the same name
      const newPreview = generateEggPreview(user.pubkey, currentName);
      
      // Debug: log new preview identity
      console.log('[Reroll] New preview:', {
        d: newPreview.d,
        seed: newPreview.seed.slice(0, 16) + '...',
        petId: newPreview.petId,
        visualTraits: {
          baseColor: newPreview.visualTraits.baseColor,
          pattern: newPreview.visualTraits.pattern,
        },
      });
      
      setPreview(newPreview);
      setIsFirstPreview(false);
      
      invalidateProfile();
    } catch (error) {
      console.error('Failed to reroll preview:', error);
      toast({
        title: 'Failed to generate preview',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
      setActionInProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- preview identity (d/seed/petId) only used for debug logs
  }, [user?.pubkey, nostr, profile, sats, preview?.name, publishEvent, updateProfileEvent, invalidateProfile, payTreasury]);
  
  /**
   * Adopt the current preview - costs demo sats in BAO signet mode, real sats in Cashu mode
   */
  const adoptPreview = useCallback(async () => {
    if (!user?.pubkey || !profile || !preview) return;

    const isCashuMode = profile.walletMode === 'cashu';
    const adoptionCostSats = PETS_ADOPTION_SATS;

    // Check if can afford
    if (!isCashuMode && sats < adoptionCostSats) {
      toast({
        title: 'Not enough demo sats',
        description: `You need ${adoptionCostSats.toLocaleString()} demo sats to adopt.`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    setActionInProgress('adopt');

    try {
      if (isCashuMode && adoptionCostSats > 0) {
        // Pay adoption cost with real sats before creating the pet.
        await payTreasury(adoptionCostSats, 'Pets adoption');
      }

      // 1. Publish the Pets egg event using exact preview data
      const eggTags = previewToEventTags(preview);

      const eggEvent = await publishEvent({
        kind: KIND_PETS_STATE,
        content: 'A new NOSTR PET egg!',
        tags: eggTags,
        created_at: preview.createdAt,
      });

      updateCompanionEvent(eggEvent);

      // 2. Update profile: add to has list (and deduct demo sats in demo-sats mode)
      // through the serialized updater so concurrent changes are not lost.
      // NOTE: We do NOT set current_companion here because the adopted Pets
      // is still an egg. The companion mechanic only becomes available after hatching.
      // Eggs should never be auto-assigned as the floating companion.
      // NOTE: pets_onboarding_done is NOT set here — adoption alone does not
      // complete onboarding. It is set when the first-hatch tour finishes.
      const profileUpdateResult = await updateNostrPetProfile(
        nostr,
        publishEvent,
        user.pubkey,
        (freshProfile) => {
          if (!freshProfile) {
            throw new Error('Profile not found on relays');
          }

          const newHas = [...(freshProfile.has ?? []), preview.d];
          const updates: Record<string, string | string[]> = {
            has: newHas,
          };

          if (!isCashuMode) {
            if (freshProfile.sats < adoptionCostSats) {
              throw new Error(
                `Not enough demo sats. You need ${adoptionCostSats.toLocaleString()} but have ${freshProfile.sats.toLocaleString()}.`
              );
            }
            updates.sats = (freshProfile.sats - adoptionCostSats).toString();
          }

          return {
            tags: updateNostrPetProfileTags(freshProfile.event.tags, updates),
            content: freshProfile.event.content,
            meta: { newHas },
          };
        }
      );

      if (profileUpdateResult?.event) {
        updateProfileEvent(profileUpdateResult.event);
      }

      // 3. Set localStorage selection to the new Pets
      setStoredSelectedD(preview.d);

      // 4. Invalidate queries
      invalidateProfile();
      invalidateCompanion();

      toast({
        title: 'Congratulations!',
        description: `You adopted ${preview.name}!`,
      });

      // 5. Complete onboarding
      onComplete?.();
    } catch (error) {
      console.error('Failed to adopt Pets:', error);
      toast({
        title: 'Failed to adopt',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
      setActionInProgress(null);
    }
  }, [user?.pubkey, nostr, profile, preview, sats, publishEvent, updateCompanionEvent, updateProfileEvent, setStoredSelectedD, invalidateProfile, invalidateCompanion, onComplete, payTreasury]);
  
  // ─── Return ─────────────────────────────────────────────────────────────────
  
  return {
    state: {
      step,
      isProcessing,
      actionInProgress,
      preview,
      isFirstPreview,
      previewSats,
      nostrPetName,
    },
    actions: {
      startAdoptionPreview,
      rerollPreview,
      setPreviewName,
      adoptPreview,
    },
    suggestedName,
    sats,
  };
}
