/**
 * Group Ratchet Protocol
 *
 * A group key-agreement protocol using HKDF-SHA256 (WebCrypto).
 * Provides epoch-based forward secrecy and post-compromise security after
 * member removal, without requiring an external MLS backend.
 *
 * Design:
 *   Each group has a shared rootSecret (32 bytes, hex-encoded).
 *   The exporterSecret for epoch N is derived via HKDF-SHA256:
 *     exporterSecret = HKDF(rootSecret, salt=groupId, info="ditto-grp-v1:epoch:N")
 *   On membership change a fresh random rootSecret is generated and distributed
 *   to remaining members via gift-wrapped Welcome events. A fresh random secret
 *   is used (instead of deriving from the old one) so a former member who may
 *   have compromised the old root cannot derive the new one.
 *
 * This is NOT full MLS (RFC 9420) but provides real cryptographic security
 * purely in the browser. It is compatible with the NIP-104 event layer used
 * by Bao Chat's Group Ratchet fallback.
 */

function assertHex64(value: string, name: string): void {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be 64 hex chars (32 bytes)`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // Copy into a Uint8Array backed by a plain ArrayBuffer, satisfying the
  // WebCrypto BufferSource type without generic ArrayBufferLike mismatches.
  return new Uint8Array(data);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', toBufferSource(data));
  return new Uint8Array(digest);
}

async function hkdf256(
  keyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    toBufferSource(keyMaterial),
    'HKDF',
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBufferSource(salt), info: toBufferSource(info) },
    imported,
    bits,
  );

  return new Uint8Array(derived);
}

/**
 * Derive the exporter secret for a given epoch from the group's root secret.
 *
 * @param rootSecret - 64-char hex group root secret
 * @param epoch      - Current epoch number
 * @param groupId    - Nostr group identifier (used as HKDF salt)
 * @returns 64-char hex exporterSecret for this epoch
 */
export async function deriveEpochSecret(
  rootSecret: string,
  epoch: number,
  groupId: string,
): Promise<string> {
  assertHex64(rootSecret, 'rootSecret');

  const encoder = new TextEncoder();
  const derived = await hkdf256(
    hexToBytes(rootSecret),
    encoder.encode(groupId),
    encoder.encode(`ditto-grp-v1:epoch:${epoch}`),
    256,
  );

  return bytesToHex(derived);
}

/**
 * Generate a fresh random root secret.
 * @returns 64-char hex string (32 random bytes)
 */
export function generateRootSecret(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Derive a deterministic root secret from a seed string.
 * Used for testing or for recovering a group from a user-provided seed.
 *
 * @param seed - Arbitrary seed string
 * @returns 64-char hex root secret
 */
export async function deriveRootSecretFromSeed(seed: string): Promise<string> {
  const encoder = new TextEncoder();
  return bytesToHex(await sha256(encoder.encode(seed)));
}
