/**
 * scripts/backup-secrets.sh - foreign-tree and nested-passphrase regressions.
 *
 * Hunt (backup-secrets-foreign-tree): the run-tmp picker walked
 * `$BAO_BACKUP_RUN_TMP` → `$HOME/bao_fund_it/.run-tmp` → `$REPO_ROOT/.run-tmp`
 * and took the FIRST EXISTING one, so on a shared box it archived ANOTHER
 * checkout's identities; and the passphrase exclusion was `-maxdepth 1` in
 * `secrets/`, so a passphrase file nested deeper rode inside the archive.
 *
 * These tests spawn the DEPLOYED script with an isolated HOME/out dir and a
 * `none` remote (no SSH), then decrypt-list the archive through the script's
 * own `verify` command. gpg presence is required; the suite skips without it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'scripts/backup-secrets.sh');
const REPO_RUN_TMP = resolve(process.cwd(), '.run-tmp');
const HAS_GPG = spawnSync('gpg', ['--version'], { stdio: 'ignore' }).status === 0;
// Never hijack a real checkout's identity store: only run the default-tree
// case when this checkout has no .run-tmp yet (a fresh worktree/CI).
const REPO_RUN_TMP_FREE = !existsSync(REPO_RUN_TMP);

let root: string;
let home: string;
let outDir: string;

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    BAO_BACKUP_REMOTE: 'none',
    BAO_BACKUP_OUT_DIR: outDir,
    BAO_BACKUP_LOCAL_SECONDARY: join(home, 'secondary'),
    BAO_BACKUP_PASSPHRASE_FILE: join(home, '.secrets', 'pass.txt'),
  };
  delete env.BAO_BACKUP_RUN_TMP;
  delete env.BAO_BACKUP_PASSPHRASE;
  return env;
}

function run(args: string[], env = baseEnv()): string {
  return execFileSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
}

function backupArchive(env = baseEnv()): string {
  const stdout = run(['backup'], env);
  const match = stdout.match(/archive: (.+)$/m);
  if (!match) throw new Error(`no archive path in output:\n${stdout}`);
  return match[1].trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bao-backup-'));
  home = join(root, 'home');
  outDir = join(root, 'out');
  mkdirSync(join(home, '.secrets'), { recursive: true, mode: 0o700 });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.secrets', 'agents.json'), '{"canary":"agents"}', { mode: 0o600 });
  writeFileSync(join(home, '.secrets', 'pass.txt'), 'test-passphrase', { mode: 0o600 });
  // Another checkout's identity tree - the pre-fix picker archived this.
  mkdirSync(join(home, 'bao_fund_it', '.run-tmp'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'bao_fund_it', '.run-tmp', 'campaign-identities.json'), '{"foreign":true}', { mode: 0o600 });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_GPG)('backup-secrets.sh isolation', () => {
  it('never archives another checkout\'s .run-tmp tree', { timeout: 120_000 }, () => {
    const archive = backupArchive();
    const listing = run(['verify', archive]);
    expect(listing).toContain('secrets/agents.json');
    // No run-tmp came from $HOME/bao_fund_it (the foreign tree).
    expect(listing).not.toMatch(/campaign-identities/);
    expect(listing).not.toMatch(/run-tmp\//);
  });

  it.skipIf(!REPO_RUN_TMP_FREE)('defaults to $REPO_ROOT/.run-tmp and excludes a nested passphrase file', { timeout: 120_000 }, () => {
    // The passphrase file is relocated into a NESTED directory of ~/.secrets
    // (pre-fix the -maxdepth 1 delete left it inside the payload). Note the
    // file is already at secrets/pass.txt; nest it one level deeper too.
    const nested = join(home, '.secrets', 'backups', 'deep');
    mkdirSync(nested, { recursive: true, mode: 0o700 });
    rmSync(join(home, '.secrets', 'pass.txt'));
    writeFileSync(join(nested, 'pass.txt'), 'test-passphrase', { mode: 0o600 });
    const env = { ...baseEnv(), BAO_BACKUP_PASSPHRASE_FILE: join(nested, 'pass.txt') };

    // This checkout's own identity store is the ONLY run-tmp source.
    mkdirSync(REPO_RUN_TMP, { recursive: true, mode: 0o700 });
    writeFileSync(join(REPO_RUN_TMP, 'campaign-identities.json'), '{"repo":true}', { mode: 0o600 });
    try {
      const archive = backupArchive(env);
      const listing = run(['verify', archive], env);
      expect(listing).toContain('run-tmp/campaign-identities.json');
      // The nested passphrase file must not be in the payload, under any path.
      expect(listing).not.toMatch(/pass\.txt/);
      // And no foreign identity file rode along.
      expect(listing).not.toMatch(/bao_fund_it/);
    } finally {
      rmSync(join(REPO_RUN_TMP, 'campaign-identities.json'), { force: true });
      if (existsSync(REPO_RUN_TMP) && readdirSync(REPO_RUN_TMP).length === 0) rmSync(REPO_RUN_TMP, { recursive: true, force: true });
    }
  });
});
