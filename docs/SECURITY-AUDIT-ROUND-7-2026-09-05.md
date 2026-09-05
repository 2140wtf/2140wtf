# Security Audit — Round 7

**Date:** 2026-09-05
**Scope:** external profile media and URL rendering boundaries
**Status:** Complete; fixes committed locally

## Finding and fix

### R15 — Profile banners bypassed URL sanitization

The shared avatar path already sanitized profile pictures, but three banner renderers used `metadata.banner` directly: the main profile page, follow page, and profile hover card. A malicious NIP-01 profile could therefore cause viewers to request an HTTPS loopback, private-network, link-local, or `.local` resource. This is a browser-side network-probing/privacy issue, even though HTTPS scheme checks alone would pass.

**Fix:** Route all three banner renderers through `sanitizeUrl`. The sanitizer now rejects HTTPS URLs targeting local/private/link-local/local-name hosts, while retaining the existing HTTPS-only behavior for external metadata URLs. The profile lightbox also receives only the sanitized banner URL.

## Verification

- Focused URL and nsite trust-boundary tests: **31 passed**
- Full Vitest suite: **1,834 passed** across 176 files
- TypeScript: passed
- ESLint: passed
- Vite production build: passed
- Repository security scan: **0 critical, 0 high**

## Residual notes

- This is client-side SSRF/privacy hardening; it does not attempt to resolve DNS and cannot prevent a public hostname from later changing its DNS answer.
- Existing intentional local HTTP allowances remain for development-only service configuration and are not used by the profile metadata sanitizer.
- No production push or deployment was performed. This round is local-only.
