#!/usr/bin/env node
/**
 * Production-scoped dependency audit.
 *
 * Why this exists: the CI "Audit production dependencies" step used
 * `npm audit --omit=dev --audit-level=high`, but npm 10 reports the whole
 * lockfile regardless of `--omit` (`--production`, `--package-lock-only` and
 * `--omit=dev` all return identical totals). The result was a job that always
 * failed on dev-only build tooling — tailwindcss 3 → chokidar/micromatch →
 * braces, and `braces` has no patched release at all — while claiming to audit
 * production.
 *
 * This script audits exactly what the job says: a finding fails the build only
 * when the vulnerable package is reachable in a production install (the
 * lockfile marks it without `dev: true`). Dev-only findings are printed and
 * written to the step summary, never silently dropped, so the tree state stays
 * visible.
 *
 * Usage: node scripts/audit-production.mjs [--level=high]
 * Writes audit-results.json (the raw `npm audit --json` output) for the CI
 * artifact.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const level = (process.argv.find((a) => a.startsWith('--level=')) ?? '--level=high').split('=')[1];
const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const threshold = SEVERITY_ORDER.indexOf(level);
if (threshold === -1) {
  console.error(`audit-production: unknown level "${level}"`);
  process.exit(2);
}

let raw;
try {
  // npm audit exits non-zero when it finds anything; capture stdout regardless.
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  raw = err.stdout?.toString() ?? '';
  if (!raw) {
    console.error('audit-production: npm audit produced no output');
    console.error(err.stderr?.toString() ?? String(err));
    process.exit(2);
  }
}

writeFileSync('audit-results.json', raw);
const report = JSON.parse(raw);
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

/** True when the lockfile entry for this path is part of a production install. */
function isProductionNode(path) {
  const entry = lock.packages?.[path];
  // Unknown path: treat as production so a resolver change cannot hide a finding.
  if (!entry) return true;
  return entry.dev !== true;
}

const prodFindings = [];
const devFindings = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (SEVERITY_ORDER.indexOf(vuln.severity) < threshold) continue;
  const nodes = vuln.nodes?.length ? vuln.nodes : [`node_modules/${name}`];
  const entry = { name, severity: vuln.severity, nodes };
  if (nodes.some(isProductionNode)) prodFindings.push(entry);
  else devFindings.push(entry);
}

const counts = report.metadata?.vulnerabilities ?? {};
const summary = [
  '## Dependency Audit (production scope)',
  '',
  `- Audit total: ${counts.total ?? 0} (critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, moderate ${counts.moderate ?? 0})`,
  `- Production findings at >=${level}: ${prodFindings.length}`,
  `- Dev-only findings at >=${level} (reported, not blocking): ${devFindings.length}`,
];
if (devFindings.length) {
  summary.push('', 'Dev-only (no production reachability):');
  for (const f of devFindings) summary.push(`- ${f.severity} ${f.name}`);
}
if (prodFindings.length) {
  summary.push('', 'Production findings:');
  for (const f of prodFindings) summary.push(`- ${f.severity} ${f.name}`);
}
const text = summary.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

process.exit(prodFindings.length ? 1 : 0);
