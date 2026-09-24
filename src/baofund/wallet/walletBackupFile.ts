// src/wallet/walletBackupFile.ts
//
// The ₿AO Fund WALLET backup file: a password-encrypted, self-describing
// JSON document that carries everything a fresh browser needs to restore
// this identity's NIP-60 wallet.
//
// FORMAT (bao-fund-wallet-backup, version 1)
//
//   envelope (cleartext; identity pubkey is public material):
//     { format, version, createdAt, identityPubkey,
//       kdf:    { name: 'PBKDF2-SHA256', iterations, salt: base64 },
//       cipher: { name: 'AES-256-GCM', iv: base64, ciphertext: base64 } }
//
//   plaintext (AES-256-GCM, AAD = 'bao-fund-wallet-backup:v1:<pubkey>'):
//     { format, version, createdAt, identityPubkey, mints: string[],
//       walletKey: <64-hex NIP-60 spend key>,
//       identityNsec?, seedPhrase?,   // raw secrets ONLY when the user opts in
//       railWallets?                  // browser-created testnet rail wallets
//     }
//
//   railWallets (additive, optional — old files without it still decrypt):
//     { testnet4?: { mnemonic, createdAt, source }, liquid?: {...} }
//
//   The rail-wallet mnemonics are the user-created testnet4 / Liquid testnet
//   wallets from `rails/railWalletStore.ts`. They are independent of the
//   identity seed, BIP-39-validated on build AND on decrypt, and restore into
//   the per-identity store only when the file's identityPubkey matches.
//
// The AAD binds the ciphertext to the identity pubkey and format version, so
// an envelope cannot be re-labelled for another identity or downgraded.
// PBKDF2-SHA256 (600k iterations) + AES-256-GCM is WebCrypto-only — no new
// dependency, no home-grown cipher. Restore is fail-closed: a wrong password,
// a tampered envelope, an unsupported version or a payload whose identity
// pubkey disagrees with the envelope all throw a typed WalletBackupError.
//
// The wallet spend key is the point of the file, so it is always included
// (encrypted). The identity nsec / seed phrase are optional opt-ins — the
// Settings identity backup already covers them, and each is verified to
// derive to the file's identity pubkey before it is written.

import { schnorr } from '@noble/curves/secp256k1.js';
import { nip19 } from 'nostr-tools';
import { base64ToBytes, bytesToBase64 } from '../lib/cashu/base64';
import { deriveIdentityPrivkey } from './nip60/identity';
import {
  normalizeRailWalletMnemonic,
  type RailWalletMap,
  type RailWalletRail,
  type RailWalletSource,
} from './rails/railWalletStore';

export const WALLET_BACKUP_FORMAT = 'bao-fund-wallet-backup';
export const WALLET_BACKUP_VERSION = 1;
export const WALLET_BACKUP_MIN_PASSWORD = 8;
/** PBKDF2 work factor. Bounded on restore so a hostile file cannot burn CPU. */
export const WALLET_BACKUP_KDF_ITERATIONS = 600_000;
const MIN_KDF_ITERATIONS = 100_000;
const MAX_KDF_ITERATIONS = 2_000_000;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_MINTS = 64;
const MAX_MINT_URL_CHARS = 256;
const HEX64 = /^[0-9a-f]{64}$/;

export type WalletBackupFailure =
  | 'malformed-file'
  | 'unsupported-version'
  | 'wrong-password'
  | 'weak-password'
  | 'invalid-payload';

export class WalletBackupError extends Error {
  constructor(
    public readonly code: WalletBackupFailure,
    message: string,
  ) {
    super(message);
    this.name = 'WalletBackupError';
  }
}

/** One browser-created rail wallet in the backup payload (testnet-only). */
export interface WalletBackupRailWallet {
  mnemonic: string;
  createdAt: number;
  source: RailWalletSource;
}

export type WalletBackupRailWallets = Partial<Record<RailWalletRail, WalletBackupRailWallet>>;

