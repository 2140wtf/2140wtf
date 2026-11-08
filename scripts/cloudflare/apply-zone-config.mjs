#!/usr/bin/env node
/**
 * Apply the cache policy and proxy settings in `cloudflare/*.json` to the
 * 2140.wtf zone.
 *
 *   node scripts/cloudflare/apply-zone-config.mjs           # validate + print the plan (no network)
 *   node scripts/cloudflare/apply-zone-config.mjs --verify  # read the zone back and compare
 *   node scripts/cloudflare/apply-zone-config.mjs --apply   # write ruleset + settings, then verify
 *
 * Credentials come from the environment only - `CLOUDFLARE_API_TOKEN` and
 * `CLOUDFLARE_ZONE_ID` - because argv is world-readable in `ps`. The token is
 * never printed, and API failures report the endpoint plus Cloudflare's own
 * error messages, never request headers.
 *
 * Nothing here runs until the zone actually exists on Cloudflare: with no
 * token the default mode is an offline `--check`, which is what CI uses.
 */
import process from 'node:process';

import {
  changedSettings,
  describePlan,
  loadZoneConfig,
  rulesetBody,
  rulesetEntrypoint,
  settingsPatchList,
} from './zone-config.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 20_000;

const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');
const verify = flags.has('--verify');
const known = new Set(['--apply', '--verify', '--check', '--help']);
for (const flag of flags) {
  if (!known.has(flag)) {
    console.error(`unknown flag ${flag}\nusage: apply-zone-config.mjs [--check|--verify|--apply]`);
    process.exit(2);
  }
}
if (flags.has('--help')) {
  console.log('usage: apply-zone-config.mjs [--check|--verify|--apply]\n\n  --check   validate cloudflare/*.json and print the plan (default, offline)\n  --verify  read the live zone back and compare it with the files\n  --apply   write the ruleset and the changed settings, then verify');
  process.exit(0);
}

function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    console.error(
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set in the environment.\n' +
        'Create the token with: Zone > Cache Rules (edit) and Zone Settings (edit) on 2140.wtf only.\n' +
        'Never pass either on the command line.',
    );
    process.exit(2);
  }
  return { token, zoneId };
}

async function api({ token, zoneId }, path, init = {}) {
  const res = await fetch(`${API}/zones/${zoneId}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok || payload?.success === false) {
    const messages = (payload?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}${messages ? ` (${messages})` : ''}`);
  }
  return payload?.result;
}

async function readCurrent(context) {
  const entrypoint = await api(context, rulesetEntrypoint(context.zoneId)).catch((err) => {
    // 404 here means "this zone has no ruleset in this phase yet", which is the
    // normal state before the first apply - not a failure.
    if (String(err.message).includes('HTTP 404')) return null;
    throw err;
  });
  const settings = (await api(context, 'settings')) ?? [];
  return { entrypoint, settings };
}

function compare(current, desired) {
  const wanted = settingsPatchList(desired);
  const pendingSettings = changedSettings(current.settings, wanted);
  const liveRules = current.entrypoint?.rules?.length ?? 0;
  return {
    pendingSettings,
    rulesMissing: liveRules !== desired.ruleset.rules.length,
    liveRules,
    liveName: current.entrypoint?.name ?? null,
  };
}

async function main() {
  const config = loadZoneConfig();
  console.log(describePlan(config).join('\n'));

  if (!apply && !verify) {
    console.log('\n--check: configuration is valid. No network calls made.');
    return;
  }

  const context = credentials();
  const current = await readCurrent(context);
  const diff = compare(current, config);
  console.log(
    `\nzone ${context.zoneId}: ${diff.liveRules} live cache rule(s)${diff.liveName ? ` ("${diff.liveName}")` : ''}, ` +
      `${diff.pendingSettings.length} setting(s) out of date`,
  );
  for (const { id, value } of diff.pendingSettings) console.log(`  settings.${id} -> ${value}`);

  if (apply) {
    await api(context, rulesetEntrypoint(context.zoneId), {
      method: 'PUT',
      body: JSON.stringify(rulesetBody(config.ruleset)),
    });
    console.log(`applied the ${config.ruleset.rules.length}-rule cache policy`);
    for (const { id, value } of diff.pendingSettings) {
      await api(context, `settings/${id}`, { method: 'PATCH', body: JSON.stringify({ value }) });
      console.log(`applied settings.${id} = ${value}`);
    }
  }

  const after = await readCurrent(context);
  const afterDiff = compare(after, config);
  const problems = [];
  if (afterDiff.rulesMissing) {
    problems.push(`cache ruleset has ${afterDiff.liveRules} rule(s), expected ${config.ruleset.rules.length}`);
  }
  if (afterDiff.pendingSettings.length > 0) {
    problems.push(`settings still out of date: ${afterDiff.pendingSettings.map((s) => s.id).join(', ')}`);
  }
  if (problems.length > 0) {
    console.error(`\nverification failed:\n  ${problems.join('\n  ')}`);
    process.exit(3);
  }
  console.log('\nverified: the live zone matches cloudflare/*.json');
  console.log('spot-check: curl -sI https://2140.wtf/ | grep -i cf-cache-status  # BYPASS');
  console.log('            curl -sI https://2140.wtf/assets/<hashed-file> | grep -i cf-cache-status  # MISS, then HIT');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
