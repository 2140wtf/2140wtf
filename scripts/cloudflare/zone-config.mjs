/**
 * Zone configuration for 2140.wtf on Cloudflare, read from `cloudflare/*.json`.
 *
 * Pure by design: no network, no writes. The CLI (`apply-zone-config.mjs`) is
 * the only thing that talks to the API, so CI and `npm test` can validate the
 * policy with no token and no account - which is the whole point of keeping
 * this in the repo before the zone has moved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULESET_PHASE = 'http_request_cache_settings';
export const RULESET_FILE = 'zone-cache-ruleset.json';
export const SETTINGS_FILE = 'zone-settings.json';

/** The only cache action this policy uses. */
const CACHE_ACTION = 'set_cache_settings';

/** TTL modes the Rulesets API accepts for edge_ttl / browser_ttl. */
const TTL_MODES = new Set(['override_origin', 'respect_origin', 'bypass_by_default']);

/**
 * Zone setting ids this app may touch. The API 404s an unknown id rather than
 * rejecting it in context, so a typo would silently never apply - hence an
 * explicit list instead of trusting whatever the JSON says.
 */
export const ALLOWED_SETTINGS = new Set([
  'ssl',
  'always_use_https',
  'automatic_https_rewrites',
  'min_tls_version',
  'tls_1_3',
  'http3',
  'brotli',
  'rocket_loader',
  'email_obfuscation',
  'mirage',
  'polish',
  'cache_level',
  'browser_cache_ttl',
]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadZoneConfig(dir = 'cloudflare') {
  const ruleset = readJson(join(dir, RULESET_FILE));
  const settings = readJson(join(dir, SETTINGS_FILE));
  validateCacheRuleset(ruleset);
  validateZoneSettings(settings);
  return { ruleset, settings };
}

function expressionProblems(expression, where) {
  const problems = [];
  if (typeof expression !== 'string' || expression.trim() === '') {
    return [`${where}: expression must be a non-empty string`];
  }
  if (!expression.includes('http.request.uri.path')) {
    problems.push(`${where}: expression must key on http.request.uri.path`);
  }
  let depth = 0;
  let quotes = 0;
  for (const ch of expression) {
    if (ch === '"') quotes += 1;
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) problems.push(`${where}: expression closes a paren it never opened`);
  }
  if (depth !== 0) problems.push(`${where}: expression has unbalanced parentheses`);
  if (quotes % 2 !== 0) problems.push(`${where}: expression has an unterminated string`);
  if (expression.includes('${')) problems.push(`${where}: expression must not interpolate`);
  return problems;
}

function ttlProblems(ttl, where) {
  if (!ttl || typeof ttl !== 'object') return [`${where}: must be an object`];
  if (!TTL_MODES.has(ttl.mode)) return [`${where}: mode must be one of ${[...TTL_MODES].join(', ')}`];
  if (ttl.mode === 'override_origin') {
    if (!Number.isInteger(ttl.default) || ttl.default < 0) {
      return [`${where}: override_origin needs an integer default (seconds)`];
    }
  }
  return [];
}

/**
 * Throws with every problem found, not just the first: a hand-edited ruleset
 * should be fixable in one pass. The last rule is required to bypass the cache,
 * because "HTML is never edge-cached" is the invariant this file exists for.
 */
