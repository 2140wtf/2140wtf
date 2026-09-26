/**
 * Wallet → Backup: export/restore the NIP-60 wallet as an encrypted file.
 *
 * Export writes `bao-fund-wallet-backup-<pubkey>.json` — the password-
 * encrypted payload from `walletBackupFile.ts` (identity pubkey + NIP-60
 * wallet spend key + mints; the identity nsec / seed phrase only when the
 * user opts in). Restore decrypts a file for the SIGNED-IN identity and
 * hands the wallet key to `useNip60Wallet.applyImportedWalletKey`, which
 * persists it and re-runs the existing `restoreWalletForIdentity` machinery
 * so the relay-published proofs follow.
 *
 * Fail closed: a file for another identity, a wrong password, a tampered
 * envelope or a not-yet-bound wallet is refused with a typed message and no
 * key material is written.
 */
import React from 'react';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useNip60Wallet } from './useNip60Wallet';
import { errorMessage } from '../lib/errors';
import {
  buildWalletBackupPayload,
  decryptWalletBackup,
  encryptWalletBackup,
  WalletBackupError,
  WALLET_BACKUP_MIN_PASSWORD,
} from './walletBackupFile';
import { loadRailWallets, saveRailWallet, type RailWalletRail } from './rails/railWalletStore';

