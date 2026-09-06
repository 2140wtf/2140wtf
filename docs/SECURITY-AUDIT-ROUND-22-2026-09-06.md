# Security Audit — Round 22 (2026-09-06)

**Focus:** (a) iframe permission-policy/sandbox inventory; (b) encrypted-settings fail-open.

## 22a — Iframe inventory (committed separately, `8db9dc14`)

All 12 embeds reviewed. Fixes:
- **LinkEmbed** inline YouTube iframe shipped without the sandbox its `YouTubeEmbed` sibling applies — untrusted video URLs got a full-privilege frame. Same sandbox applied.
- **ArchiveOrgEmbed** relied on deprecated `allowFullScreen` alone; Chrome gates fullscreen on the permission policy. `fullscreen` now delegated via `allow`.

Verified correct: Tweet (sandbox, text-only), Reddit (sandbox), poll cube, Spotify (×2), SandboxFrame (round-10 conservative nsite policy), Lightning Observatory, fal-live (round-21 fix).

## 22b — Encrypted settings fail-open (this commit)

**Finding:** when a decrypted NIP-78 settings blob failed `EncryptedSettingsSchema.safeParse`, both consumers in `useEncryptedSettings.ts` fell back to the **raw JSON cast to settings**:

```ts
return (json ?? {}) as EncryptedSettings;                    // parse path
currentSettings = ... : (json ?? {}) as EncryptedSettings;   // mutation path
```

The schema was therefore defeated precisely when the payload was malformed or hostile: a field that failed its check (relay allowlist, `https://`-only proxy/favicon templates, numeric bounds) was applied anyway. A compromised relay or old-format blob could redirect the CORS proxy, favicon service, or marketplace relays.

**Fix:** `sanitizePartialSettings()` in `src/lib/schemas.ts` salvages only fields that **individually** pass their schema (unknown keys and explicit-undefined dropped). Both call sites now use it — the "don't wipe everything" UX is preserved for mixed payloads, but no field can bypass validation.

**Regression coverage:** `src/lib/schemas.partialSettings.test.ts` — 6 tests including poison-drop (cleartext `ws://` relay, `http://` proxy templates, bad DSN, negative zap amount, wrong-typed boolean), mixed-payload salvage, unknown-key rejection, and agreement with the full schema on valid payloads.

## Verification

- `npx tsc --noEmit --incremental false` — pass
- `npx vitest run --reporter=dot --silent` — **1,878 tests passed** (187 files)
- `npx eslint --no-cache` — pass
- `npx vite build -l error` — pass
- `node scripts/security-scan.mjs` — 0 critical / 0 high
- `git diff --check` — clean
