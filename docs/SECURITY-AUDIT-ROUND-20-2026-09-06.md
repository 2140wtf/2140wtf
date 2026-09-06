# Security Audit — Round 20 (2026-09-06)

**Focus:** rich-text/Markdown rendering boundaries and the remaining unbounded file-read paths.

**Scope:** local verification on branch `security/audit-rounds-3-14`; routine branch push, no deploy.

## Findings

### F-20-1: Article editor base64 fallback read unbounded images into the document (Medium — resource exhaustion / document bloat)

`src/components/articles/MilkdownEditor.tsx` — when no upload handler is wired, pasted/dropped images fell back to `FileReader.readAsDataURL()` with no size check. The resulting data URL is embedded in the ProseMirror document and re-serialized on every save, so a single large image both balloons memory (~4/3× inflation) and permanently inflates the stored markdown.

**Fix:** the fallback now runs the shared validator (`validateUploadFile` with `MAX_PREVIEW_DATA_URL_SIZE`, 10 MB) and silently skips oversized images — the upload-handler path (the normal path in production) remains the recommended route and already goes through the round-19 bounded `useUploadFile`.

### F-20-2: Login key-file import read unbounded files via `readAsText` (Medium — resource exhaustion)

`src/components/auth/LoginDialog.tsx` — the "import key from file" path called `reader.readAsText(file)` on a file of any size before validating its content. A hostile or accidental multi-gigabyte selection would be read fully into memory in the login dialog.

**Fix:** reject empty or >1 MB files up front with a clear error and reset the input, before any read. A valid nsec key file is a single short line, so the bound cannot reject legitimate imports.

### Non-findings checked (rendering boundaries)

- `ArticleContent.tsx` (kind-30023 rendering): `react-markdown` + `rehype-sanitize`; `a`/`img` overrides pass through `sanitizeUrl`; unsafe hrefs render as plain text. **Safe.**
- Chat Markdown (`lib/markdown.ts` + `components/chat/Markdown.tsx`): custom safe parser, no raw HTML path. **Safe.**
- `sanitizeSvg.ts` / `sanitizePetsSvg.ts`: isolated DOMPurify instances, strict allowlists, 256 KB length cap, reject-on-oversize. **Safe.**
- `WikipediaPage.tsx`: HTML stripped via `DOMPurify.sanitize(..., { ALLOWED_TAGS: [] })`. **Safe.**
- SVG renderers use `dangerouslySetInnerHTML` only post-sanitization. **Safe.**

## Verification

- `npx tsc --noEmit --incremental false` — pass
- `npx vitest run --reporter=dot --silent` — **1,870 tests passed** (185 files)
- `npx eslint --no-cache` — pass
- `npx vite build -l error` — pass
- `node scripts/security-scan.mjs` — 0 critical / 0 high
- `git diff --check` — clean
