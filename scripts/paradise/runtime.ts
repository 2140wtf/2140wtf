/**
 * Paradise runtime — the autonomous agent's impure shell.
 *
 * Wires a Nostr identity, a Routstr fuel tank, the earning portfolio, and the
 * pure OODA loop into a live cycle driver. State (nsec + routstr key + sim
 * balances + strategy health) persists in ~/.paradise/<name>.json, mirroring
 * the bao-agent ~/.concord-live pattern.
 *
 * Dry-run (default): no network — balances are simulated so the loop is
 * observable with zero keys. Live (--live): reads the real Routstr balance
 * and can redeem/top-up with a Cashu token. Strategy execution is stubbed in
 * both modes until each engine is wired (see strategies.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { bytesToHex } from "@noble/hashes/utils.js";

import { freshLoopState, step, type LoopState } from "@/lib/paradise/loop";
import { classifyFuel, type FuelLevel } from "@/lib/paradise/treasury";
import type { StrategyId, StrategyMeta } from "@/lib/paradise/strategy";
import { defaultStrategies, type Strategy, type StrategyContext } from "./strategies";

const ROUTSTR_BASE_URL = (process.env.ROUTSTR_API_URL ?? "https://api.routstr.com").replace(/\/+$/, "");
const PARADISE_DIR = process.env.PARADISE_HOME ?? join(homedir(), ".paradise");

export interface ParadiseState {
  sk: string;
  pubkey: string;
  npub: string;
  /** Routstr sk_ key — bearer money, stored locally only, never published. */
  routstrKey: string | null;
  /** Cashu wallet balance (msats). Simulated until a real Cashu wallet is wired. */
  cashuMsats: number;
  /** Simulated Routstr fuel (msats) used in dry-run, or when no live key is set. */
  simRoutstrMsats: number;
  strategyHealth: Record<StrategyId, number>;
  createdAt: number;
}

export function statePath(name: string): string {
  return join(PARADISE_DIR, `${name}.json`);
}

