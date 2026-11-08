# DNS migration: 2140.wtf from GoDaddy to Cloudflare

**Status: planned, NOT started.** No Cloudflare account, zone or token exists in
this project yet, and DNS is unchanged. This document is the runbook for the move
and the place to record what actually happened when it does.

Written 2026-11-08 against the live DNS as observed that day; re-run the
inventory in [Current state](#current-state) before starting, because the
registrar panel is the only authority on the zone's contents.

## Why move

Three things are impossible or awkward while the zone's nameservers are GoDaddy's:

1. **Worker routes.** `bao-lnaddr` (`src/worker/lnaddrWorker.ts`, configured in
   `wrangler.lnaddr.toml`) serves `/.well-known/lnurlp*` on this zone. A Workers
   route only fires for a hostname that is proxied by Cloudflare, which requires
   the zone to be on Cloudflare.
2. **Edge cache policy.** The cache rules and proxy settings in `cloudflare/`
   (`zone-cache-ruleset.json`, `zone-settings.json`) are written, validated in CI
   and waiting for a zone to apply to. See `cloudflare/README.md`.
3. **Edge request rules.** Transform/redirect rules need the zone. The flat
   route shells (`scripts/spa-route-shells.mjs`) already solved the extensionless
   deep-link problem at the origin, so this is now a nice-to-have, not a blocker.

## Current state

Observed 2026-11-08. Nameserver pair and SOA are GoDaddy's; the site is GitHub
Pages (`server: GitHub.com`, `cache-control: max-age=600`, ETag present). TLS is
a Pages-issued Let's Encrypt certificate (`C=US, O=Let's Encrypt, CN=YR1`),
valid 2026-09-27 to 2026-12-26.

| Name | Type | Value as observed | Purpose | Must survive the move |
|---|---|---|---|---|
| `2140.wtf` | A x4 | `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` | GitHub Pages apex | **yes** (or CNAME-flatten to `2140wtf.github.io`) |
| `www` | CNAME | `2140wtf.github.io.` | Pages canonical `www` | **yes** |
| `2140.wtf` | MX 10 | `mail.protonmail.ch.` | Proton mail | **critical** |
| `2140.wtf` | MX 20 | `mailsec.protonmail.ch.` | Proton mail (secondary) | **critical** |
| `2140.wtf` | TXT | `v=spf1 include:_spf.protonmail.ch ~all` | SPF | **critical** |
| `2140.wtf` | TXT | `protonmail-verification=<token>` | Proton domain ownership | **critical** (copy verbatim) |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine` | DMARC policy | **critical** |
| `protonmail._domainkey` | CNAME | `protonmail.domainkey.<id>.domains.proton.ch.` | Proton DKIM 1 | **critical** |
| `protonmail2._domainkey` | CNAME | `protonmail2.domainkey.<id>.domains.proton.ch.` | Proton DKIM 2 | **critical** |
| `protonmail3._domainkey` | CNAME | `protonmail3.domainkey.<id>.domains.proton.ch.` | Proton DKIM 3 | **critical** |
| `2140.wtf` | AAAA | none | - | nothing to migrate |
| `2140.wtf` | CAA | none | - | nothing to migrate (optional hardening later) |
| `2140.wtf` | DNSSEC | **off** (no DNSKEY, no DS) | - | nothing to unsign; no DS-removal window |
| `_github-pages-challenge-2140wtf` | TXT | **absent** | Pages domain verification | **add before cutover** (see step 2) |
| `_atproto` | TXT | absent | not in use | - |

Registrar nameservers: `ns23.domaincontrol.com`, `ns24.domaincontrol.com`
(SOA `ns23.domaincontrol.com. dns.jomax.net.`). No DNS provider anywhere in the
project reads this zone, so nothing in the app breaks on the switch by itself -
the risk is entirely in the record set above, and in email.

The `protonmail-verification` TXT and the three DKIM CNAME targets are public DNS
data, not secrets, but they are Proton-issued: copy them byte for byte from the
GoDaddy panel rather than retyping them from this document.

## Pre-flight

- [ ] Export the **whole** GoDaddy zone (screenshot or CSV of every record),
      including Proton's DKIM selectors and DMARC. A missed DKIM record breaks
      outbound mail silently, days later.
- [ ] Confirm the registrar account can change nameservers, and that nobody else
      is mid-change on this domain.
- [ ] Note the current SOA serial so a stale zone is identifiable later.
- [ ] Create a Cloudflare account and add the site; note the pair of nameservers
      Cloudflare assigns.
- [ ] Do the work in a low-traffic window. Expect minutes-to-24h of propagation;
      the TTL work in step 4 bounds the tail.

## Steps

### 1. Build the Cloudflare zone, grey cloud only

Add every record from the inventory **as DNS only (grey cloud)**:

- apex A x4 -> the four Pages IPs (Cloudflare also accepts a CNAME-flattened
  apex to `2140wtf.github.io`; keep whichever matches the export).
- `www` CNAME -> `2140wtf.github.io`.
- MX x2, SPF TXT, `protonmail-verification` TXT, `_dmarc` TXT, DKIM CNAME x3.
- Do **not** invent AAAA or CAA records. Absence is the current state.

Grey cloud keeps the serving path byte-identical to today, so the only variable
is the record set itself.

### 2. Verify the GitHub Pages custom domain before switching NS

Add the TXT record GitHub shows under **Settings -> Pages -> Custom domain**:

```
_github-pages-challenge-2140wtf.2140.wtf   TXT   <value from GitHub>
```

Click **Verify** while the zone is still on GoDaddy. This is the takeover guard;
without it, a proxied or temporarily broken zone can drop the domain from the
repo and leave the name claimable. It is also the record Pages revalidates the
certificate against, so do it before the certificate is close to expiry
(2026-12-26).

### 3. Apply the proxy settings

```bash
export CLOUDFLARE_API_TOKEN=...     # env only, never argv
export CLOUDFLARE_ZONE_ID=...
node scripts/cloudflare/apply-zone-config.mjs --apply
```

That writes `cloudflare/zone-settings.json` (SSL **Full (strict)**, Always Use
HTTPS, Rocket Loader and email obfuscation **off**, http3/brotli on, polish and
mirage off) and `cloudflare/zone-cache-ruleset.json`, then reads the zone back
and verifies both. `ssl=strict` must be in place **before** any host is proxied:
`Flexible` would terminate TLS at the edge, speak plain HTTP to Pages, and be
redirected back forever.

### 4. Lower the TTL and switch nameservers

- Set the GoDaddy TTLs to 300-600 s about 24 h before the switch.
- At the registrar, replace `ns23/ns24.domaincontrol.com` with the Cloudflare
  pair. Leave the GoDaddy zone itself intact - it is the rollback.

### 5. Verify the switch

```bash
dig NS 2140.wtf +short                    # Cloudflare pair
dig +trace 2140.wtf | tail -5             # delegation path
dig A 2140.wtf +short                     # Pages IPs (grey cloud) / CF IPs (proxied)
dig MX 2140.wtf +short                    # both Proton hosts
dig TXT 2140.wtf +short                   # SPF + protonmail-verification
dig TXT _dmarc.2140.wtf +short            # v=DMARC1; p=quarantine
dig CNAME protonmail._domainkey.2140.wtf +short   # and protonmail2/3
```

Mail is the check that matters most, and it is not a `dig` result: send a message
**from** a `@2140.wtf` Proton mailbox **to** an outside address and reply, then
read the headers. You want:

```
spf=pass ... dkim=pass (selector protonmail) ... dmarc=pass
```

Three DKIM selectors, all passing. If DKIM fails, a selector CNAME is missing or
mistyped; fix it in Cloudflare, do not proceed.

Site checks:

```bash
curl -sI https://2140.wtf/ | grep -iE '^server|^cf-cache-status|^cache-control'
curl -sI https://2140.wtf/bao/markets | head -1                      # HTTP/2 200
curl -sI https://2140.wtf/chat/join | head -1                        # HTTP/2 200
curl -sI https://2140.wtf/testnet/bao/markets | head -1              # HTTP/2 200
```

While grey-clouded, `cf-cache-status` is absent (the request never enters the
Cloudflare data plane) - the header checks become meaningful only after step 6.

### 6. Enable the proxy, then verify the cache policy

Orange-cloud the apex and `www` once Pages is confirmed healthy on grey cloud.
Then re-check:

```bash
curl -sI https://2140.wtf/ | grep -i cf-cache-status                 # BYPASS
curl -sI https://2140.wtf/assets/<hashed-file>.js | grep -i cf-cache-status   # MISS, then HIT
```

If the site loops, the SSL mode is not `Full (strict)`. If HTML shows `HIT`, the
cache ruleset did not apply - stop and run `--verify`.

Known cosmetic consequence: GitHub's **Settings -> Pages** DNS check may warn
that the domain does not point at Pages, because it now resolves to Cloudflare
IPs. The site keeps working and the domain stays verified through the TXT record
from step 2; do not "fix" the warning by deleting the custom domain.

### 7. Deploy the lnaddr worker

Worker routes require a proxied hostname, which is why this comes last.

```bash
# 1. Account id for wrangler.lnaddr.toml
npx wrangler whoami                       # copy the account id

# 2. KV namespace for the name registry
npx wrangler kv namespace create LNADDR_KV
#    -> paste the printed id into kv_namespaces[0].id in wrangler.lnaddr.toml
#    -> paste the account id into account_id (both are empty today)

# 3. Optional: any rate-limit/turnstile secret, set as a wrangler secret
#    (never in the toml, never in argv)
npx wrangler secret put TURNSTILE_SECRET --config wrangler.lnaddr.toml

# 4. Deploy + attach the routes already declared in the toml
npx wrangler deploy --config wrangler.lnaddr.toml
npx wrangler tail --config wrangler.lnaddr.toml   # watch the first requests
```

The toml already declares the routes on this zone:

```
2140.wtf/.well-known/lnurlp
2140.wtf/.well-known/lnurlp/*
```

No additional DNS record is needed - these paths live on the apex, and the route
pattern takes precedence over the origin. Verify:

```bash
# 404 for an unclaimed name is the correct, expected answer
curl -s -o /dev/null -w '%{http_code}\n' https://2140.wtf/.well-known/lnurlp/nobody
# a claimed name returns LUD-06 JSON with callback + min/maxSendable
curl -s https://2140.wtf/.well-known/lnurlp/<claimed-name> | head -c 300
```

Claiming is `POST /.well-known/lnurlp` signed by the owner, and release is
`DELETE /.well-known/lnurlp/:name`; both are documented at the top of
`src/worker/lnaddrWorker.ts`. `public/_redirects` keeps the SPA from claiming
`/.well-known/*` on the Pages side, so the two never fight.

## Rollback

Everything here is reversible, and the fastest path is always the same:

1. **Nameservers back to GoDaddy**: set `ns23.domaincontrol.com` and
   `ns24.domaincontrol.com` at the registrar. The GoDaddy zone was never
   modified, so the whole site (and mail) returns as soon as the TTL expires.
   Keep the Cloudflare zone in place while investigating - deleting it is not
   part of a rollback.
2. **Proxy only, zone staying on Cloudflare**: grey-cloud the apex and `www` to
   take the edge out of the path. If TLS is involved, revert `ssl` to the value
   `--verify` reported before the change.
3. **Cache policy only**: `PUT` an empty ruleset to the phase entrypoint, or
   delete it in the dashboard - the zone falls back to `cache_level=standard`.
   `node scripts/cloudflare/apply-zone-config.mjs --verify` prints exactly what
   differs.
4. **Worker only**: `npx wrangler deployments list --config wrangler.lnaddr.toml`
   then `npx wrangler rollback --config wrangler.lnaddr.toml`, or detach the
   route. The KV namespace is durable state - rollback and redeploy do not touch
   claimed names.

After any rollback, repeat the mail header check: email is the one thing a
DNS mistake breaks silently.

## Not in scope (deliberately)

- **HSTS.** Worth adding only after a few weeks of stable HTTPS; a bad preload
  outlives the rollback window.
- **CAA.** Absent today; adding it would pin certificate authorities. Revisit
  once the Cloudflare edge plus Pages origin certificate arrangement is settled.
- **Cloudflare Pages hosting.** The alternative to Pages-behind-Cloudflare is
  moving the site to Cloudflare Pages, which would activate the repo's
  `public/_redirects` (`/* /index.html 200`) directly and make
  `scripts/spa-route-shells.mjs` redundant. That is a hosting change, not a DNS
  change, and it is not part of this migration.
- **DNSSEC.** Currently off. Turning it on is a separate change with its own
  rollback (remove the DS at the registrar first), and it should not ride along
  with the NS move.

## References

- `cloudflare/README.md` - cache/proxy policy, usage, spot-checks, rollback.
- `cloudflare/zone-cache-ruleset.json`, `cloudflare/zone-settings.json` - the
  exact API payloads.
- `scripts/cloudflare/apply-zone-config.mjs` - `--check` (offline, run in CI),
  `--verify`, `--apply`.
- `wrangler.lnaddr.toml`, `src/worker/lnaddrWorker.ts` - the lnaddr worker.
- `public/_redirects` - SPA fallback used if hosting ever moves to Cloudflare
  Pages.
- `scripts/spa-route-shells.mjs` - the origin-side fix for extensionless deep
  links.
