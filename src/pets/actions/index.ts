// src/pets/actions/index.ts

// Components
export { PlayMusicModal } from './components/PlayMusicModal';
export { InlineMusicPlayer } from './components/InlineMusicPlayer';
export { InlineSingCard } from './components/InlineSingCard';

// Hooks
export { usePetsUseInventoryItem } from './hooks/usePetsUseInventoryItem';
export type { UseItemRequest, UseItemResult, UsePetsUseInventoryItemParams } from './hooks/usePetsUseInventoryItem';

export { usePetsHatch, usePetsEvolve } from './hooks/usePetsStageTransition';
export type { 
  UsePetsStageTransitionParams, 
  StageTransitionResult,
  CanonicalActionResult,
} from './hooks/usePetsStageTransition';

export { 
  useStartIncubation, 
  useStopIncubation, 
  useStartEvolution,
  useStopEvolution,
} from './hooks/usePetsIncubation';
export type {
  StartIncubationMode,
  StartIncubationRequest,
  UseStartIncubationParams,
  StartIncubationResult,
  UseStopIncubationParams,
  StopIncubationResult,
  UseStartEvolutionParams,
  StartEvolutionResult,
  UseStopEvolutionParams,
  StopEvolutionResult,
} from './hooks/usePetsIncubation';

export { useActiveTaskProcess, filterPersistentTasks as filterPersistentTasksFromProcess, filterDynamicTasks } from './hooks/useActiveTaskProcess';
export type { TaskProcessType, TaskProcessConfig, ActiveTaskProcessResult } from './hooks/useActiveTaskProcess';

export { 
  useHatchTasks, 
  filterPersistentTasks,
  KIND_THEME_DEFINITION,
  HATCH_REQUIRED_INTERACTIONS,
  REQUIRED_INTERACTIONS, // Legacy export
} from './hooks/useHatchTasks';
export type { HatchTask, HatchTasksResult, TaskType } from './hooks/useHatchTasks';

export {
  useEvolveTasks,
  KIND_PROFILE_TABS,
  EVOLVE_REQUIRED_THEMES,
  EVOLVE_REQUIRED_INTERACTIONS,
  EVOLVE_STAT_THRESHOLD,
} from './hooks/useEvolveTasks';
export type { EvolveTasksResult } from './hooks/useEvolveTasks';

export { usePetsDirectAction, DIRECT_ACTION_HAPPINESS_EFFECTS } from './hooks/usePetsDirectAction';
export type { DirectActionRequest, DirectActionResult, UsePetsDirectActionParams } from './hooks/usePetsDirectAction';

export { useAudioPlayback } from './hooks/useAudioPlayback';
export type { PlaybackState, PlaybackError, UseAudioPlaybackOptions, UseAudioPlaybackReturn } from './hooks/useAudioPlayback';

// Track catalog
export { 
  PETS_TRACK_CATALOG,
  getAllTracks,
  getTrackById,
  formatTrackDuration,
  type PetsTrack,
} from './lib/pets-track-catalog';

// Activity state
export {
  createMusicActivity,
  createSingActivity,
  createNoActivity,
  type InlineActivityType,
  type InlineActivityState,
  type MusicActivityState,
  type SingActivityState,
  type NoActivityState,
  type PetsReactionState,
  type SelectedTrack,
} from './lib/pets-activity-state';

// Re-export stat bounds from canonical source
export { STAT_MIN, STAT_MAX } from '@/pets/core/lib/pets';

// Utilities
export {
  // Types
  type InventoryAction,
  type DirectAction,
  type PetsAction,
  type ItemUsabilityResult,
  type StatChangeWithSegments,
  // Constants
  ACTION_TO_ITEM_TYPE,
  ACTION_METADATA,
  DIRECT_ACTION_METADATA,
  ALL_ACTION_METADATA,
  GENERAL_ITEM_USABLE_STAGES,
  EGG_ALLOWED_ACTIONS,
  EGG_ALLOWED_INVENTORY_ACTIONS,
  EGG_ALLOWED_DIRECT_ACTIONS,
  EGG_VISIBLE_INVENTORY_ACTIONS,
  EGG_VISIBLE_ACTIONS,
  SHELL_REPAIR_KIT_ID,
  // Functions
  clampStat,
  applyStat,
  applyItemEffects,
  decrementStorageItem,
  canUseAction,
  canUseDirectAction,
  isActionVisibleForStage,
  canUseInventoryItems,
  getStageRestrictionMessage,
  previewStatChangesWithSegments,
  hasMedicineEffectForEgg,
  hasHygieneEffectForEgg,
  canUseItemForStage,
  getActionForItem,
} from './lib/pets-action-utils';