export function loadState(name: string): ParadiseState {
  const path = statePath(name);
  if (!existsSync(path)) {
    throw new Error(`No paradise identity "${name}" — run: paradise init ${name} (expected ${path})`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as ParadiseState;
}

export function saveState(name: string, state: ParadiseState): void {
  if (!existsSync(PARADISE_DIR)) mkdirSync(PARADISE_DIR, { recursive: true });
  writeFileSync(statePath(name), JSON.stringify(state, null, 2) + "\n");
}

export function createIdentity(name: string): ParadiseState {
  if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use run/fuel.`);
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const state: ParadiseState = {
    sk: bytesToHex(sk),
    pubkey,
    npub: nip19.npubEncode(pubkey),
    routstrKey: null,
    cashuMsats: 0,
    simRoutstrMsats: 0,
    strategyHealth: { bounty: 0.5, zap: 0.5, broker: 0.3, trader: 0.4 },
    createdAt: Date.now(),
  };
  saveState(name, state);
  return state;
}

async function routstrBalance(apiKey: string): Promise<number> {
  const res = await fetch(`${ROUTSTR_BASE_URL}/v1/balance/info`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Routstr balance failed: ${res.status}`);
  const json = (await res.json()) as { balance?: number };
  return typeof json.balance === "number" ? json.balance : 0;
}

/** Read the current fuel balance: the live Routstr key if set, else the sim tank. */
export async function readFuel(state: ParadiseState): Promise<number> {
  if (state.routstrKey) return routstrBalance(state.routstrKey);
  return state.simRoutstrMsats;
}

/** Redeem a Cashu token into a fresh Routstr sk_ key (live). */
export async function routstrCreateFromCashu(token: string): Promise<{ apiKey: string; balance: number }> {
  const res = await fetch(`${ROUTSTR_BASE_URL}/v1/balance/create?initial_balance_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Routstr redeem failed: ${res.status}`);
  const json = (await res.json()) as { api_key?: string; balance?: number };
  if (!json.api_key || typeof json.balance !== "number") {
    throw new Error("Routstr returned a malformed redeem response — the token may already be spent.");
  }
  return { apiKey: json.api_key, balance: json.balance };
}

/** Top up an existing Routstr key with another Cashu token (live). */
export async function routstrTopupWithCashu(apiKey: string, token: string): Promise<number> {
  const res = await fetch(`${ROUTSTR_BASE_URL}/v1/balance/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ cashu_token: token }),
  });
  if (!res.ok) throw new Error(`Routstr top-up failed: ${res.status}`);
  const json = (await res.json()) as { balance?: number };
  return typeof json.balance === "number" ? json.balance : 0;
}

export interface RuntimeOptions {
  dryRun: boolean;
  intervalMs: number;
}

export class ParadiseRuntime {
  state: ParadiseState;
  loopState: LoopState = freshLoopState();
  private strategies: Strategy[];

  constructor(state: ParadiseState) {
    this.state = state;
    this.strategies = defaultStrategies();
  }

  private metas(): StrategyMeta[] {
    return this.strategies.map((s) => ({
      ...s.meta,
      health: this.state.strategyHealth[s.id] ?? s.meta.health,
    }));
  }

  /** Run one OODA cycle. Returns a human-readable log line and mutates state. */
  async cycle(opts: RuntimeOptions): Promise<string> {
    const nowMs = Date.now();
    const dryRun = opts.dryRun;
    const routstrMsats = dryRun ? this.state.simRoutstrMsats : await readFuel(this.state);
    const cashuMsats = this.state.cashuMsats;
    const fuel: FuelLevel = classifyFuel(routstrMsats);

    const { state: nextLoop, command } = step(this.loopState, {
      routstrMsats,
      cashuMsats,
      nowMs,
      strategies: this.metas(),
    });
    this.loopState = nextLoop;

    const head = `[cycle ${this.loopState.iteration}] fuel=${fuel.toUpperCase()} routstr=${fmt(routstrMsats)} cashu=${fmt(cashuMsats)}`;

    if (command.kind === "sweep") {
      if (dryRun) {
        this.state.cashuMsats -= command.amountMsats;
        this.state.simRoutstrMsats += command.amountMsats;
        return `${head} → SWEEP ${fmt(command.amountMsats)}\n  ↳ cashu→fuel, tank now ${fmt(this.state.simRoutstrMsats)} (${command.projectedFuel})`;
      }
      return `${head} → SWEEP ${fmt(command.amountMsats)}\n  ↳ skipped: cashu wallet integration pending (use 'paradise topup <name> <cashuToken>' to fuel up manually)`;
    }

    if (command.kind === "idle") {
      return `${head} → IDLE (${command.reason})`;
    }

    // earn | work
    const strat = this.strategies.find((s) => s.id === command.strategy);
    if (!strat) return `${head} → ${command.kind.toUpperCase()} ${command.strategy}\n  ↳ strategy not found`;
    const ctx: StrategyContext = { nowMs, fuel: command.fuel, routstrMsats, dryRun, agentPubkey: this.state.pubkey };
    const result = await strat.execute(ctx);

    this.state.cashuMsats = Math.max(0, this.state.cashuMsats + result.walletDeltaMsats);
    if (dryRun) this.state.simRoutstrMsats = Math.max(0, this.state.simRoutstrMsats - result.spentMsats);

    const prev = this.state.strategyHealth[strat.id] ?? strat.meta.health;
    this.state.strategyHealth[strat.id] = clamp01(0.7 * prev + 0.3 * (result.ok ? 1 : 0));

    const mark = result.ok ? "✓" : "✗";
    const delta = result.walletDeltaMsats >= 0 ? `+${fmt(result.walletDeltaMsats)}` : `${fmt(result.walletDeltaMsats)}`;
    return `${head} → ${command.kind.toUpperCase()} ${command.strategy}\n  ${mark} ${result.message} | ${delta} wallet, -${fmt(result.spentMsats)} fuel`;
  }
}

function fmt(msats: number): string {
  return `${msats} msat`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
