# Security Audit — Round 19 (2026-09-06)

**Focus:** file import/upload validation (client-side resource exhaustion and fail-fast boundaries).

**Scope:** local verification on branch `security/audit-rounds-3-14`; routine branch update push only, no deploy.

## Findings

### F-19-1: No client-side size bound on any Blossom upload (High — resource exhaustion)

`src/hooks/useUploadFile.ts` is the single choke point for every upload in the app (badges, avatars/banners, chat attachments, articles, marketplace/auction/art listings, emoji packs, pet rooms, theme backgrounds/fonts, compute-credit imagery — ~20 call sites). It performed **no** size or emptiness validation:

- An accidental (or crafted, via drag-and-drop) multi-gigabyte selection was passed straight to `stripFileMetadata()`, which may decode media in memory, and then streamed to the blob server before anything rejected it.
- Empty files (0 bytes) produced a signed upload and a content-addressed URL pointing at nothing.

**Fix:** added `src/lib/fileValidation.ts` with `validateUploadFile()` and `MAX_UPLOAD_SIZE` (100 MB, per-file hard ceiling) plus `MAX_PREVIEW_DATA_URL_SIZE` (10 MB, for data-URL previews). The central hook now fails fast with new stable error codes **UPLOAD_005** (too large) / **UPLOAD_006** (empty) *before* any file read, metadata stripping, or network I/O. Validation is synchronous (`File.size` is metadata) and treats non-finite sizes as empty rather than trusting them.

### F-19-2: Badge image previews base64-amplify unbounded files into React state (Medium — resource exhaustion)

`src/components/CreateBadgeDialog.tsx` and `src/pages/BadgesPage.tsx` (`EditBadgeForm`) validated the MIME type but then ran `FileReader.readAsDataURL()` on the selected file, holding a ~4/3×-sized base64 string in component state before uploading.

**Fix:** both handlers now apply the shared validator with the 10 MB preview ceiling before reading the file, and surface `describeUploadRejection()` text in the existing toast.

### Non-findings checked

- `pets/three-d` SVG/GLB uploads already enforced 1 MB / 25 MB limits via their own validators — left unchanged.
- `readResponseBytes` bounds (round 12) already cover the network-response side; this round closes the user-selected-file side.
- `useNsecPasteGuard` paste interception and `lib/clipboard.ts` read/write boundaries reviewed; no defects.

## Error-code registry additions

| Code | Meaning | Hint |
|---|---|---|
| `UPLOAD_005` | File too large to upload | Choose a file of 100 MB or smaller, or compress it first. |
| `UPLOAD_006` | File is empty | Check the file and pick it again. |

## Verification

- `npx tsc --noEmit --incremental false` — pass
- `npx vitest run --reporter=dot --silent` — **1,870 tests passed** (185 files), including new `src/lib/fileValidation.test.ts` (7 tests) and `src/hooks/useUploadFile.test.tsx` (2 regression tests proving rejection happens before `stripFileMetadata` or server contact)
- `npx eslint --no-cache` — pass
- `npx vite build -l error` — pass
- `node scripts/security-scan.mjs` — 0 critical / 0 high
- `npm audit --audit-level=high --omit=dev` — 0 vulnerabilities
- `git diff --check` — clean