// Daily Missions & Login Bonus
export { useDailyMissions } from './hooks/useDailyMissions';
export { useDailyLoginBonus } from './hooks/useDailyLoginBonus';
export type { DailyMissionView, UseDailyMissionsResult } from './hooks/useDailyMissions';
export {
  useAwardDailySats,
  useAwardDailyXp,
  useClaimMissionReward,
} from './hooks/useClaimMissionReward';
export { usePersistEvolutionProgress } from './hooks/usePersistEvolutionProgress';
export { usePersistDailyProgress } from './hooks/usePersistDailyProgress';
export type {
  AwardDailySatsRequest,
  AwardDailySatsResult,
  AwardDailyXpRequest,
  AwardDailyXpResult,
  ClaimMissionRequest,
  ClaimMissionResult,
} from './hooks/useClaimMissionReward';
export { useRerollMission } from './hooks/useRerollMission';
export type { RerollMissionRequest, RerollMissionResult } from './hooks/useRerollMission';
export {
  trackDailyMissionProgress,
  trackDailyMissionEvent,
  trackMultipleDailyMissionActions,
} from './lib/daily-mission-tracker';
export {
  calculateDailyLoginBonus,
  DEMO_SATS_PER_COIN,
  DAILY_LOGIN_BASE_SATS,
  DAILY_LOGIN_STREAK_BONUS_SATS,
  MAX_DAILY_LOGIN_STREAK_BONUS_SATS,
} from './lib/daily-login-bonus';
export type { DailyLoginBonusResult } from './lib/daily-login-bonus';
export type {
  DailyMissionAction,
  DailyMissionDefinition,
  Mission,
  TallyMission,
  EventMission,
  MissionsContent,
} from './lib/daily-missions';

// Missions content model
export {
  parseProfileContent,
  serializeProfileContent,
  isMissionComplete,
  isTallyMission,
  isEventMission,
  missionProgress,
} from '@/pets/core/lib/missions';
export type { ProfileContent } from '@/pets/core/lib/missions';

// Item cooldown
export { isItemOnCooldown, setItemCooldown, subscribeCooldowns } from './lib/item-cooldown';
export { ITEM_COOLDOWN_SUCCESS_MS, ITEM_COOLDOWN_FAILURE_MS } from './lib/item-cooldown';
export { useItemCooldown } from './hooks/useItemCooldown';

// Action sats rewards
export {
  ACTION_REWARDS,
  INVENTORY_ACTION_REWARDS,
  DIRECT_ACTION_REWARDS,
  POOP_CLEANUP_REWARD,
  calculateActionReward,
  calculateInventoryActionReward,
  applySatsReward,
  formatSatsGain,
  getSatsGainMessage,
  getSatsRewardSummary,
} from './lib/pets-action-rewards';

// Streak tracking
export {
  calculateStreakUpdate,
  getStreakTagUpdates,
  needsStreakUpdate,
  getStreakStatus,
} from './lib/pets-streak';
export type {
  StreakUpdateResult,
  StreakTagUpdates,
} from './lib/pets-streak';

export { usePetsCareActivity } from './hooks/usePetsCareActivity';
export type {
  UsePetsCareActivityParams,
  CareActivityResult,
} from './hooks/usePetsCareActivity';

// BAO MARKETS trading rewards
export { useBaoTradeStats } from './bao/hooks/useBaoTradeStats';
export type { UseBaoTradeStatsResult } from './bao/hooks/useBaoTradeStats';
export { useClaimBaoTradeRewards } from './bao/hooks/useClaimBaoTradeRewards';
export type { ClaimBaoTradeRewardsResult } from './bao/hooks/useClaimBaoTradeRewards';
export {
  BAO_TRADE_KIND,
  BAO_RELAY_URL,
  parseBaoOrderEvent,
  aggregateBaoTradeActivity,
} from './bao/lib/bao-trade-parser';
export type { BaoOrderEvent, BaoTradeActivity } from './bao/lib/bao-trade-parser';
export {
  BAO_SAT_TO_BAO_RATE,
  BAO_DAILY_REWARD_CAP,
  BAO_MIN_ACTIVE_AMOUNT,
  BAO_TIER_THRESHOLDS,
  BAO_TIER_LABELS,
  calculateBaoTier,
  getBaoTierLabel,
  calculateBaoReward,
} from './bao/lib/bao-rewards';
export type { BaoRewardResult } from './bao/lib/bao-rewards';
