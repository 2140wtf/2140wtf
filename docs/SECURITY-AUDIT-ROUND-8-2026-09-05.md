# Security Audit — Round 8

**Date:** 2026-09-05
**Scope:** event-sourced images and external API media rendering
**Status:** Complete; fixes committed locally

## Finding and fix

### R16 — Event and API image fields bypassed the shared safe-image boundary

Several renderers passed untrusted `image` or external API image values directly into raw `<img src>` elements. Affected surfaces included calendar events, communities, stream cards, video stream cards, Wikipedia cards/search results, and the Wikipedia-derived external-content header. This bypassed the centralized HTTPS and local-network checks used by `SafeImage` and could request private/local-network resources from attacker-controlled event data or compromised API responses.

**Fix:** Sanitize event image tags before rendering and use the existing `SafeImage` component for the affected direct image surfaces. Wikipedia-derived hero, thumbnail, and search images now pass through the same policy. Unsafe or missing images render no image rather than issuing a browser request.

## Verification

- Focused URL/nsite trust-boundary tests: **31 passed**
- Full Vitest suite: **1,834 passed** across 176 files
- TypeScript: passed
- ESLint: passed
- Vite production build: passed
- Repository security scan: **0 critical, 0 high**

## Residual notes

- This round hardens image request destinations; media playback URLs and stream URLs remain separate protocol-specific surfaces for later review.
- The sanitizer is intentionally HTTPS-only for untrusted content and rejects local/private/link-local/local-name destinations.
- No production push or deployment was performed. This round is local-only.