export interface WalletBackupPayload {
  format: typeof WALLET_BACKUP_FORMAT;
  version: typeof WALLET_BACKUP_VERSION;
  createdAt: number;
  identityPubkey: string;
  mints: string[];
  /** NIP-60 wallet spend key (64-hex) — required: it is what restore needs. */
  walletKey: string;
  /** Raw identity secret, only when the user opted in. */
  identityNsec?: string;
  /** BIP-39 seed phrase, only when the user opted in and it was available. */
  seedPhrase?: string;
  /** Browser-created/imported testnet rail wallets (testnet-only, no value). */
  railWallets?: WalletBackupRailWallets;
}

export interface WalletBackupInput {
  identityPubkey: string;
  walletKeyHex: string;
  mints: readonly string[];
  identityNsec?: string | null;
  seedPhrase?: string | null;
  /** Rail wallets from `loadRailWallets(pubkey)`; validated, never raw. */
  railWallets?: RailWalletMap | null;
  nowSeconds?: number;
}

function fail(code: WalletBackupFailure, message: string): never {
  throw new WalletBackupError(code, message);
}

function deriveXonly(privkey: Uint8Array): string {
  return bytesToHexLower(schnorr.getPublicKey(privkey));
}

function bytesToHexLower(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeMints(mints: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of mints) {
    const mint = typeof raw === 'string' ? raw.trim() : '';
    if (!mint || mint.length > MAX_MINT_URL_CHARS) continue;
    if (!out.includes(mint)) out.push(mint);
    if (out.length >= MAX_MINTS) break;
  }
  return out;
}

/**
 * Validate + normalize the optional rail-wallet block. A supplied entry whose
 * mnemonic is not a valid BIP-39 phrase (or whose shape is wrong) is refused
 * — a backup must never carry an unrestorable wallet silently. Absent/empty
 * input yields undefined so old-style payloads stay byte-identical.
 */
function normalizeRailWallets(input: RailWalletMap | null | undefined): WalletBackupRailWallets | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) {
    fail('invalid-payload', 'The rail-wallet backup block is not an object');
  }
  const out: WalletBackupRailWallets = {};
  for (const rail of ['testnet4', 'liquid'] as const) {
    const record = input[rail];
    if (record === undefined) continue;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      fail('invalid-payload', `The ${rail} rail-wallet entry is not an object`);
    }
    const mnemonic = normalizeRailWalletMnemonic(record.mnemonic);
    if (!mnemonic) {
      fail('invalid-payload', `The ${rail} rail-wallet entry has no valid BIP-39 mnemonic`);
    }
    if (typeof record.createdAt !== 'number' || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
      fail('invalid-payload', `The ${rail} rail-wallet entry has an invalid timestamp`);
    }
    if (record.source !== 'created' && record.source !== 'imported') {
      fail('invalid-payload', `The ${rail} rail-wallet entry has an invalid source`);
    }
    out[rail] = { mnemonic, createdAt: record.createdAt, source: record.source };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Verify an nsec derives to the file's identity pubkey before writing it. */
function verifyNsec(nsec: string, identityPubkey: string): void {
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(nsec);
  } catch {
    fail('invalid-payload', 'The identity nsec is not a valid bech32 string');
  }
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array) || decoded.data.length !== 32) {
    fail('invalid-payload', 'The identity secret is not an nsec key');
  }
  if (deriveXonly(decoded.data) !== identityPubkey) {
    fail('invalid-payload', 'The identity nsec does not derive to this identity pubkey');
  }
}

/** Verify a seed phrase derives to the file's identity pubkey before writing it. */
function verifySeedPhrase(phrase: string, identityPubkey: string): void {
  let derived: string;
  try {
    derived = deriveXonly(deriveIdentityPrivkey(phrase));
  } catch {
    fail('invalid-payload', 'The seed phrase is not a valid BIP-39 phrase');
  }
  if (derived !== identityPubkey) {
    fail('invalid-payload', 'The seed phrase does not derive to this identity pubkey');
  }
}

