# Security Audit — Round 6

**Date:** 2026-09-05
**Scope:** nsite manifest resolution, Blossom server selection, sandbox content delivery
**Status:** Complete; fixes committed locally

## Findings and fixes

### R12 — Untrusted nsite server tags could select unsafe fetch targets

Nsite `server` tags were accepted whenever they parsed as URLs. That allowed an event author to nominate non-HTTPS endpoints, local/private-network addresses, or URLs containing embedded credentials. A preview would then fetch from attacker-selected infrastructure in the viewer's browser, creating local-network probing and credential-leak risk.

**Fix:** Added a dedicated `isAllowedBlossomUrl` policy and apply it to nsite event servers and app fallback servers. Nsite content servers now require HTTPS, reject userinfo, and reject loopback, private, link-local, `.local`, and other local-network targets. Invalid event entries are ignored; the configured fallback list is used only when no valid event server remains.

### R13 — Manifest paths and hashes were not validated

The preview accepted arbitrary `path` and hash tag values. Malformed paths could create ambiguous routing behavior, while non-digest values could be interpolated into remote content URLs.

**Fix:** Added bounded canonical-path validation, encoded traversal rejection, and strict lowercase 64-character SHA-256 validation. Only validated entries are added to the manifest.

### R14 — Blossom responses were trusted without content-address verification

A successful HTTP response from any selected Blossom mirror was served directly to the sandbox. A compromised or incorrect mirror could therefore replace a manifest-selected JavaScript or HTML file with arbitrary content.

**Fix:** Hash every fetched blob with SHA-256 and serve it only when it matches the manifest digest. Invalid responses are discarded and the next trusted mirror is attempted.

## Verification

- Focused nsite/sanitization tests: **28 passed**
- Full Vitest suite: **1,831 passed** across 176 files
- TypeScript: passed
- ESLint: passed
- Vite production build: passed
- Repository security scan: **0 critical, 0 high**

## Residual notes

- The browser still makes requests to the selected public Blossom origins by design; server allowlisting is a client-side trust boundary, not a replacement for network-layer controls.
- Nsite event authenticity remains dependent on the upstream Nostr event verification/query path.
- No production push or deployment was performed. This round is local-only.
