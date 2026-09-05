import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI security policy', () => {
  it('fails the production dependency audit at high severity', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/security-scan.yml'),
      'utf8',
    );
    expect(workflow).toContain('npm audit --omit=dev --audit-level=high --json');
    expect(workflow).not.toContain('npm audit --omit=dev --audit-level=critical --json');
  });
});
