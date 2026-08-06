/**
 * Paradise OODA loop — the autonomous cycle as a pure reducer.
 *
 * One cycle = observe (read balances + portfolio) → decide (treasury sweep +
 * strategy pick) → emit a Command for the impure runtime to execute. The
 * runtime executes the command, mutates the world, and feeds the next
 * observation back in. This file holds the pure half, so the whole policy is
 * unit-testable with no relays, no network, no keys.
 *
 * Modelled on the Ralph Loop (docs/bao-brain/RALPH_LOOP.md): observe → orient
 * → decide → act → verify. Verification is the runtime's job (it runs the
 * strategy's verify function); here we only produce the next action.
 */

import { classifyFuel, planSweep, type FuelLevel } from './treasury';
import { selectStrategy, type StrategyId, type StrategyMeta, type StrategyDecision } from './strategy';

export interface LoopObservation {
  routstrMsats: number;
  cashuMsats: number;
  nowMs: number;
  strategies: StrategyMeta[];
}

export interface LoopState {
  iteration: number;
  fuel: FuelLevel;
  routstrMsats: number;
  cashuMsats: number;
  activeStrategy: StrategyId | null;
  lastError: string | null;
  /** Incremented every cycle a sweep is requested. */
  sweepsRequested: number;
}

export type LoopCommand =
  | { kind: 'sweep'; amountMsats: number; projectedFuel: FuelLevel }
  | { kind: 'earn'; strategy: StrategyId; fuel: FuelLevel }
  | { kind: 'work'; strategy: StrategyId; fuel: FuelLevel }
  | { kind: 'idle'; reason: string; fuel: FuelLevel };

export function freshLoopState(): LoopState {
  return {
    iteration: 0,
    fuel: 'starving',
    routstrMsats: 0,
    cashuMsats: 0,
    activeStrategy: null,
    lastError: null,
    sweepsRequested: 0,
  };
}

/**
 * Pure OODA step. Combines the treasury sweep decision with strategy selection
 * into a single command.
 *
 * Precedence:
 *  1. SWEEP — if there are earnings to convert and the tank isn't full, top up
 *     first. Fuel is the precondition for everything else.
 *  2. EARN — if fuel is starving and there's nothing to sweep, the portfolio
 *     must raise bitcoin (starving prefers no-fuel strategies).
 *  3. WORK — fuel is adequate; run the portfolio's best strategy to be
 *     productive (and incidentally earn more).
 *  4. IDLE — no strategy eligible.
 */
export function step(state: LoopState, obs: LoopObservation): { state: LoopState; command: LoopCommand } {
  const fuel = classifyFuel(obs.routstrMsats);
  const sweep = planSweep({ routstrMsats: obs.routstrMsats, cashuMsats: obs.cashuMsats });

  const advanced: LoopState = {
    ...state,
    iteration: state.iteration + 1,
    fuel,
    routstrMsats: obs.routstrMsats,
    cashuMsats: obs.cashuMsats,
    lastError: null,
  };

  if (sweep) {
    return {
      state: { ...advanced, sweepsRequested: state.sweepsRequested + 1 },
      command: { kind: 'sweep', amountMsats: sweep.amountMsats, projectedFuel: sweep.projectedFuel },
    };
  }

  const decision: StrategyDecision = selectStrategy({
    nowMs: obs.nowMs,
    fuel,
    strategies: obs.strategies,
  });

  if (decision.kind === 'idle') {
    return {
      state: { ...advanced, activeStrategy: null },
      command: { kind: 'idle', reason: decision.reason, fuel },
    };
  }

  // Starving → 'earn' (raise bitcoin); otherwise → 'work' (productive cycle).
  const kind: 'earn' | 'work' = fuel === 'starving' ? 'earn' : 'work';
  return {
    state: { ...advanced, activeStrategy: decision.strategy },
    command: { kind, strategy: decision.strategy, fuel },
  };
}