export function validateCacheRuleset(ruleset) {
  const problems = [];
  if (!ruleset || typeof ruleset !== 'object') throw new Error(`${RULESET_FILE}: must be an object`);
  if (typeof ruleset.name !== 'string' || ruleset.name.trim() === '') problems.push(`${RULESET_FILE}: name is required`);
  if (!Array.isArray(ruleset.rules) || ruleset.rules.length === 0) {
    problems.push(`${RULESET_FILE}: rules must be a non-empty array`);
    throw new Error(problems.join('\n'));
  }
  ruleset.rules.forEach((rule, index) => {
    const where = `${RULESET_FILE} rule ${index + 1}`;
    if (!rule || typeof rule !== 'object') {
      problems.push(`${where}: must be an object`);
      return;
    }
    if (typeof rule.description !== 'string' || rule.description.trim() === '') {
      problems.push(`${where}: description is required`);
    }
    problems.push(...expressionProblems(rule.expression, where));
    if (rule.action !== CACHE_ACTION) problems.push(`${where}: action must be ${CACHE_ACTION}`);
    const params = rule.action_parameters;
    if (!params || typeof params !== 'object') {
      problems.push(`${where}: action_parameters is required`);
      return;
    }
    if (typeof params.cache !== 'boolean') {
      problems.push(`${where}: action_parameters.cache must be true or false`);
      return;
    }
    if (params.cache) {
      problems.push(...ttlProblems(params.edge_ttl, `${where}.edge_ttl`));
      problems.push(...ttlProblems(params.browser_ttl, `${where}.browser_ttl`));
    }
  });
  const last = ruleset.rules[ruleset.rules.length - 1];
  if (!last?.action_parameters || last.action_parameters.cache !== false) {
    problems.push(`${RULESET_FILE}: the last rule must bypass the edge cache (HTML, shells, sw.js)`);
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return true;
}

export function validateZoneSettings(payload) {
  const problems = [];
  if (!payload || !Array.isArray(payload.settings) || payload.settings.length === 0) {
    throw new Error(`${SETTINGS_FILE}: settings must be a non-empty array`);
  }
  const seen = new Set();
  payload.settings.forEach((entry, index) => {
    const where = `${SETTINGS_FILE} entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${where}: must be an object`);
      return;
    }
    if (typeof entry.id !== 'string' || !ALLOWED_SETTINGS.has(entry.id)) {
      problems.push(`${where}: unknown setting id ${JSON.stringify(entry.id)}`);
      return;
    }
    if (seen.has(entry.id)) problems.push(`${where}: duplicate setting id ${entry.id}`);
    seen.add(entry.id);
    const type = typeof entry.value;
    if (!['string', 'number', 'boolean'].includes(type)) {
      problems.push(`${where}: value must be a string, number or boolean`);
    }
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return true;
}

/** The request body for the phase entrypoint: documentation keys stripped. */
export function rulesetBody(ruleset) {
  return { name: ruleset.name, description: ruleset.description, rules: ruleset.rules };
}

/** `{id, value}` only - the `why` field is documentation, not API input. */
export function settingsPatchList(payload) {
  return payload.settings.map(({ id, value }) => ({ id, value }));
}

/** Entries whose desired value differs from the zone's current one. */
export function changedSettings(current, desired) {
  const currentById = new Map((current ?? []).map((entry) => [entry.id, entry.value]));
  return desired.filter(({ id, value }) => {
    const now = currentById.get(id);
    if (now === undefined) return true;
    if (typeof now === 'number' && typeof value === 'number') return now !== value;
    return String(now) !== String(value);
  });
}

export function rulesetEntrypoint(zoneId) {
  return `zones/${zoneId}/rulesets/phases/${RULESET_PHASE}/entrypoint`;
}

/** Human-readable plan, used by `--check` and as the `--apply` preamble. */
export function describePlan({ ruleset, settings }) {
  const lines = [`${RULESET_FILE}: ${ruleset.rules.length} rules (first match wins)`];
  ruleset.rules.forEach((rule, index) => {
    const params = rule.action_parameters;
    const cache = params.cache
      ? `cache, edge ${params.edge_ttl?.default ?? '-'}s, browser ${params.browser_ttl?.default ?? '-'}s`
      : 'bypass edge cache';
    lines.push(`  ${index + 1}. ${cache} - ${rule.description}`);
  });
  lines.push(`${SETTINGS_FILE}: ${settings.settings.length} settings`);
  lines.push(`  ${settings.settings.map(({ id, value }) => `${id}=${value}`).join(', ')}`);
  return lines;
}
