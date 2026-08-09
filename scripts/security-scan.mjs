#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const REPORT_PATH = 'security-scan-report.json';
const sourceFiles = execFileSync(
  'git',
  ['ls-files', 'src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.js', 'scripts/**/*.mjs'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));

const checks = [
  {
    severity: 'CRITICAL',
    category: 'Leaked Nostr secret key',
    pattern: /nsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}/g,
  },
  {
    severity: 'CRITICAL',
    category: 'Leaked PEM private key',
    pattern: /-----BEGIN[^\n]*(?:PRIVATE|RSA|EC) KEY-----/g,
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
    pattern: /\b(?:eval|Function)\s*\(/g,
  },
  {
    severity: 'HIGH',
    category: 'document.write usage',
    pattern: /\bdocument\.write\s*\(/g,
  },
];

const findings = [];
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const check of checks) {
    for (const match of content.matchAll(check.pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({
        severity: check.severity,
        category: check.category,
        file,
        line,
        match: match[0].slice(0, 160),
      });
    }
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
    match: 'Environment files may contain deployment secrets',
  });
}

const counts = {
  critical: findings.filter((finding) => finding.severity === 'CRITICAL').length,
  high: findings.filter((finding) => finding.severity === 'HIGH').length,
};
const report = {
  timestamp: new Date().toISOString(),
  scannedFiles: sourceFiles.length,
  counts,
  findings,
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`Scanned ${sourceFiles.length} source files.\n`);
process.stdout.write(`Critical: ${counts.critical}; high: ${counts.high}.\n`);
for (const finding of findings) {
  process.stdout.write(`::warning file=${finding.file},line=${finding.line}::${finding.severity}: ${finding.category}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## BAO Security Scan\n\n- Files scanned: ${sourceFiles.length}\n- Critical: ${counts.critical}\n- High: ${counts.high}\n`,
    { flag: 'a' },
  );
}

if (counts.critical > 0) process.exitCode = 1;