const RAIL_LABELS: Record<RailWalletRail, string> = {
  testnet4: 'Bitcoin testnet4',
  liquid: 'Liquid testnet',
};

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function WalletBackupPanel(): React.ReactElement {
  const auth = useAuth();
  const portable = useNip60Wallet();
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [includeNsec, setIncludeNsec] = React.useState(false);
  const [includePhrase, setIncludePhrase] = React.useState(false);
  const [restoreText, setRestoreText] = React.useState('');
  const [restorePassword, setRestorePassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const pubkey = auth.pubkey;
  const walletKey = portable.getWalletKeyHex();
  const secrets = auth.identitySecrets();
  const canRestore = Boolean(pubkey) && portable.status !== 'off';
  // Browser-created testnet rail wallets ride along in the file (no value,
  // testnet-only); the mnemonics are encrypted like everything else.
  const railWallets = pubkey ? loadRailWallets(pubkey) : {};
  const storedRailLabels = (Object.keys(railWallets) as RailWalletRail[]).map((rail) => RAIL_LABELS[rail]);

  const exportBackup = async (): Promise<void> => {
    setError(null);
    setStatus(null);
    if (!pubkey) {
      setError('Sign in first - a wallet backup is bound to an identity.');
      return;
    }
    if (!walletKey) {
      setError('The NIP-60 wallet is not bound yet - open the wallet, let it sync, then export.');
      return;
    }
    if (password.length < WALLET_BACKUP_MIN_PASSWORD) {
      setError(`Use a password of at least ${WALLET_BACKUP_MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const payload = buildWalletBackupPayload({
        identityPubkey: pubkey,
        walletKeyHex: walletKey,
        mints: portable.mints,
        identityNsec: includeNsec ? secrets.nsec : null,
        seedPhrase: includePhrase ? secrets.seedPhrase : null,
        railWallets,
      });
      const file = await encryptWalletBackup(payload, password);
      downloadText(file, `bao-fund-wallet-backup-${pubkey.slice(0, 12)}.json`);
      setStatus('Encrypted backup downloaded. Keep the file AND the password safe - without either, the wallet cannot be restored.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (): Promise<void> => {
    setError(null);
    setStatus(null);
    if (!pubkey) {
      setError('Sign in as the backup identity first, then restore.');
      return;
    }
    if (!restoreText.trim()) {
      setError('Choose the backup file (or paste its contents) first.');
      return;
    }
    setBusy(true);
    try {
      const payload = await decryptWalletBackup(restoreText, restorePassword, pubkey);
      const applied = await portable.applyImportedWalletKey(payload.walletKey);
      if (!applied) {
        throw new Error('The wallet is not bound to an identity yet - sign in and retry.');
      }
      if (portable.mints.length === 0 && payload.mints.length > 0) {
        await portable.setActiveMint(payload.mints[0]);
      }
      // Restore the browser-created rail wallets into the per-identity store
      // (the decrypt above already refused a file for another identity).
      const restoredRails: string[] = [];
      if (payload.railWallets) {
        for (const rail of ['testnet4', 'liquid'] as const) {
          const record = payload.railWallets[rail];
          if (!record) continue;
          const saved = saveRailWallet(pubkey, rail, {
            version: 1,
            mnemonic: record.mnemonic,
            createdAt: record.createdAt,
            source: record.source,
          });
          if (saved) restoredRails.push(RAIL_LABELS[rail]);
        }
      }
      const railNote = restoredRails.length > 0 ? ` Browser wallets restored: ${restoredRails.join(', ')}.` : '';
      setStatus(`Wallet key restored for ${payload.identityPubkey.slice(0, 12)}… - proofs re-sync from your relays.${railNote}`);
      setRestoreText('');
      setRestorePassword('');
    } catch (err) {
      if (err instanceof WalletBackupError && err.code === 'wrong-password') {
        setError('Wrong password - or the file was tampered with. Nothing was changed.');
      } else if (err instanceof WalletBackupError) {
        setError(`${err.message} Nothing was changed.`);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      setRestoreText(await file.text());
      setError(null);
    } catch {
      setError('Could not read that file - paste its contents instead.');
    }
  };

  return (
    <div className="border p-4" style={{ borderColor: 'var(--np-rule)' }} data-testid="wallet-backup-panel">
      <h3 className="mb-1 font-serif text-lg font-bold">Wallet backup</h3>
      <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
        Your NIP-60 wallet lives in this browser and on your relays. This file carries the
        wallet spend key and any browser-created testnet rail wallets (password-encrypted)
        so a fresh browser can restore them.
      </p>

      {!pubkey ? (
        <p className="text-[11px]" style={{ color: 'var(--np-muted)' }}>Sign in to back up or restore the NIP-60 wallet.</p>
      ) : (
        <>
          <div className="mb-4 space-y-2">
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Backup password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${WALLET_BACKUP_MIN_PASSWORD} characters`}
              data-testid="wallet-backup-password"
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              data-testid="wallet-backup-password-confirm"
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--np-muted)' }}>
              <input
                type="checkbox"
                checked={includeNsec}
                disabled={!secrets.nsec}
                onChange={(e) => setIncludeNsec(e.target.checked)}
                data-testid="wallet-backup-include-nsec"
              />
              Include the identity nsec {secrets.nsec ? '(raw secret - file is encrypted)' : '(unavailable for this sign-in method)'}
            </label>
            <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--np-muted)' }}>
              <input
                type="checkbox"
                checked={includePhrase}
                disabled={!secrets.seedPhrase}
                onChange={(e) => setIncludePhrase(e.target.checked)}
                data-testid="wallet-backup-include-phrase"
              />
              Include the seed phrase {secrets.seedPhrase ? '(raw secret - file is encrypted)' : '(not available)'}
            </label>
            <button
              type="button"
              onClick={() => void exportBackup()}
              disabled={busy || !walletKey}
              data-testid="wallet-backup-export"
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-40"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <Download size={14} className="mr-1 inline" />Download encrypted backup
            </button>
            {!walletKey && (
              <div className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
                Wallet key not loaded yet - open the wallet and let it sync.
              </div>
            )}
            <div className="text-[10px]" data-testid="wallet-backup-rail-wallets" style={{ color: 'var(--np-muted)' }}>
              {storedRailLabels.length > 0
                ? `Includes browser wallets: ${storedRailLabels.join(', ')} (testnet-only, no value).`
                : 'No browser-created testnet rail wallets stored for this identity yet.'}
            </div>
          </div>

          <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--np-rule)' }}>
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)' }}>Restore from backup</label>
            <input
              type="file"
              accept="application/json,.json"
              data-testid="wallet-backup-file"
              onChange={(e) => void readFile(e.target.files?.[0])}
              className="w-full text-[11px]"
              style={{ color: 'var(--np-muted)' }}
            />
            <textarea
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              rows={3}
              placeholder="…or paste the backup file contents here"
              data-testid="wallet-backup-text"
              className="w-full rounded border bg-transparent px-3 py-2 text-[10px] font-mono"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <input
              type="password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
              placeholder="Backup password"
              data-testid="wallet-backup-restore-password"
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            />
            <button
              type="button"
              onClick={() => void restoreBackup()}
              disabled={busy || !canRestore}
              data-testid="wallet-backup-restore"
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-40"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
            >
              <Upload size={14} className="mr-1 inline" />Restore wallet key
            </button>
            <p className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
              The file must belong to the signed-in identity. Restoring replaces this browser&apos;s NIP-60 wallet key and re-syncs the proofs from your relays.
            </p>
          </div>
        </>
      )}

      {status && <div className="mt-3 text-[11px]" style={{ color: 'var(--np-success)' }} role="status">{status}</div>}
      {error && <div className="mt-3 text-[11px]" style={{ color: 'var(--np-error, #b91c1c)' }} role="alert">{error}</div>}
    </div>
  );
}
