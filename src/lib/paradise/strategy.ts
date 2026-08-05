/**
 * Paradise earning portfolio — strategy selection.
 *
 * The agent has a portfolio of earning strategies (bounties, zaps, brokering
 * inference, prediction-market trading). Each cycle the supervisor picks one
 * based on the current fuel level and each strategy's health / expected yield.
 *
 * This module is the PURE selector. Strategy execution is impure
 * (network-bound) and lives in the runtime; here we only decide which one to
 * run, so the policy is unit-testable.
 *
 * Strategies map onto existing ₿AO engines:
 *   bounty  → src/lib/baoWorkContract.ts (milestone escrow contracts)
 *   zap     → NIP-57 zaps for autonomous Nostr output
 *   broker  → run a Routstr proxy, sell inference to other agents
 *   trader  → baoFundraising.placeBaoTrade (bao.markets prediction markets)
 */

import type { FuelLevel } from './treasury';

export type StrategyId = 'bounty' | 'zap' | 'broker' | 'trader';

export interface StrategyMeta {
  id: StrategyId;
  /** 0..1 — rolling success rate. 0 means "has not succeeded yet". */
  health: number;
  /** Expected msats earned per cycle (the selector's prior). */
  expectedMsats: number;
  /** True if running this strategy needs inference fuel (e.g. trader reasons with an LLM). */
  needsFuel: boolean;
  /** Epoch ms before which the strategy is on cooldown. */
  cooldownUntil?: number;
}

export interface PortfolioSnapshot {
  nowMs: number;
  fuel: FuelLevel;
  strategies: StrategyMeta[];
}

export type StrategyDecision =
  | { kind: 'run'; strategy: StrategyId }
  | { kind: 'idle'; reason: string };

/**
 * Pick the strategy to run this cycle.
 *
 * Policy:
 *  - Drop strategies still in cooldown.
 *  - STARVING: prefer strategies that do NOT need fuel (the agent can't afford
 *    to spend inference on a strategy that might not pay). If every strategy
 *    needs fuel, fall back to the highest expected yield as a last resort.
 *  - LOW / HEALTHY: maximise expected value = expectedMsats × health, i.e. the
 *    reliable high-yield strategy wins.
 *  - If nothing is eligible, idle with a reason.
 */
export function selectStrategy({ nowMs, fuel, strategies }: PortfolioSnapshot): StrategyDecision {
  const eligible = strategies.filter((s) => (s.cooldownUntil ?? 0) <= nowMs);
  if (eligible.length === 0) {
    return { kind: 'idle', reason: 'all strategies on cooldown' };
  }

  if (fuel === 'starving') {
    const noFuel = eligible.filter((s) => !s.needsFuel);
    const pool = noFuel.length > 0 ? noFuel : eligible; // last resort: anything
    return { kind: 'run', strategy: pickHighestYield(pool).id };
  }

  return { kind: 'run', strategy: pickHighestEv(eligible).id };
}

function pickHighestYield(pool: StrategyMeta[]): StrategyMeta {
  return pool.reduce((best, s) => (s.expectedMsats > best.expectedMsats ? s : best));
}

function pickHighestEv(pool: StrategyMeta[]): StrategyMeta {
  const ev = (s: StrategyMeta) => s.expectedMsats * clamp01(s.health);
  return pool.reduce((best, s) => (ev(s) > ev(best) ? s : best));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