/**
 * Assemble the plaintext payload. Structural + derivation validation only
 * (no I/O); the caller passes values it already holds.
 */
export function buildWalletBackupPayload(input: WalletBackupInput): WalletBackupPayload {
  const identityPubkey = input.identityPubkey.toLowerCase();
  if (!HEX64.test(identityPubkey)) {
    fail('invalid-payload', 'A 64-hex identity pubkey is required for a wallet backup');
  }
  if (!HEX64.test(input.walletKeyHex)) {
    fail('invalid-payload', 'A 64-hex NIP-60 wallet key is required for a wallet backup');
  }
  const payload: WalletBackupPayload = {
    format: WALLET_BACKUP_FORMAT,
    version: WALLET_BACKUP_VERSION,
    createdAt: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    identityPubkey,
    mints: normalizeMints(input.mints),
    walletKey: input.walletKeyHex.toLowerCase(),
  };
  const nsec = input.identityNsec?.trim();
  if (nsec) {
    verifyNsec(nsec, identityPubkey);
    payload.identityNsec = nsec;
  }
  const phrase = input.seedPhrase?.trim();
  if (phrase) {
    verifySeedPhrase(phrase, identityPubkey);
    payload.seedPhrase = phrase;
  }
  const railWallets = normalizeRailWallets(input.railWallets);
  if (railWallets) payload.railWallets = railWallets;
  return payload;
}

function assertPayload(value: unknown, expectedPubkey?: string): WalletBackupPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-payload', 'The decrypted backup is not an object');
  }
  const p = value as Record<string, unknown>;
  if (p.format !== WALLET_BACKUP_FORMAT || p.version !== WALLET_BACKUP_VERSION) {
    fail('unsupported-version', 'The decrypted backup has an unknown format/version');
  }
  if (typeof p.identityPubkey !== 'string' || !HEX64.test(p.identityPubkey)) {
    fail('invalid-payload', 'The decrypted backup has no valid identity pubkey');
  }
  if (expectedPubkey !== undefined && p.identityPubkey !== expectedPubkey.toLowerCase()) {
    fail('invalid-payload', 'The decrypted backup belongs to a different identity pubkey');
  }
  if (typeof p.walletKey !== 'string' || !HEX64.test(p.walletKey)) {
    fail('invalid-payload', 'The decrypted backup has no valid wallet key');
  }
  if (!Array.isArray(p.mints) || !p.mints.every((m) => typeof m === 'string')) {
    fail('invalid-payload', 'The decrypted backup has an invalid mint list');
  }
  if (p.identityNsec !== undefined && typeof p.identityNsec !== 'string') {
    fail('invalid-payload', 'The decrypted backup has an invalid identity secret');
  }
  if (p.seedPhrase !== undefined && typeof p.seedPhrase !== 'string') {
    fail('invalid-payload', 'The decrypted backup has an invalid seed phrase');
  }
  if (typeof p.createdAt !== 'number' || !Number.isSafeInteger(p.createdAt) || p.createdAt < 0) {
    fail('invalid-payload', 'The decrypted backup has an invalid timestamp');
  }
  const railWallets = p.railWallets !== undefined ? normalizeRailWallets(p.railWallets as RailWalletMap) : undefined;
  return {
    format: WALLET_BACKUP_FORMAT,
    version: WALLET_BACKUP_VERSION,
    createdAt: p.createdAt,
    identityPubkey: p.identityPubkey,
    mints: normalizeMints(p.mints as string[]),
    walletKey: p.walletKey.toLowerCase(),
    ...(p.identityNsec !== undefined ? { identityNsec: p.identityNsec as string } : {}),
    ...(p.seedPhrase !== undefined ? { seedPhrase: p.seedPhrase as string } : {}),
    ...(railWallets !== undefined ? { railWallets } : {}),
  };
}

