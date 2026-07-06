export type ChaseRail =
  | 'bitcoin'
  | 'lightning'
  | 'cashu'
  | 'liquid'
  | 'onchain'
  | 'spark'
  | 'ark';

export interface RailConfig {
  id: ChaseRail;
  label: string;
  color: string;
  bg: string;
  icon: string;
}

export const CHASE_RAILS: RailConfig[] = [
  { id: 'bitcoin', label: 'Bitcoin', color: '#F7931A', bg: '#FFF7ED', icon: '₿' },
  { id: 'lightning', label: 'Lightning', color: '#792EE5', bg: '#F5F3FF', icon: '⚡' },
  { id: 'cashu', label: 'Cashu', color: '#0EA5E9', bg: '#F0F9FF', icon: 'C' },
  { id: 'liquid', label: 'Liquid', color: '#3EDC91', bg: '#ECFDF5', icon: 'L' },
  { id: 'onchain', label: 'On-chain', color: '#6366F1', bg: '#EEF2FF', icon: '⛓' },
  { id: 'spark', label: 'Spark', color: '#F59E0B', bg: '#FFFBEB', icon: 'S' },
  { id: 'ark', label: 'Ark', color: '#EC4899', bg: '#FDF2F8', icon: 'A' },
];

export const RAIL_BY_ID: Record<ChaseRail, RailConfig> = Object.fromEntries(
  CHASE_RAILS.map((rail) => [rail.id, rail]),
) as Record<ChaseRail, RailConfig>;

export type ChaseGameStatus = 'idle' | 'running' | 'ended';
export type ChaseMode = 'fiat' | 'sats';

export interface ChaseCoin {
  id: number;
  x: number;
  y: number;
  rail: ChaseRail;
  collected: boolean;
  radius: number;
}

export interface ChaseObstacle {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'block' | 'low' | 'gap';
}

export interface ChaseRunResult {
  score: number;
  distance: number;
  coinsCollected: number;
  coinsByRail: Record<ChaseRail, number>;
  satsWon: number;
}

export interface ChaseGameState {
  status: ChaseGameStatus;
  result: ChaseRunResult;
  speed: number;
  distance: number;
  isJumping: boolean;
  isDucking: boolean;
  petY: number;
  coins: ChaseCoin[];
  obstacles: ChaseObstacle[];
}

export const CHASE_FIAT_COST = 10;
export const CHASE_SATS_PER_COIN = 1;
export const CHASE_RUN_TIMEOUT_MS = 60_000;
export const CHASE_JUMP_VELOCITY = -13;
export const CHASE_GRAVITY = 0.65;
export const CHASE_BASE_SPEED = 5;
export const CHASE_MAX_SPEED = 13;
export const CHASE_SPEED_INCREMENT = 0.003;
