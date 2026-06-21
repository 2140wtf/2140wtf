export { BattleArena } from './components/BattleArena';
export { BattleSetup } from './components/BattleSetup';
export { BattleResultOverlay } from './components/BattleResultOverlay';
export { BattleHud, BattleControlsHelp } from './components/BattleHud';
export { BattlePetSprite } from './components/BattlePetSprite';
export { BattleTouchControls } from './components/BattleTouchControls';
export { useBattleGame } from './hooks/useBattleGame';
export { useBattlePayout } from './hooks/useBattlePayout';
export {
  buildBattleInteractionEventTemplate,
  emitBattleInteractionEvent,
  parseBattleInteractionEvent,
  type BattleInteractionParams,
  type BattleMode,
  type PetsBattleInteraction,
} from './lib/battleInteraction';
export type {
  BattleFighter,
  BattleInputState,
  BattleMatchOptions,
  BattleMatchResult,
  BattlePlayerIndex,
  BattleProjectile,
  BattleState,
  BattleStatus,
  PlayerInput,
} from './types/battle.types';
