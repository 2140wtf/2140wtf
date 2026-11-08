#!/usr/bin/env node
/**
 * Retired-host guard.
 *
 * On 2026-11-04 the dotted `bao.network` testnet hosts were retired and stopped
 * resolving (NXDOMAIN, checked against 1.1.1.1 and 8.8.8.8). A build can still
 * point at them and look fine in a developer's browser — DNS cache, a stale
 * /etc/hosts entry, or a still-open tab all hide the failure — while every
 * other visitor gets a markets page that renders but can never load. That is
 * exactly what shipped: `/bao/markets` asked `api.testnet.bao.network` for
 * data and got ERR_NAME_NOT_RESOLVED in both API and relay mode until #185.
 *
 * This check turns that class of regression into a red CI run before merge.
 *
 * Live replacements:
 *   API    https://api-testnet.bao.markets
 *   Relay  wss://relay-testnet.bao.markets
 *
 * Scope: tracked files that ship or configure the build — src/, public/,
 * scripts/, .github/ and index.html. Comments are ignored (the retirement is
 * documented in comments, and comments never ship). When a non-comment line
 * must legitimately name a retired host, e.g. a test asserting it is absent,
 * put `retired-host-ok` on that line.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Anything under `testnet.bao.network`, plus the bare apex. */
const RETIRED = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*testnet\.bao\.network(?![a-z0-9-])/i;

const SCAN_PREFIXES = ['src/', 'public/', 'scripts/', '.github/'];
const SCAN_ROOT_FILES = ['index.html'];
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|txt|ya?ml|html|css|toml)$/i;

/** This file names the retired hosts by design. */
const SELF = 'scripts/ci/no-retired-hosts.mjs';

const COMMENT_PREFIXES = ['//', '/*', '*', '#', '<!--', '-->'];
const ALLOW_MARKER = 'retired-host-ok';

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => file !== SELF)
    .filter((file) => SCAN_ROOT_FILES.includes(file) || SCAN_PREFIXES.some((p) => file.startsWith(p)))
    .filter((file) => TEXT_EXT.test(file));
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

const findings = [];
let scanned = 0;

for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable (submodule entry, broken symlink) — not ours to judge
  }
  if (text.includes('\0')) continue; // binary
  scanned++;

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    if (isCommentLine(line)) return;
    if (!RETIRED.test(line)) return;
    findings.push({ file, line: index + 1, text: line.trim().slice(0, 200) });
  });
}

if (findings.length === 0) {
  console.log(`retired-host guard: ${scanned} files scanned, no retired bao.network hosts.`);
  process.exit(0);
}

console.error(
  `retired-host guard: ${findings.length} reference(s) to a retired *.testnet.bao.network host.\n` +
    'Those names stopped resolving on 2026-11-04. Use the live hyphenated pair:\n' +
    '  API    https://api-testnet.bao.markets\n' +
    '  Relay  wss://relay-testnet.bao.markets\n',
);
for (const { file, line, text } of findings) {
  console.error(`  ${file}:${line}  ${text}`);
}
console.error(
  '\nIf the line only documents the retirement or asserts the host is absent, mark it ' +
    `with \`${ALLOW_MARKER}\` or move it into a comment.`,
);
process.exit(1);
