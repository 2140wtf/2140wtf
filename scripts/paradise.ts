/**
 * Paradise CLI — an autonomous ₿AO agent that raises bitcoin through a
 * portfolio of earning strategies and buys its own inference fuel on Routstr.
 *
 * Build: npm run paradise   (rolldown → .tmp/paradise.mjs)
 * Run:   node .tmp/paradise.mjs <mode> [args]
 *
 * Modes:
 *   init   <name> [--routstr-key sk_…]   create a Nostr identity (~/.paradise/<name>.json)
 *   redeem <name> <cashuToken>           redeem a Cashu token into a fresh Routstr sk_ key (live)
 *   topup  <name> <cashuToken>           top up the existing Routstr key with a Cashu token (live)
 *   fuel   <name> [--live]               print the fuel tank balance
 *   run    <name> [--cycles N] [--live] [--interval Ms]   run the autonomous loop
 *
 * Exit codes: 0 ok · 1 error · 2 no-result.
 */
import {
  ParadiseRuntime,
  createIdentity,
  loadState,
  readFuel,
  routstrCreateFromCashu,
  routstrTopupWithCashu,
  saveState,
  statePath,
} from "./paradise/runtime";

function flag(args: string[], name: string): [boolean, string | undefined] {
  const i = args.indexOf(name);
  if (i === -1) return [false, undefined];
  return [true, args[i + 1]];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    switch (mode) {
      case "init": {
        const name = rest[0];
        if (!name) throw new Error("init requires a <name>");
        const [hasKey, key] = flag(rest, "--routstr-key");
        const state = createIdentity(name);
        if (hasKey && key) state.routstrKey = key;
        saveState(name, state);
        console.log(`paradise identity "${name}" created`);
        console.log(`  npub:  ${state.npub}`);
        console.log(`  state: ${statePath(name)}`);
        console.log(`  fuel:  ${state.routstrKey ? "live sk_ key set" : "none (dry-run sim fuel)"}`);
        break;
      }
      case "redeem": {
        const name = rest[0];
        const token = rest[1];
        if (!name || !token) throw new Error("redeem requires <name> <cashuToken>");
        const state = loadState(name);
        const { apiKey, balance } = await routstrCreateFromCashu(token);
        state.routstrKey = apiKey;
        state.simRoutstrMsats = balance;
        saveState(name, state);
        console.log(`redeemed Cashu into a Routstr key for "${name}"`);
        console.log(`  sk_ key: ${apiKey} (bearer — stored locally, never publish)`);
        console.log(`  balance: ${balance} msat`);
        break;
      }
      case "topup": {
        const name = rest[0];
        const token = rest[1];
        if (!name || !token) throw new Error("topup requires <name> <cashuToken>");
        const state = loadState(name);
        if (!state.routstrKey) throw new Error(`"${name}" has no Routstr key — run 'paradise redeem ${name} <token>' first.`);
        const balance = await routstrTopupWithCashu(state.routstrKey, token);
        state.simRoutstrMsats = balance;
        saveState(name, state);
        console.log(`topped up "${name}" → ${balance} msat`);
        break;
      }
      case "fuel": {
        const name = rest[0];
        if (!name) throw new Error("fuel requires a <name>");
        const [live] = flag(rest, "--live");
        const state = loadState(name);
        const fuel = live ? await readFuel(state) : state.simRoutstrMsats;
        console.log(`"${name}" fuel: ${fuel} msat${state.routstrKey ? " (live key)" : " (sim)"} · cashu wallet: ${state.cashuMsats} msat`);
        break;
      }
      case "run": {
        const name = rest[0];
        if (!name) throw new Error("run requires a <name>");
        const [hasCycles, cyclesVal] = flag(rest, "--cycles");
        const [live] = flag(rest, "--live");
        const [hasInterval, intervalVal] = flag(rest, "--interval");
        const cycles = hasCycles ? Number(cyclesVal) : 10;
        const intervalMs = hasInterval ? Number(intervalVal) : 1000;
        const dryRun = !live;
        const state = loadState(name);
        const rt = new ParadiseRuntime(state);
        console.log(`paradise "${name}" ${dryRun ? "dry-run" : "live"} — npub ${state.npub}`);
        const target = cycles > 0 ? cycles : Infinity;
        for (let i = 0; i < target; i++) {
          const line = await rt.cycle({ dryRun, intervalMs });
          console.log(line);
          saveState(name, rt.state);
          if (i < target - 1) await sleep(intervalMs);
        }
        break;
      }
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(`paradise: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

function printUsage(): void {
  console.error(`paradise — autonomous ₿AO agent

  paradise init   <name> [--routstr-key sk_…]
  paradise redeem <name> <cashuToken>
  paradise topup  <name> <cashuToken>
  paradise fuel   <name> [--live]
  paradise run    <name> [--cycles N] [--live] [--interval Ms]`);
}

await main();
