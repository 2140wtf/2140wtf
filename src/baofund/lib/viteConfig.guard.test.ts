/**
 * Dev-server dependency-optimizer guard.
 *
 * TWO `@cashu/cashu-ts` copies exist on purpose: the app's 4.11.0 at the root
 * and the vendored cashu-wallet's nested 2.9.0 (vendor pin - never replace).
 * The Vite dep optimizer keys a bare specifier to ONE resolved copy; with the
 * linked `@bao/cashu-wallet` in the graph it pre-bundled the VENDORED 2.9.0
 * for every importer, so the app's 4.x imports failed at runtime ("does not
 * provide an export named 'Amount'") and the dev app rendered blank while
 * `vite build` stayed green (round-4 harness find). `optimizeDeps.exclude`
 * makes the dev server resolve per importer: src → 4.11.0, vendor → 2.9.0.
 *
 * Source-level lock (the config cannot be imported under vitest: its
 * `import.meta.url` file URLs are not file-scheme there) so a future
 * "cleanup" cannot silently blank the dev app again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from the project root; `import.meta.url` is not a file URL here.
const source = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

describe('vite dev config guard', () => {
  it('excludes @cashu/cashu-ts from dep pre-bundling (two vendor-pinned copies)', () => {
    expect(source).toMatch(/optimizeDeps[\s\S]*?exclude:\s*\[[^\]]*['"]@cashu\/cashu-ts['"]/);
  });
});
