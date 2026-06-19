/**
 * Pets Onboarding Module
 *
 * Every new egg goes through the immersive hatching ceremony:
 * dark screen, huge egg, click-to-hatch, sentimental birth reveal, naming.
 */

// Components
export { PetsOnboardingFlow } from './components/PetsOnboardingFlow';
export { PetsHatchingCeremony } from './components/PetsHatchingCeremony';

// Hooks (used internally; kept exported for potential external use)
export { usePetsOnboarding } from './hooks/usePetsOnboarding';
export type {
  OnboardingStep,
  OnboardingState,
  OnboardingActions,
  UsePetsOnboardingResult,
} from './hooks/usePetsOnboarding';

// Utilities
export {
  generateEggPreview,
  updatePreviewName,
  previewToEventTags,
  previewToPetsCompanion,
} from './lib/pets-preview';
export type { PetsEggPreview } from './lib/pets-preview';
