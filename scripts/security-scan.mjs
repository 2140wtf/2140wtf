#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { findCapabilityLeaks, redactedEvidence } from './security-scan-core.mjs';

const REPORT_PATH = 'security-scan-report.json';
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  // A worktree may contain tracked files staged or pending deletion. Do not
  // crash before scanning the files that still exist.
  .filter((file) => existsSync(file));

const sourceFiles = trackedFiles
  .filter((file) => /^(?:src|scripts)\//.test(file))
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
  .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));

const textExtensions = new Set([
  '', '.cjs', '.css', '.env', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const capabilityFiles = trackedFiles.filter((file) => textExtensions.has(extname(file).toLowerCase()));

/**
 * Files allowed to contain embedded BAO join/agent capabilities.
 *
 * src/lib/baosocial/rooms.ts is the bundled mirror of the PUBLIC room
 * directory served at www.2140.social/rooms.json. Its join links are app
 * configuration, not secrets: they ship inside every build (web, APK, IPA)
 * and are shared with every 2140.wtf / 2140.social user by design — the
 * room keys gate JOINING an open community room, exactly like the links
 * the operator hands out publicly. Excluding them here keeps the scan
 * meaningful for real leaks (nsecs, admin short links, split secrets).
 *
 * NOTE FOR OPERATORS: the "adm-open" / "adm-invite" rows in that file are
 * admin-room links living in a public repo. If those rooms are meant to
 * stay internal, rotate their invite secrets and move the replacement
 * links out of the bundled directory (e.g. behind the operator-only
 * directory fetch) — the allowlist only removes the CI noise, not the
 * exposure.
 */
const ALLOWED_CAPABILITY_FILES = new Set([
  'src/lib/baosocial/rooms.ts',
]);

const checks = [
  {
    severity: 'CRITICAL',
    category: 'Leaked Nostr secret key',
    pattern: /nsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}/g,
  },
  {
    severity: 'CRITICAL',
    category: 'Leaked PEM private key',
    pattern: /-----BEGIN[^\n]*(?:PRIVATE|RSA|EC) KEY-----\r?\n[A-Za-z0-9+/=\r\n]{40,}\r?\n-----END[^\n]*(?:PRIVATE|RSA|EC) KEY-----/g,
  },
  {
    severity: 'CRITICAL',
    category: 'Credential embedded in URL',
    pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/g,
  },
  {
    severity: 'CRITICAL',
    category: 'Hardcoded long secret',
    pattern: /(?:privateKey|private_key|privkey|secret|macaroon|rune|password)\s*[:=]\s*['"][0-9a-f]{64,}['"]/gi,
  },
  {
    severity: 'HIGH',
    category: 'Dynamic code execution',
    pattern: /(?:^|[;=(:,]\s*)\b(?:eval|new\s+Function|Function)\s*\(/gm,
  },
  {
    severity: 'HIGH',
    category: 'document.write usage',
    pattern: /\bdocument\.write\s*\(/g,
  },
];

const findings = [];

function addFinding(severity, category, file, content, index, value) {
  findings.push({
    severity,
    category,
    file,
    line: content.slice(0, index).split('\n').length,
    // Never copy a discovered credential into CI output or its retained
    // artifact. A fingerprint is enough to correlate and rotate it.
    evidence: redactedEvidence(value),
  });
}

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const check of checks) {
    for (const match of content.matchAll(check.pattern)) {
      addFinding(check.severity, check.category, file, content, match.index ?? 0, match[0]);
    }
  }
}

for (const file of capabilityFiles) {
  const content = readFileSync(file, 'utf8');
  for (const leak of findCapabilityLeaks(content)) {
    if (ALLOWED_CAPABILITY_FILES.has(file)) continue;
    addFinding('CRITICAL', leak.category, file, content, leak.index, leak.value);
  }
}

const trackedEnvironmentFiles = execFileSync('git', ['ls-files', '.env', '.env.local', '.env.*.local'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
for (const file of trackedEnvironmentFiles) {
  findings.push({
    severity: 'CRITICAL',
    category: 'Committed environment file',
    file,
    line: 1,
    evidence: { chars: 0, sha256: 'not-applicable' },
  });
}

const counts = {
  critical: findings.filter((finding) => finding.severity === 'CRITICAL').length,
  high: findings.filter((finding) => finding.severity === 'HIGH').length,
};
const report = {
  timestamp: new Date().toISOString(),
  scannedFiles: new Set([...sourceFiles, ...capabilityFiles]).size,
  counts,
  findings,
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`Scanned ${report.scannedFiles} repository text/source files.\n`);
process.stdout.write(`Critical: ${counts.critical}; high: ${counts.high}.\n`);
for (const finding of findings) {
  process.stdout.write(`::warning file=${finding.file},line=${finding.line}::${finding.severity}: ${finding.category}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## BAO Security Scan\n\n- Files scanned: ${report.scannedFiles}\n- Critical: ${counts.critical}\n- High: ${counts.high}\n`,
    { flag: 'a' },
  );
}

if (counts.critical > 0) process.exitCode = 1;
