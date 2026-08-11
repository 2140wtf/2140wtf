# Bug Hunting Report — 2140wtf

> Historical point-in-time report. Its completion claims are superseded by
> `EXTREME_AUDIT_REPORT_2026-08-02.md` and the subsequent regression fixes;
> consult the current source and test results for authoritative status.

**Date:** 2026-08-02
**Branch:** `fix/zap-qr-confirmation`
**Commit:** `4e6d2b83c`
**Scope:** Full `src/` tree (~200,500 lines across hooks, lib, components, pages, contexts, concord-v2, pets, wire)

> **Correction notice:** This is a historical working report covering multiple
> states of a concurrently changing dirty tree. Its initial pass and appended
> Round 2 have different validation results. The corrected interpretation,
> including dependency severity, E2E evidence, and the NIP-01 timestamp-tie rule,
> is maintained in `docs/EXTREME_AUDIT_REPORT_2026-08-02.md`.

---

## Executive Summary

A systematic bug hunt was conducted across the 2140wtf codebase, covering
security vulnerabilities, logic errors, race conditions, resource leaks,
Capacitor/native compatibility, and error-handling gaps.

**Test suite status during the initial pass (before the appended Round 2):**
- **Vitest:** 172 test files, 1895 tests — **all passing**
- **ESLint:** 0 errors, 2 warnings (`react-refresh/only-export-components`, non-bugs)
- **TypeScript (`tsc --noEmit`):** passes

**7 issues found** (1 High, 2 Medium, 3 Low, 1 Informational). The codebase is
generally well-engineered with strong security practices; the issues below are
edge cases and compatibility gaps rather than systemic problems.

| # | Severity | File | Summary |
|---|----------|------|---------|
| 1 | **High** | `AgentJoinPanel.tsx` | nsec key download silently fails on native (Capacitor) |
| 2 | **Medium** | `ShopMapPopup.tsx` | `window.open()` bypasses `openUrl()` — directions fail on native |
| 3 | **Medium** | `useOpenPost.ts` | `window.open()` bypasses `openUrl()` — middle-click no-op on native |
| 4 | **Low** | `deduplicateEvents.ts` | Inconsistent tie-breaking vs. other dedup paths |
| 5 | **Low** | `hdWallet.ts` | No-op regex `.replace(/'/g, "'")` — confusing dead code |
| 6 | **Low** | `hdWallet.ts` | `parseBip32Path` missing NaN guard + incomplete hardened-marker support |
| 7 | **Info** | `useZaps.ts` | State setters in unmount cleanup (harmless no-op in React 18+) |

---

## Detailed Findings

### 1. [High] AgentJoinPanel — nsec key download silently fails on native

**File:** `src/concord-v2/components/AgentJoinPanel.tsx:176–185`

```ts
const handleDownloadNsec = () => {
  if (!createdNsec) return;
  const blob = new Blob([createdNsec], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bao-agent-key.txt";
  a.click();
  URL.revokeObjectURL(url);
};
```

**Problems:**
1. **Violates AGENTS.md.** The project guidelines explicitly state:
   > **Always use** `downloadTextFile(filename, content)` and `openUrl(url)` from
   > `@/lib/downloadFile` — they bridge web and native automatically. **Never use**
   > `document.createElement('a')` with `.click()`.
   The canonical `downloadTextFile()` appends the anchor to `document.body`,
   clicks, removes it, and revokes the URL — and on native it writes to the
   app's Documents directory via the Capacitor Filesystem plugin instead.

2. **Silently fails on Capacitor native (WKWebView).** `<a download>` file
   downloads do not work inside WKWebView. The click appears to succeed but no
   file is saved. The user believes they backed up their agent's `nsec` when
   they did not — **potential permanent key loss**.

3. **Anchor not appended to DOM.** Unlike `downloadTextFile()`, this code does
   not call `document.body.appendChild(a)` before `.click()`. Some browsers
   (notably older Safari) will not trigger a download for a detached anchor.

**Fix:**
```ts
import { downloadTextFile } from '@/lib/downloadFile';

const handleDownloadNsec = async () => {
  if (!createdNsec) return;
  await downloadTextFile('bao-agent-key.txt', createdNsec);
};
```

---

