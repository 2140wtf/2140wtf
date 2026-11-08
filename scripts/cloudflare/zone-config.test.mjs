import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  changedSettings,
  describePlan,
  loadZoneConfig,
  rulesetBody,
  settingsPatchList,
  validateCacheRuleset,
  validateZoneSettings,
} from './zone-config.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = () => loadZoneConfig(resolve(REPO_ROOT, 'cloudflare'));

describe('the shipped Cloudflare zone policy', () => {
  it('validates against the API shape', () => {
    expect(() => load()).not.toThrow();
  });

  it('serves hashed assets from the edge and never caches a document', () => {
    const { ruleset } = load();
    const [assets, media, documents] = ruleset.rules;

    expect(assets.expression).toContain('/assets/');
    expect(assets.action_parameters).toMatchObject({
      cache: true,
      edge_ttl: { default: 31536000 },
      browser_ttl: { default: 31536000 },
    });

    // Unhashed public/ files keep their names, so they get a short TTL, not a year.
    expect(media.expression).toContain('woff2');
    expect(media.action_parameters).toMatchObject({ cache: true, edge_ttl: { default: 3600 } });

    // The invariant: documents bypass the edge entirely. The hashed bundle name
    // in a stale shell is what makes cached HTML fail as a blank page.
    expect(documents.action_parameters).toEqual({ cache: false });
    for (const needle of ['.html', '/sw.js', '.webmanifest']) {
      expect(documents.expression).toContain(needle);
    }
    expect(documents.expression).toContain('not(matches(http.request.uri.path');
  });

  it('describes the plan in rule order', () => {
    const plan = describePlan(load()).join('\n');
    expect(plan).toContain('3 rules');
    expect(plan).toContain('bypass edge cache');
    expect(plan).toContain('ssl=strict');
  });

  it('sends API fields only, never the documentation ones', () => {
    const config = load();
    const body = rulesetBody(config.ruleset);
    expect(body).toEqual({ name: expect.any(String), description: expect.any(String), rules: expect.any(Array) });
    expect(body).not.toHaveProperty('$comment');
    for (const entry of settingsPatchList(config.settings)) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'value']);
    }
  });
});

describe('zone policy validation', () => {
  const rule = (over = {}) => ({
    description: 'rule',
    expression: 'http.request.uri.path eq "/a"',
    action: 'set_cache_settings',
    action_parameters: { cache: false },
    ...over,
  });
  const caching = { cache: true, edge_ttl: { mode: 'override_origin', default: 60 }, browser_ttl: { mode: 'override_origin', default: 60 } };

  it('requires the last rule to bypass the cache', () => {
    expect(() => validateCacheRuleset({ name: 'x', rules: [rule({ action_parameters: caching })] })).toThrow(/last rule must bypass/);
  });

  it('rejects a caching rule without TTLs, and any other action', () => {
    expect(() => validateCacheRuleset({ name: 'x', rules: [rule({ action_parameters: { cache: true } }), rule()] })).toThrow(/edge_ttl/);
    expect(() => validateCacheRuleset({ name: 'x', rules: [rule({ action: 'cache' }), rule()] })).toThrow(/action must be/);
  });

  it('rejects unbalanced or non-path expressions', () => {
    expect(() => validateCacheRuleset({ name: 'x', rules: [rule({ expression: 'not(ends_with(http.request.uri.path, ".html")' })] })).toThrow(/unbalanced/);
    expect(() => validateCacheRuleset({ name: 'x', rules: [rule({ expression: 'ends_with(http.host, "2140.wtf")' })] })).toThrow(/uri.path/);
  });

  it('rejects unknown and duplicate settings', () => {
    expect(() => validateZoneSettings({ settings: [{ id: 'ssl', value: 'strict' }, { id: 'ssl', value: 'full' }] })).toThrow(/duplicate/);
    expect(() => validateZoneSettings({ settings: [{ id: 'cache_everything', value: 'on' }] })).toThrow(/unknown setting id/);
  });

  it('reports only the settings the zone does not already have', () => {
    const desired = [{ id: 'ssl', value: 'strict' }, { id: 'browser_cache_ttl', value: 14400 }];
    expect(changedSettings([{ id: 'ssl', value: 'strict' }, { id: 'browser_cache_ttl', value: 14400 }], desired)).toEqual([]);
    expect(changedSettings([{ id: 'ssl', value: 'flexible' }], desired).map((s) => s.id)).toEqual(['ssl', 'browser_cache_ttl']);
  });
});
