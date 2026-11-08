# Cloudflare edge configuration (2140.wtf)

The site is served by GitHub Pages today. When `2140.wtf` moves to Cloudflare
(see the DNS migration note in `memory/2026-11-08.md` of the bao.markets repo),
this directory is the cache and proxy policy the zone should get — and it is
validated on every deploy, so it cannot rot while it waits.

## Files

| file | what it is |
|---|---|
| `zone-cache-ruleset.json` | body for `PUT /zones/{id}/rulesets/phases/http_request_cache_settings/entrypoint` |
| `zone-settings.json` | zone settings, PATCHed one id at a time; `why` is documentation only |
| `../scripts/cloudflare/apply-zone-config.mjs` | CLI: validate (default), `--verify`, `--apply` |
| `../scripts/cloudflare/zone-config.mjs` | pure loaders/validators, imported by the CLI and the tests |

## The cache policy, and why it is ordered that way

Rules are evaluated first match wins, so the order is the policy:

1. **`/assets/*` — cache a year.** Vite hashes every bundle and font it emits, so
   a given URL's bytes never change. This is the only place an immutable TTL is
   safe.
2. **Unhashed media (`public/` files keep their names) — edge 1 h, browser 5 min.**
   Same file, new bytes, same URL: a long TTL would strand an old logo.
3. **Documents — bypass the edge.** `.html`, the extensionless route shells
   (`/chat`, `/bao/markets`, …), `sw.js` and the web manifest.

Rule 3 is the one that matters here. This app is a static SPA whose
`index.html` references `/assets/index-<hash>.js`; the hashes change on every
deploy. An edge-cached shell survives the deploy, keeps being served to
browsers, and asks them for a bundle that no longer exists — the page fails as
**blank**, not as visibly stale. So HTML never leaves the origin's cache
semantics (Pages sends `max-age=600` plus an ETag).

The ruleset validator enforces that the last rule is a bypass, so this invariant
cannot be edited away silently.

## The proxy settings, and why two of them are correctness

`ssl=strict` is non-negotiable: Pages already serves a valid Let's Encrypt cert
and redirects HTTP→HTTPS, so `Flexible` would terminate TLS at the edge, speak
plain HTTP to Pages, and get redirected back forever.

`rocket_loader=off` and `email_obfuscation=off` are equally load-bearing for an
SPA: both rewrite markup and script loading, and this app boots from a module
script that owns the whole DOM. The rest (`http3`, `brotli`, `min_tls_version`,
`cache_level=standard`) are safe wins; `polish`/`mirage` are pinned **off** so
image transcoding can never alter bytes served under an immutable TTL.

## Usage

```bash
npm run check:cloudflare        # offline: validates both files and prints the plan
node scripts/cloudflare/apply-zone-config.mjs --verify   # read the live zone, compare, no writes
node scripts/cloudflare/apply-zone-config.mjs --apply     # write, then verify
```

Credentials come from the environment **only** — `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ZONE_ID` (argv is world-readable in `ps`). The token needs *Cache
Rules: Edit* and *Zone Settings: Edit* scoped to this zone. `--apply` is
idempotent: settings are PATCHed only where they differ, the ruleset is PUT as a
whole, and both are read back and compared before it reports success.

## Order of operations when the zone moves

1. Add the zone, recreate the DNS records **grey-cloud first** (see the migration
   note). Nothing here applies to a DNS-only record.
2. Apply settings, then the ruleset, then verify.
3. Spot-check the split (two requests each, second one warms the edge):

```bash
curl -sI https://2140.wtf/ | grep -i cf-cache-status            # BYPASS
curl -sI https://2140.wtf/chat | grep -i cf-cache-status        # BYPASS (a route shell is HTML)
curl -sI https://2140.wtf/assets/<hashed-file>.js | grep -i cf-cache-status   # MISS, then HIT
```

4. Only then orange-cloud a host that needs a Worker: routes for `bao-lnaddr`
   (`/.well-known/lnurlp*`, see `wrangler.lnaddr.toml`) require a proxied host.
   Worker responses bypass this cache by their own semantics, so the policy does
   not need a rule for them.

## Rollback

- Cache policy: `PUT` the same endpoint with `{"rules": []}`, or delete the
  ruleset in the dashboard. The zone then falls back to `cache_level=standard`.
- Settings: re-PATCH the previous values (`--verify` prints what differs), or
  reset them in the dashboard.
- The whole migration: point the nameservers back at GoDaddy's pair, which is
  untouched.
