// src/lib/nip98Transport.guard.test.ts
//
// The NIP-98 header NAME is a transport decision owned by `fundHttp`:
// same-origin callers must ride `X-Nostr-Auth` (so the nginx access gate
// keeps the browser's Basic `Authorization`), cross-origin callers the
// standard `Authorization` (the API's CORS allowlist exposes only that one).
// A call site that hand-rolls either name silently regresses the gated hosts
// - the round-3 smoke caught exactly that: `ChatPanel` sent
// `Authorization: Nostr …` to a same-origin `/fund-api` URL and the gate 401'd
// before the API saw the request. Keep the decision in one file; use
// `fundFetch`/`fundRequest` or `nip98AuthHeaders` everywhere else.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Vitest runs from the project root; `import.meta.url` is not a file URL here.
// 2140: only the vendored fund boundary is under this rule; the host app's
// legacy code is out of scope for the fund transport guard.
const SRC_DIR = join(process.cwd(), 'src', 'baofund');
const ALLOWED = new Set(['fundHttp.ts']);

/** Header names that only the boundary may write. */
const HAND_ROLLED_HEADER = [
  /['"]Authorization['"]\s*:/,
  /\.Authorization\s*=/,
  /['"]X-Nostr-Auth['"]/,
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
  }
  return files;
}

it('only the fundHttp boundary names the NIP-98 transport header', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    if (ALLOWED.has(file.split('/').pop() ?? '')) continue;
    const text = readFileSync(file, 'utf8');
    if (HAND_ROLLED_HEADER.some((pattern) => pattern.test(text))) {
      offenders.push(relative(process.cwd(), file));
    }
  }
  expect(offenders).toEqual([]);
});