### 2. [Medium] ShopMapPopup — `window.open()` bypasses `openUrl()`

**File:** `src/components/btcmap/ShopMapPopup.tsx:52–56`

```ts
const handleNavigate = () => {
  if (!isValidCoordinate(shop.lat, shop.lon)) return;
  const url = `https://www.openstreetmap.org/directions?from=&to=${shop.lat},${shop.lon}`;
  window.open(url, '_blank', 'noopener,noreferrer');
};
```

**Problem:** Uses `window.open()` directly instead of `openUrl()` from
`@/lib/downloadFile`. On Capacitor native, `window.open()` may be blocked
without user-gesture context or open an unexpected system browser. The
project's `openUrl()` presents the native share sheet on mobile, which is the
intended UX. AGENTS.md documents this:

> **`window.open()`** may be blocked without user-gesture context.

**Impact:** The "Get Directions" button fails or behaves inconsistently on
mobile.

**Fix:**
```ts
import { openUrl } from '@/lib/downloadFile';

const handleNavigate = async () => {
  if (!isValidCoordinate(shop.lat, shop.lon)) return;
  const url = `https://www.openstreetmap.org/directions?from=&to=${shop.lat},${shop.lon}`;
  await openUrl(url);
};
```

---

### 3. [Medium] useOpenPost — `window.open()` bypasses `openUrl()`

**File:** `src/hooks/useOpenPost.ts:13–17`

```ts
const onAuxClick = (e: React.MouseEvent) => {
  if (e.button !== 1) return;
  e.preventDefault();
  window.open(path, '_blank');
};
```

**Problem:** Middle-click handler uses `window.open()` directly. On Capacitor
native, this either does nothing or opens the system browser to
`capacitor://localhost/<path>`, which fails to resolve. The project's `openUrl()`
would present the share sheet instead.

**Impact:** Middle-click "open in new tab" is a no-op or error on mobile.
Low user impact (middle-click is a desktop-only affordance) but inconsistent
with project conventions.

**Fix:** Use `openUrl()` or guard with `Capacitor.isNativePlatform()` and
no-op on native.

---

### 4. [Low] deduplicateEvents — non-deterministic tie-breaking

**File:** `src/lib/deduplicateEvents.ts:55–60`

```ts
} else if (key === event.id) {
  // Regular event — same id means same event, skip.
} else if (event.created_at > existing.created_at) {
  // Replaceable / addressable — keep the newer version.
  best.set(key, event);
}
```

**Problem:** Uses strict `>` for `created_at` comparison. When two versions of
a replaceable/addressable event share the same `created_at` timestamp, the
**first-encountered** version is kept (the `>` is false, so `best.set` is not
called).

Other dedup code in the codebase uses `>=`, which keeps the **last-encountered**:

- `src/hooks/useStreamPosts.ts:355` — `existing.created_at >= event.created_at`
- `src/hooks/useStreamKind.ts:64` — `existing.created_at >= event.created_at`

**Impact:** Low — unix-second timestamp ties are rare. But the inconsistency
means that the same set of events could produce different "latest" selections
depending on which dedup path processes them. If a malicious actor publishes
two versions of an addressable event with the same timestamp, the "winner"
depends on relay response order — unpredictable behavior.

**Correct fix:** NIP-01 specifies that equal-timestamp replaceable events retain
the lexicographically lowest event ID. Merely changing `>` to `>=` swaps
first-encountered for last-encountered and remains relay-order-dependent. Use a
timestamp-then-lowest-ID comparison consistently in every deduplication path.

---

### 5. [Low] hdWallet — no-op regex character replacement

**File:** `src/lib/hdWallet.ts:358`

