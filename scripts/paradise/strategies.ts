/**
 * Paradise earning strategies — the executable portfolio.
 *
 * Each strategy is an earning engine the autonomous agent can run for one
 * cycle. The PURE selector (src/lib/paradise/strategy.ts) picks which one;
 * this file holds the impure execution side.
 *
 * Strategies map onto existing ₿AO engines (wiring pending, see roadmap):
 *   bounty  → src/lib/baoWorkContract.ts  (milestone escrow contracts)
 *   zap     → NIP-57 zaps for autonomous Nostr output
 *   broker  → run a Routstr proxy, sell inference to other agents
 *   trader  → src/lib/baoFundraising.ts placeBaoTrade (bao.markets)
 *
 * Until each engine is wired, the strategies below are bounded simulators so
 * the loop closes end-to-end and the portfolio policy is observable. They are
 * clearly labelled in their output.
 */
import type { StrategyId, StrategyMeta } from "@/lib/paradise/strategy";

export interface StrategyContext {
  nowMs: number;
  fuel: "starving" | "low" | "healthy";
  routstrMsats: number;
  dryRun: boolean;
  /** True when publishing to relays (false = dry-run simulation). */
  live: boolean;
  /** Relays the agent raises bitcoin on (kinds 4971/4972/4973). */
  relays: string[];
  /** Whether the cooldown permits a new raise-bitcoin request this cycle. */
  canRaise: boolean;
  /** Raise bitcoin: post a kind-4971 work request. Returns the event id ("" if skipped). */
  raiseBitcoin: (amountSats: number, purpose: string) => Promise<string>;
  agentPubkey: string;
}

export interface StrategyResult {
  ok: boolean;
  /** Net change to the Cashu wallet this cycle (may be negative, e.g. a losing trade). */
  walletDeltaMsats: number;
  /** Fuel spent on inference to run this strategy (msats). */
  spentMsats: number;
  message: string;
}

export interface Strategy {
  id: StrategyId;
  meta: StrategyMeta;
  execute(ctx: StrategyContext): Promise<StrategyResult>;
}

function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

// Stubs are labelled so the cycle log is honest about what is simulated.
const STUB = "(stub)";

export function defaultStrategies(): Strategy[] {
  return [
    {
      id: "bounty",
      meta: { id: "bounty", health: 0.5, expectedMsats: 30_000, needsFuel: false },
            async execute(ctx: StrategyContext): Promise<StrategyResult> {
        if (ctx.fuel !== "starving") {
          return { ok: true, walletDeltaMsats: 0, spentMsats: 0, message: `scanned open requests for claimable bounties ${STUB}` };
        }
        // Starving → raise bitcoin: broadcast a kind-4971 work request so a funder
        // can answer with a Cashu token (out-of-band NIP-17 DM). This is Paradise's
        // "raises bitcoin" half; cashu→fuel sweep is the treasury's separate concern.
        const purpose = "Paradise inference fuel";
        const amountSats = 2_100;
                if (ctx.live) {
          if (!ctx.canRaise) {
            return { ok: true, walletDeltaMsats: 0, spentMsats: 0, message: `still seeking funds for an open request… ${STUB}` };
          }
          const id = await ctx.raiseBitcoin(amountSats, purpose);
          if (id) {
            return {
              ok: true,
              walletDeltaMsats: 0,
              spentMsats: 0,
              message: `raised bitcoin — posted kind-4971 request ${id.slice(0, 16)}… (${amountSats} sats) for "${purpose}"`,
            };
          }
          return { ok: true, walletDeltaMsats: 0, spentMsats: 0, message: `still seeking funds for an open request… ${STUB}` };
        }
        // dry-run simulator: imagine a funder answered the broadcast request.
        const earned = rand(5_000, 50_000);
        return { ok: true, walletDeltaMsats: earned, spentMsats: 0, message: `claimed & verified a milestone bounty ${STUB}` };
      },
    },
    {
      id: "zap",
      meta: { id: "zap", health: 0.5, expectedMsats: 8_000, needsFuel: true },
      async execute(ctx: StrategyContext): Promise<StrategyResult> {
        const spent = ctx.routstrMsats > 0 ? rand(500, 2_000) : 0;
        const earned = rand(1_000, 10_000);
        return { ok: true, walletDeltaMsats: earned, spentMsats: spent, message: `published content, received zaps ${STUB}` };
      },
    },
    {
      id: "broker",
      meta: { id: "broker", health: 0.3, expectedMsats: 100_000, needsFuel: true },
      async execute(ctx: StrategyContext): Promise<StrategyResult> {
        if (ctx.routstrMsats <= 0) {
          return { ok: false, walletDeltaMsats: 0, spentMsats: 0, message: `proxy idle, no fuel to serve ${STUB}` };
        }
        const spent = rand(2_000, 10_000);
        const earned = rand(20_000, 200_000);
        return { ok: true, walletDeltaMsats: earned, spentMsats: spent, message: `sold inference to another agent ${STUB}` };
      },
    },
    {
      id: "trader",
      meta: { id: "trader", health: 0.4, expectedMsats: 80_000, needsFuel: true },
      async execute(ctx: StrategyContext): Promise<StrategyResult> {
        const spent = ctx.routstrMsats > 0 ? rand(1_000, 5_000) : 0;
        const pnl = rand(-150_000, 250_000);
        return { ok: pnl >= 0, walletDeltaMsats: pnl, spentMsats: spent, message: `placed a market trade, P&L ${pnl >= 0 ? "+" : ""}${pnl} msat ${STUB}` };
      },
    },
  ];
}
