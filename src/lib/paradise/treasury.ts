/**
 * Paradise treasury — the agent's fuel tank.
 *
 * An autonomous ₿AO agent runs on Routstr inference credits (the "fuel"). It
 * earns bitcoin (Cashu ecash) through its earning portfolio and sweeps those
 * earnings into fuel. This module is the PURE decision layer: given the two
 * balances, it classifies the fuel level and decides whether/how much to sweep.
 *
 * Units: all balances are millisats (msats). Strategies that earn in sats
 * convert (×1000) before handing the result to the treasury. Nothing here
 * touches the network — the runtime layer feeds it live balances from
 * `routstrGetBalance` + the Cashu wallet.
 */

/** Minimum fuel reserve (msats). Below this the agent is "starving". */
export const FUEL_RESERVE_MSATS = 21_000;
/** Fuel target (msats). Sweep until the Routstr balance reaches here. */
export const FUEL_TARGET_MSATS = 2_100_000;
/** Only sweep when the Cashu wallet holds at least this much (avoid dust top-ups). */
export const SWEEP_MIN_MSATS = 10_000;

export type FuelLevel = 'starving' | 'low' | 'healthy';

export interface TreasuryBalances {
  routstrMsats: number;
  cashuMsats: number;
}

export interface SweepPlan {
  /** msats to sweep from the Cashu wallet into the Routstr key. */
  amountMsats: number;
  /** Cashu left behind after the sweep. */
  leavesCashuMsats: number;
  /** Fuel level after the sweep would settle. */
  projectedFuel: FuelLevel;
}

/** Classify the current Routstr balance into a coarse fuel level. */
export function classifyFuel(routstrMsats: number): FuelLevel {
  if (routstrMsats < FUEL_RESERVE_MSATS) return 'starving';
  if (routstrMsats < FUEL_TARGET_MSATS) return 'low';
  return 'healthy';
}

/**
 * Decide whether and how much to sweep from the Cashu wallet into the
 * Routstr key. Returns null when sweeping is not worthwhile right now.
 *
 * Sweep only when there is enough Cashu to clear the dust floor
 * (SWEEP_MIN_MSATS) AND fuel is not already healthy (no point topping up a
 * full tank). The amount tops the tank toward FUEL_TARGET_MSATS but never
 * sweeps more than the wallet holds.
 */
export function planSweep({ routstrMsats, cashuMsats }: TreasuryBalances): SweepPlan | null {
  if (cashuMsats < SWEEP_MIN_MSATS) return null;
  if (routstrMsats >= FUEL_TARGET_MSATS) return null;

  const deficit = FUEL_TARGET_MSATS - routstrMsats;
  const amountMsats = Math.min(deficit, cashuMsats);
  if (amountMsats <= 0) return null;

  return {
    amountMsats,
    leavesCashuMsats: cashuMsats - amountMsats,
    projectedFuel: classifyFuel(routstrMsats + amountMsats),
  };
}
