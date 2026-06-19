/**
 * Pets Companion Module
 * 
 * A modular companion system for rendering an interactive Pets
 * that roams the screen and responds to user interaction.
 * 
 * Usage:
 * ```tsx
 * import { PetsCompanionLayer } from '@/pets/companion';
 * 
 * // In your app root:
 * <PetsCompanionLayer />
 * ```
 */

// ─── Components ───────────────────────────────────────────────────────────────

export { PetsCompanionLayer } from './components/PetsCompanionLayer';
export { PetsCompanion } from './components/PetsCompanion';
export { PetsCompanionVisual } from './components/PetsCompanionVisual';

// ─── Hooks ────────────────────────────────────────────────────────────────────

export { usePetsCompanion } from './hooks/usePetsCompanion';
export { usePetsCompanionData } from './hooks/usePetsCompanionData';
export { usePetsCompanionState } from './hooks/usePetsCompanionState';
export { usePetsCompanionMotion } from './hooks/usePetsCompanionMotion';
export { usePetsCompanionGaze } from './hooks/usePetsCompanionGaze';
export { usePetsAttention } from './hooks/usePetsAttention';
export { usePetsEntryAnimation } from './hooks/usePetsEntryAnimation';
export { useTypingAttention } from './hooks/useTypingAttention';
export { useCompanionItemReaction } from './hooks/useCompanionItemReaction';

// ─── Core ─────────────────────────────────────────────────────────────────────

export { DEFAULT_COMPANION_CONFIG, calculateWalkSpeed, randomDuration } from './core/companionConfig';
export {
  createInitialMotion,
  createInitialGaze,
  decideNextAction,
  updateMotion,
  startDrag,
  updateDragPosition,
  endDrag,
  updateGaze,
  calculateEyeOffset,
  generateRandomGazeOffset,
} from './core/companionMachine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  CompanionState,
  CompanionDirection,
  GazeMode,
  EntryType,
  EntryPhase,
  InspectionDirection,
  EntryState,
  Position,
  Velocity,
  MovementBounds,
  CompanionMotion,
  EyeOffset,
  GazeState,
  CompanionData,
  CompanionConfig,
  CompanionContextValue,
  CompanionEvent,
  AttentionTarget,
  AttentionPriority,
} from './types/companion.types';

// ─── Utils ────────────────────────────────────────────────────────────────────

export {
  calculateMovementBounds,
  calculateGroundY,
  calculateMainContentLeftEdge,
  calculateEntryPosition,
  calculateRestingPosition,
  lerp,
  easeOutCubic,
  easeInOutCubic,
  distance,
  clamp,
} from './utils/movement';

export {
  calculateFallEntryAnimation,
  calculateRiseEntryAnimation,
  calculateFloatAnimation,
  calculateIdleBob,
  calculateWalkBounce,
  smoothTransition,
  generateInspectionOrder,
  getInspectionEyeOffset,
} from './utils/animation';

export type { VerticalEntryConfig, VerticalEntryResult, FloatOffset } from './utils/animation';

// ─── Sidebar Navigation ───────────────────────────────────────────────────────

export {
  getSidebarIdForPath,
  getSidebarIndex,
  compareRoutes,
  getEntryDirection,
} from './utils/sidebarNavigation';

export type { NavigationDirection, NavigationComparison } from './utils/sidebarNavigation';

// ─── Interaction ──────────────────────────────────────────────────────────────

export {
  useCompanionActionMenu,
  useClickDetection,
  CompanionActionMenu,
  HangingItems,
  MENU_ACTIONS,
  INITIAL_MENU_STATE,
  DEFAULT_CLICK_CONFIG,
  getMenuActionConfig,
  getItemCategoryForAction,
} from './interaction';

export type {
  CompanionMenuAction,
  MenuActionConfig,
  CompanionItem,
  CompanionMenuState,
  ClickDetectionConfig,
} from './interaction';