```ts
const match = path.match(
  new RegExp(`^${BITCOIN_WALLET_PATH.replace(/'/g, "'")}/(\\d+)/(\\d+)$`)
);
```

**Problem:** `.replace(/'/g, "'")` replaces the apostrophe character with
itself — a complete no-op. `BITCOIN_WALLET_PATH` is `"m/86'/0'/0'"`, which
contains apostrophes. The RegExp constructor does not require `'` to be
escaped, so the regex works correctly. But the `.replace()` call is confusing
dead code that suggests an incomplete refactoring (the author may have intended
to escape a different character, or escape for a different string context).

**Impact:** None functionally. The regex matches correctly. But it misleads
future readers into thinking the replace does something.

**Fix:** Remove the `.replace(/'/g, "'")` call:
```ts
const match = path.match(
  new RegExp(`^${BITCOIN_WALLET_PATH}/(\\d+)/(\\d+)$`)
);
```

---

### 6. [Low] hdWallet — parseBip32Path missing NaN guard + incomplete markers

**File:** `src/lib/hdWallet.ts:336–344`

```ts
export function parseBip32Path(path: string): number[] {
  const parts = path.replace(/^m\//, '').split('/');
  return parts.map((part) => {
    if (part.endsWith("'")) {
      return parseInt(part.slice(0, -1), 10) + HARDENED_OFFSET;
    }
    return parseInt(part, 10);
  });
}
```

**Problems:**
1. **No NaN guard.** `parseInt(part, 10)` returns `NaN` for non-numeric or
   empty segments. A malformed path like `"m/86'/0'/0'/abc/5"` would produce
   `[NaN+HARDENED_OFFSET, ...]` — `NaN` propagates through all arithmetic,
   producing a garbage derivation path. The HDKey library would either throw or
   derive from an undefined index.

2. **Incomplete hardened-marker support.** BIP-32 allows three suffixes for
   hardened derivation: `'`, `h`, and `H`. This function only handles `'`.
   Paths using `h`/`H` (e.g., `"m/86h/0h/0h/0/5"`) would be parsed as
   non-hardened with `parseInt("86h", 10)` → `86` (parseInt stops at the `h`),
   silently deriving the wrong (non-hardened) path.

**Impact:** Low — this function is typically called with validated, internally-
generated paths that always use `'`. But if it ever receives untrusted or
alternative-format input, it could derive from incorrect indices, potentially
sending funds to wrong addresses.

**Fix:**
```ts
export function parseBip32Path(path: string): number[] {
  const parts = path.replace(/^m\//, '').split('/');
  return parts.map((part) => {
    const isHardened = part.endsWith("'") || part.endsWith('h') || part.endsWith('H');
    const numStr = isHardened ? part.slice(0, -1) : part;
    const idx = parseInt(numStr, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      throw new Error(`Invalid BIP-32 path segment: "${part}"`);
    }
    return isHardened ? idx + HARDENED_OFFSET : idx;
  });
}
```

---

### 7. [Informational] useZaps — state setters in unmount cleanup

**File:** `src/hooks/useZaps.ts:62–68`

```ts
useEffect(() => {
  return () => {
    setIsZapping(false);
    setInvoice(null);
    zapInFlightRef.current = false;
  };
}, []);
```

**Problem:** The cleanup function calls `setIsZapping(false)` and
`setInvoice(null)` during component unmount. In React 18+, setting state during
unmount is a silent no-op (the "Can't perform a React state update on an
unmounted component" warning was removed). The `zapInFlightRef.current = false`
line is the only useful part — ref mutations in cleanup are fine.

**Impact:** None functionally. The state setters are dead code on unmount. This
is a code-cleanliness issue, not a runtime bug.

**Fix:** Remove the state setters, keep only the ref reset:
```ts
useEffect(() => {
  return () => {
    zapInFlightRef.current = false;
  };
}, []);
```

---

## Security Review — Positive Findings

The codebase demonstrates strong, systematic security practices. The following
were verified as correct during this review:

| Area | File | Assessment |
|------|------|------------|
| **NIP-17 DM encryption** | `src/lib/nip17.ts:235–239` | Verifies seal author === rumor author; validates rumor shape; checks event hash. Prevents impersonation. |
| **Zap amount verification** | `src/hooks/useZaps.ts:261–263` | Verifies returned invoice msats exactly match requested amount. Prevents wrong-amount payment via compromised LNURL. |
| **BOLT11 parsing** | `src/lib/zaps.ts:88–105` | Uses `light-bolt11-decoder`; never throws; validates `Number.isFinite` and `> 0`. |
| **URL sanitization** | `src/lib/sanitizeUrl.ts` | Enforces HTTPS-only; comprehensive local-network, relay, and template checks. |
| **HTML escaping** | `src/components/events/EventsMap.tsx:19–23` | `escapeHtml` properly escapes `& < > " '` before `innerHTML` with event data. |
| **Cashu mint validation** | `src/lib/cashu/cashu.ts:557–579` | Strict numeric IPv4 check (prior bug fixed per changelog); rejects private/local hosts. |
| **No XSS vectors** | — | No `dangerouslySetInnerHTML` with untrusted data; no `eval()`/`new Function()` in app code; no `document.write()`. |
| **Event verification** | multiple | `verifyEvent` used in zap receipts, NIP-17 seals, DMs, group chat. |
| **Cross-tab wallet lock** | `src/lib/cashu/storage.ts:497–620` | Lease-based lock with renewal, invalidation on lease loss, and IndexedDB CAS. Prevents concurrent proof writes. |
| **AbortController cleanup** | multiple hooks | All `setTimeout(() => controller.abort())` patterns properly `clearTimeout` in `finally` blocks. |
| **Object URL cleanup** | `src/lib/downloadFile.ts`, `src/lib/stripMetadata.ts` | `URL.revokeObjectURL` called in `finally` blocks. |
| **NWC timeout** | `src/hooks/useNWC.ts:107–126` | `Promise.race` timeout is cleared in both success and error paths. |

---

## Methodology

The bug hunt was conducted using the following approach:

1. **Static analysis:** Regex-based searches across all 1,757 source files for
   common bug patterns: `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
   `new Function`, `insertAdjacentHTML`, `document.write`, `__proto__`,
   `parseInt` without radix, `isNaN`, `Promise.race` (timeout leak check),
   `setInterval`/`setTimeout` (cleanup check), `URL.createObjectURL`/
   `revokeObjectURL` (leak check), `addEventListener` (cleanup check),
   `window.open`/`location.assign` (native compat check), `document.createElement('a')`
   (download pattern check), and more.

2. **Manual code review:** Focused deep-reads of security-critical and
   money-handling code: NIP-17 encryption, zap payment flow, BOLT11 parsing,
   Cashu wallet storage/lock, HD wallet derivation, Bitcoin amount parsing,
   URL sanitization, event deduplication, and NWC connection handling.

3. **Test suite execution:** Full `npm run test` (tsc + eslint + vitest + vite
   build). All 1895 tests pass; 0 eslint errors.

4. **Dependency-array audit:** Reviewed `eslint-disable-next-line
   react-hooks/exhaustive-deps` suppressions (58 found) for correctness.

5. **AGENTS.md compliance check:** Verified adherence to project-specific
   guidelines (Capacitor compatibility, URL sanitization, event verification,
   no `any` type, download/open-url patterns).

---

## Recommendations

1. **Fix Issue #1 immediately** — the nsec download failure on native can cause
   permanent key loss for agent identities. This is a one-line fix
   (`downloadTextFile`).

2. **Audit all `window.open()` and `<a download>` usages** for native
   compatibility. Issues #1–#3 are the same class of problem (web-only API
   used without the `openUrl`/`downloadTextFile` bridge).

3. **Standardize the dedup tie-breaking convention** (Issue #4) across all
   event-deduplication paths to prevent inconsistent "latest version"
   selection.

4. **Add NaN validation to `parseBip32Path`** (Issue #6) and support `h`/`H`
   hardened markers for BIP-32 compatibility.

5. **Consider adding a lint rule** that flags `document.createElement('a')`
   combined with `.click()` to prevent future regressions of Issue #1.

---



---

## Security Review — Round 2 (after fixes)

After applying the Round-1 fixes, a second source-review pass was run.
This round focused on **attack-surface tracing**: event-sourced URLs
landing in `<img src>`/`<a href>`, markdown/HTML injection, local-network SSRF
priming, and verification that the Round-1 fixes behave as intended.

**Result:** 2 more genuine issues found and fixed, 1 verified false positive,
1 lower-severity observation, and 3 pre-existing failures ruled out as unrelated
to this work.

### Round-2 fix: unsanitized event-sourced URLs in raw `<img src>`

Pen-probing found the `AvatarImage`/`SafeImage` sanitation layer is bypassed in
three components that drop an event-sourced URL straight into a raw `<img src>`
without `sanitizeUrl()`. Per AGENTS.md, *every* event-sourced URL must be
sanitized before `src`. These were **fixed**:

| File | Line | URL source | Fix |
|------|------|-----------|-----|
| `src/components/SavedFeedFiltersEditor.tsx` | ~521 | `metadata.picture` (kind-0) | `sanitizeUrl(...)` |
| `src/components/chat/ProfilePreviewCard.tsx` | ~77 | `metadata.banner` (kind-0) | `sanitizeUrl(...)` |
| `src/pages/RelayPage.tsx` | ~179, 186 | relay NIP-11 `banner`/`icon` | `sanitizeUrl(...)` |

**Why this matters:** a hostile profile can set `picture`/`banner` to
`http://localhost:8332` or `http://192.168.x.x`. Because the `<img>` is rendered
unsanitized, every viewer trips the browser's local-network access prompt and
leaks whether they run a local Bitcoin node — the exact threat the project's own
`isLocalNetworkUrl` helper documents. `sanitizeUrl()` (HTTPS-only) blocks these
and all `javascript:`/`data:` URLs.

### Verified false positive (important)

All other `metadata.picture` usages (ProfileCard, MentionAutocomplete, search
dropdowns, account switchers, etc.) pass through the shared `<AvatarImage>`
component, which applies `sanitizeUrl(rawSrc)` internally
(`src/components/ui/avatar.tsx`). These are **safe** — they were NOT flagged.

### Lower-severity observation (not bluntly fixed)

`src/components/chat/ChatComposer.tsx:2028` renders `<img src={resolved.src}>`
where `resolved` comes from `useResolvedMediaSrc`. For *plain* (non-encrypted)
refs it returns the raw URL; for encrypted refs it returns a `blob:` object URL.
`sanitizeUrl()` would reject the legitimate `blob:` object URLs, so it cannot be
applied at that layer. The plain-URL path is event-sourced in principle. We left
it as-is (a blunt sanitize would break encrypted-attachment previews) and list
it here as a known, low-risk edge to revisit at the parse layer.

### Round-1 fixes re-verified

- `parseBip32Path` change preserves original behavior: `HARDENED_OFFSET =
  2147483648` (2^31); `"86'"` still yields `86 + 2^31 = 2147483734`; all 20
  `hdWallet.test.ts` tests pass. `h`/`H` now also harden; invalid segments now
  throw instead of silently producing `NaN`.
- `AgentJoinPanel`/`ShopMapPopup`/`useOpenPost` now route through
  `downloadTextFile`/`openUrl` with native guards.
- The first `deduplicateEvents` edit changed tie-breaking to `>=`, matching the
  streaming paths but not NIP-01. A later live-tree correction uses the
  lexicographically lowest ID and adds an order-independence test; streaming
  paths still require the same deterministic comparison.
- `useZaps` unmount cleanup now only resets the ref.

### Pre-existing failures (NOT caused by this work) — flagged for the team

The working tree already contained uncommitted Concord-v2 transport work
(`NostrProvider`, `WireSync`, `controlPlaneSync`, `planeSync`, `useRoles2`,
untracked `concordTransport.ts`, etc.) before this session began. That work is
responsible for two pre-existing failures that are **outside the scope of these
changes**:

1. **tsc errors** in `src/concord-v2/hooks/useRoles2.ts:175,190` —
   `NPool<NRelay>` not assignable to `CommunityV2`.
2. **Failing test** `src/concord-v2/hooks/useControlPlane2.test.tsx ›
   useControlEvents2 — on-open sweep` (`assertion: expected [] to include
   '405eac62...'`).

None of the files touched by this bug-hunt/pen-test appear in the tsc error
output, and the failing test does not exercise any fixed code path. These should
be addressed by whoever owns the in-flight Concord transport refactor.

---

## Round-2 Validation Summary

These results supersede the initial-pass whole-tree status above for the later
dirty-tree state; they do not mean the targeted fixes themselves failed.

- **ESLint**: all 9 modified files — 0 errors.
- **Targeted tests**: `hdWallet.test.ts` (20) + `useZaps.test.ts` (11) — 31/31 passed.
- **Full suite**: 1899 passed / 1 failed (`useControlPlane2.test.tsx`, pre-existing).
- **tsc**: only pre-existing `useRoles2.ts` errors remain; none from modified files.

*Appended 2026-08-02 — Round 2 (post-fix deep penetration testing)*