async function deriveBackupKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    fail('invalid-payload', 'Web Crypto is unavailable — a secure context is required');
  }
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aadFor(identityPubkey: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${WALLET_BACKUP_FORMAT}:v${WALLET_BACKUP_VERSION}:${identityPubkey.toLowerCase()}`) as Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt a payload into the backup-file text (JSON). Refuses weak passwords
 * and derives the encryption key with PBKDF2-SHA256 + AES-256-GCM.
 */
export async function encryptWalletBackup(payload: WalletBackupPayload, password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < WALLET_BACKUP_MIN_PASSWORD) {
    fail('weak-password', `The backup password must be at least ${WALLET_BACKUP_MIN_PASSWORD} characters`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt, WALLET_BACKUP_KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(payload.identityPubkey) },
    key,
    plaintext,
  ));
  return JSON.stringify({
    format: WALLET_BACKUP_FORMAT,
    version: WALLET_BACKUP_VERSION,
    createdAt: payload.createdAt,
    identityPubkey: payload.identityPubkey,
    kdf: { name: 'PBKDF2-SHA256', iterations: WALLET_BACKUP_KDF_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-256-GCM', iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) },
  });
}

/**
 * Decrypt + validate a backup file. `expectedPubkey` (when given) must match
 * the envelope's identity pubkey — a file for another identity is refused
 * before any key material is touched.
 */
export async function decryptWalletBackup(fileText: string, password: string, expectedPubkey?: string): Promise<WalletBackupPayload> {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(fileText) as Record<string, unknown>;
  } catch {
    fail('malformed-file', 'The backup file is not valid JSON');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('malformed-file', 'The backup file is not an object');
  }
  if (envelope.format !== WALLET_BACKUP_FORMAT) {
    fail('malformed-file', 'The file is not a ₿AO Fund wallet backup');
  }
  if (envelope.version !== WALLET_BACKUP_VERSION) {
    fail('unsupported-version', `Backup version ${String(envelope.version)} is not supported`);
  }
  const identityPubkey = typeof envelope.identityPubkey === 'string' ? envelope.identityPubkey.toLowerCase() : '';
  if (!HEX64.test(identityPubkey)) {
    fail('malformed-file', 'The backup file has no valid identity pubkey');
  }
  if (expectedPubkey !== undefined && identityPubkey !== expectedPubkey.toLowerCase()) {
    fail('invalid-payload', 'This backup file belongs to a different identity - sign in as that identity to restore it');
  }
  const kdf = envelope.kdf as Record<string, unknown> | undefined;
  const cipher = envelope.cipher as Record<string, unknown> | undefined;
  if (!kdf || kdf.name !== 'PBKDF2-SHA256'
    || typeof kdf.iterations !== 'number' || !Number.isSafeInteger(kdf.iterations)
    || kdf.iterations < MIN_KDF_ITERATIONS || kdf.iterations > MAX_KDF_ITERATIONS
    || typeof kdf.salt !== 'string') {
    fail('malformed-file', 'The backup file has an unsupported key-derivation block');
  }
  if (!cipher || cipher.name !== 'AES-256-GCM'
    || typeof cipher.iv !== 'string' || typeof cipher.ciphertext !== 'string') {
    fail('malformed-file', 'The backup file has an unsupported cipher block');
  }
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64ToBytes(kdf.salt);
    iv = base64ToBytes(cipher.iv);
    ciphertext = base64ToBytes(cipher.ciphertext);
  } catch {
    fail('malformed-file', 'The backup file has malformed base64 fields');
  }
  if (salt.length < 8 || salt.length > 64 || iv.length !== 12 || ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    fail('malformed-file', 'The backup file has malformed cipher parameters');
  }
  const key = await deriveBackupKey(password, salt, kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadFor(identityPubkey) },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    fail('wrong-password', 'Decryption failed - wrong password or tampered backup file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    fail('invalid-payload', 'The decrypted backup is not valid JSON');
  }
  return assertPayload(parsed, identityPubkey);
}
