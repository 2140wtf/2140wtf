import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('CI security policy', () => {
  it('fails the production dependency audit at high severity', () => {
    const workflow = read('.github/workflows/security-scan.yml');

    // `npm audit --omit=dev` cannot scope on npm 10 (it reports the whole
    // lockfile), so the gate is the production-scoped script instead. The
    // severity must stay high and the script must remain the runner.
    expect(workflow).toContain('node scripts/audit-production.mjs --level=high');
    expect(workflow).not.toContain('--level=critical');
    expect(workflow).not.toContain('npm audit --omit=dev');
  });

  it('exits non-zero when a production finding reaches the threshold', () => {
    const script = read('scripts/audit-production.mjs');

    expect(script).toContain("'--level=high'");
    expect(script).toContain('process.exit(prodFindings.length ? 1 : 0)');
    expect(script).toContain('return entry.dev !== true');
    // An unknown lockfile path must fail open (counted as production).
    expect(script).toContain('if (!entry) return true;');
  });
});
