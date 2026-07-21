/**
 * Native Passkey module for 2140.wtf.
 *
 * Adapted from BAO Markets' nativePasskey.ts.
 * Zero-dependency, client-side only. Uses native navigator.credentials + Web Crypto API.
 *
 * Supports:
 *  - Platform authenticators with PRF (Touch ID, Face ID, Windows Hello, Android fingerprint)
 *  - YubiKey Bio series (PRF-capable)
 *  - YubiKey 5 series via largeBlob extension (fallback)
 */

/* ── Constants ─────────────────────────────────────────────── */

const PASSKEY_PRF_CONTEXT = "2140:prf:v1";
const PASSKEY_SALT = "2140:native_passkey:salt:v1";
const PASSKEY_CREDENTIAL_KEY = "2140_native_passkey_credential_id";
const PASSKEY_WRAPPED_KEY = "2140_native_passkey_wrapped_master";
const PASSKEY_IS_YUBIKEY = "2140_native_passkey_is_yubikey";
const PASSKEY_METHOD_KEY = "2140_native_passkey_method"; // 'prf' | 'largeBlob'

/* ── Types ─────────────────────────────────────────────────── */

export interface PasskeyEnrollment {
  credentialId: string;
  isYubiKey: boolean;
  /** 'prf' | 'largeBlob' — how the master key is wrapped */
  method: "prf" | "largeBlob";
}

export interface PasskeyUnlockResult {
  masterKey: CryptoKey;
  method: "prf" | "largeBlob";
}

/* ── Base64url helpers (no @simplewebauthn/browser dep) ────── */

function bufferToBase64URLString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64URLStringToBuffer(base64URLString: string): ArrayBuffer {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

/* ── PRF Extension Helpers ─────────────────────────────────── */

interface PrfExtensionOutput {
  prf?: {
    results?: {
      first?: ArrayBuffer;
    };
  };
}

function extractPrfSeed(response: { clientExtensionResults?: unknown }): Uint8Array | null {
  const ext = response.clientExtensionResults as PrfExtensionOutput | undefined;
  if (!ext?.prf?.results?.first) return null;
  return new Uint8Array(ext.prf.results.first);
}

/* ── Availability Detection ────────────────────────────────── */

/** Check if the browser supports WebAuthn PRF. */
export async function isPrfAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;

  try {
    const caps = await (window.PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.();
    if (caps?.prf === true) return true;
  } catch {
    /* fallback below */
  }

  try {
    const available = await (window.PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }).isUserVerifyingPlatformAuthenticatorAvailable?.();
    if (available) return true;
  } catch {
    /* ignore */
  }

  return false;
}

/** Check if WebAuthn is available at all. */
export function isWebAuthnAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/** Check if largeBlob extension is available (for non-PRF YubiKeys). */
export async function isLargeBlobAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    const caps = await (window.PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.();
    return caps?.largeBlob === true;
  } catch {
    return false;
  }
}

/* ── Master Key Derivation from PRF Seed ───────────────────── */

/**
 * Derive a 256-bit AES-GCM key from a PRF seed.
 * The same passkey + same salt always produces the same key.
 */
async function deriveMasterKeyFromPrf(prfSeed: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", buf(prfSeed), "HKDF", false, [
    "deriveKey",
  ]);
  const salt = new TextEncoder().encode(PASSKEY_SALT);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: buf(salt),
      info: new TextEncoder().encode("master"),
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ── Wrapping / Unwrapping ─────────────────────────────────── */

/** Cast Uint8Array to BufferSource for Web Crypto DOM types. */
function buf(src: Uint8Array): BufferSource {
  return src as unknown as BufferSource;
}

/** Wrap a master key with a passkey-derived key. */
async function wrapMasterKey(masterKey: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("raw", masterKey, wrappingKey, {
    name: "AES-GCM",
    iv: buf(iv),
  });

  const combined = new Uint8Array(iv.length + wrapped.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(wrapped), iv.length);
  return bufferToBase64URLString(combined.buffer);
}

/** Unwrap a master key with a passkey-derived key. */
async function unwrapMasterKey(wrappedB64: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const combined = new Uint8Array(base64URLStringToBuffer(wrappedB64));
  const iv = combined.slice(0, 12);
  const wrapped = combined.slice(12);
  return crypto.subtle.unwrapKey(
    "raw",
    buf(wrapped),
    wrappingKey,
    { name: "AES-GCM", iv: buf(iv) },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function getRpName(): string {
  if (typeof document !== "undefined" && document.title) return document.title;
  return "2140.wtf";
}

/* ── Registration ──────────────────────────────────────────── */

/**
 * Register a platform passkey (Touch ID, Face ID, etc.) with PRF extension.
 * Returns the credential ID and wraps the provided master key.
 */
export async function registerPlatformPasskey(masterKey: CryptoKey): Promise<PasskeyEnrollment> {
  if (!isWebAuthnAvailable()) throw new Error("WebAuthn not available");

  const prfSalt = new TextEncoder().encode(PASSKEY_PRF_CONTEXT);

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: getRpName(), id: window.location.hostname },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: "2140-user",
      displayName: "2140 User",
    },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
      requireResidentKey: false,
    },
    attestation: "none",
    extensions: {
      prf: { eval: { first: prfSalt.buffer } },
    } as unknown as AuthenticationExtensionsClientInputs,
  };

  const credential = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled");

  const credentialId = bufferToBase64URLString(credential.rawId);

  // Try to extract PRF seed from registration response
  let prfSeed = extractPrfSeed(credential as unknown as { clientExtensionResults?: unknown });

  // PRF sometimes isn't returned during creation — do a self-auth to get it
  if (!prfSeed) {
    const extResults = (credential as unknown as { getClientExtensionResults?: () => PrfExtensionOutput }).getClientExtensionResults?.();
    if (extResults?.prf) {
      const authOptions: PublicKeyCredentialRequestOptions = {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ id: credential.rawId, type: "public-key" }],
        userVerification: "required",
        extensions: { prf: { eval: { first: prfSalt.buffer } } } as unknown as AuthenticationExtensionsClientInputs,
      };
      const assertion = (await navigator.credentials.get({
        publicKey: authOptions,
      })) as PublicKeyCredential | null;
      if (assertion) {
        prfSeed = extractPrfSeed(assertion as unknown as { clientExtensionResults?: unknown });
      }
    }
  }

  if (!prfSeed) {
    throw new Error(
      "PRF_NOT_SUPPORTED: Your device does not support PRF. Try a YubiKey with largeBlob support or use a secret key instead.",
    );
  }

  // Derive wrapping key from PRF seed and wrap master key
  const wrappingKey = await deriveMasterKeyFromPrf(prfSeed);
  const wrapped = await wrapMasterKey(masterKey, wrappingKey);

  // Store enrollment data
  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);
  localStorage.setItem(PASSKEY_WRAPPED_KEY, wrapped);
  localStorage.setItem(PASSKEY_IS_YUBIKEY, "false");
  localStorage.setItem(PASSKEY_METHOD_KEY, "prf");

  return { credentialId, isYubiKey: false, method: "prf" };
}

/**
 * Register a YubiKey (or other cross-platform authenticator) with PRF extension.
 * For YubiKey 5.7+ and other FIDO2 keys that support the PRF extension.
 */
export async function registerYubiKeyWithPrf(masterKey: CryptoKey): Promise<PasskeyEnrollment> {
  if (!isWebAuthnAvailable()) throw new Error("WebAuthn not available");

  const prfSalt = new TextEncoder().encode(PASSKEY_PRF_CONTEXT);

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: getRpName(), id: window.location.hostname },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: "2140-yubikey",
      displayName: "2140 YubiKey",
    },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      userVerification: "required",
      residentKey: "preferred",
      requireResidentKey: false,
    },
    attestation: "none",
    extensions: {
      prf: { eval: { first: prfSalt.buffer } },
    } as unknown as AuthenticationExtensionsClientInputs,
  };

  const credential = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled");

  const credentialId = bufferToBase64URLString(credential.rawId);

  // Try to extract PRF seed from registration response
  let prfSeed = extractPrfSeed(credential as unknown as { clientExtensionResults?: unknown });

  // PRF sometimes isn't returned during creation — do a self-auth to get it
  if (!prfSeed) {
    const extResults = (credential as unknown as { getClientExtensionResults?: () => PrfExtensionOutput }).getClientExtensionResults?.();
    if (extResults?.prf) {
      const authOptions: PublicKeyCredentialRequestOptions = {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ id: credential.rawId, type: "public-key" }],
        userVerification: "required",
        extensions: { prf: { eval: { first: prfSalt.buffer } } } as unknown as AuthenticationExtensionsClientInputs,
      };
      const assertion = (await navigator.credentials.get({
        publicKey: authOptions,
      })) as PublicKeyCredential | null;
      if (assertion) {
        prfSeed = extractPrfSeed(assertion as unknown as { clientExtensionResults?: unknown });
      }
    }
  }

  if (!prfSeed) {
    throw new Error(
      "PRF_NOT_SUPPORTED: Your YubiKey does not support PRF. Try largeBlob enrollment or use a secret key instead.",
    );
  }

  // Derive wrapping key from PRF seed and wrap master key
  const wrappingKey = await deriveMasterKeyFromPrf(prfSeed);
  const wrapped = await wrapMasterKey(masterKey, wrappingKey);

  // Store enrollment data
  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);
  localStorage.setItem(PASSKEY_WRAPPED_KEY, wrapped);
  localStorage.setItem(PASSKEY_IS_YUBIKEY, "true");
  localStorage.setItem(PASSKEY_METHOD_KEY, "prf");

  return { credentialId, isYubiKey: true, method: "prf" };
}

/**
 * Register a roaming authenticator (YubiKey) with largeBlob support.
 * Used when PRF is not available but largeBlob is.
 */
export async function registerYubiKeyPasskey(masterKey: CryptoKey): Promise<PasskeyEnrollment> {
  if (!isWebAuthnAvailable()) throw new Error("WebAuthn not available");

  const largeBlobData = crypto.getRandomValues(new Uint8Array(32));

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: getRpName(), id: window.location.hostname },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: "2140-yubikey",
      displayName: "2140 YubiKey",
    },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      userVerification: "required",
    },
    attestation: "none",
    extensions: {
      largeBlob: { support: "required" },
    } as unknown as AuthenticationExtensionsClientInputs,
  };

  const credential = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Passkey creation was cancelled");

  const credentialId = bufferToBase64URLString(credential.rawId);

  // Derive a wrapping key from the largeBlob data (which we store ON the YubiKey)
  const wrappingKey = await crypto.subtle.importKey("raw", largeBlobData, "HKDF", false, [
    "deriveKey",
  ]);
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new TextEncoder().encode(PASSKEY_SALT),
      info: new Uint8Array(0),
      hash: "SHA-256",
    },
    wrappingKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const wrapped = await wrapMasterKey(masterKey, derivedKey);

  // Store the largeBlob data back to the credential via an auth call
  const authOptions: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: window.location.hostname,
    allowCredentials: [{ id: credential.rawId, type: "public-key" }],
    userVerification: "required",
    extensions: {
      largeBlob: { write: largeBlobData.buffer },
    } as unknown as AuthenticationExtensionsClientInputs,
  };

  try {
    await navigator.credentials.get({ publicKey: authOptions });
  } catch {
    // largeBlob write failed — the YubiKey cannot store our secret.
    throw new Error(
      "YubiKey largeBlob write failed. Your device may not support largeBlob. Try a YubiKey with PRF support (firmware 5.7+) or use a platform passkey / secret key instead.",
    );
  }

  // Verify the blob was actually written by reading it back
  const verifyAuthOptions: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: window.location.hostname,
    allowCredentials: [{ id: credential.rawId, type: "public-key" }],
    userVerification: "required",
    extensions: { largeBlob: { read: true } } as unknown as AuthenticationExtensionsClientInputs,
  };

  try {
    const verifyAssertion = (await navigator.credentials.get({
      publicKey: verifyAuthOptions,
    })) as PublicKeyCredential | null;
    const verifyExt = (verifyAssertion as unknown as { getClientExtensionResults?: () => { largeBlob?: { blob?: ArrayBuffer } } })?.getClientExtensionResults?.();
    const readBack = verifyExt?.largeBlob?.blob;
    if (!readBack || !timingSafeEqual(new Uint8Array(readBack), largeBlobData)) {
      throw new Error("YubiKey largeBlob verification failed — data did not persist. Enrollment aborted.");
    }
  } catch {
    throw new Error("YubiKey largeBlob read-back verification failed. Enrollment aborted.");
  }

  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);
  localStorage.setItem(PASSKEY_WRAPPED_KEY, wrapped);
  localStorage.setItem(PASSKEY_IS_YUBIKEY, "true");
  localStorage.setItem(PASSKEY_METHOD_KEY, "largeBlob");

  return { credentialId, isYubiKey: true, method: "largeBlob" };
}

/* ── Authentication / Unlock ───────────────────────────────── */

/**
 * Unlock the master key using an enrolled passkey (PRF path).
 */
async function unlockWithPrf(credentialIdB64: string, wrappedB64: string): Promise<CryptoKey> {
  const credentialId = base64URLStringToBuffer(credentialIdB64);
  const prfSalt = new TextEncoder().encode(PASSKEY_PRF_CONTEXT);

  const authOptions: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: window.location.hostname,
    allowCredentials: [{ id: credentialId, type: "public-key" }],
    userVerification: "required",
    extensions: { prf: { eval: { first: prfSalt.buffer } } } as unknown as AuthenticationExtensionsClientInputs,
  };

  const assertion = (await navigator.credentials.get({
    publicKey: authOptions,
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey authentication was cancelled");

  const prfSeed = extractPrfSeed(assertion as unknown as { clientExtensionResults?: unknown });
  if (!prfSeed) throw new Error("PRF result not available — your authenticator may not support PRF");

  const wrappingKey = await deriveMasterKeyFromPrf(prfSeed);
  return unwrapMasterKey(wrappedB64, wrappingKey);
}

/** Constant-time array comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function unlockWithPasskey(): Promise<PasskeyUnlockResult> {
  const credentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY);
  const wrappedB64 = localStorage.getItem(PASSKEY_WRAPPED_KEY);
  const method = localStorage.getItem(PASSKEY_METHOD_KEY) as "prf" | "largeBlob" | null;
  const isYubiKeyLegacy = localStorage.getItem(PASSKEY_IS_YUBIKEY) === "true";

  if (!credentialId || !wrappedB64) {
    throw new Error("No passkey enrolled");
  }

  // Legacy enrollments (before PASSKEY_METHOD_KEY existed)
  const enrolledMethod: "prf" | "largeBlob" = method ?? (isYubiKeyLegacy ? "largeBlob" : "prf");

  // Try the enrolled method first
  if (enrolledMethod === "largeBlob") {
    const credentialIdBuf = base64URLStringToBuffer(credentialId);
    const authOptions: PublicKeyCredentialRequestOptions = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{ id: credentialIdBuf, type: "public-key" }],
      userVerification: "required",
      extensions: { largeBlob: { read: true } } as unknown as AuthenticationExtensionsClientInputs,
    };

    try {
      const assertion = (await navigator.credentials.get({
        publicKey: authOptions,
      })) as PublicKeyCredential | null;
      const ext = (assertion as unknown as { getClientExtensionResults?: () => { largeBlob?: { blob?: ArrayBuffer } } })?.getClientExtensionResults?.();
      const blob = ext?.largeBlob?.blob;

      if (blob) {
        const wrappingKey = await crypto.subtle.importKey("raw", new Uint8Array(blob), "HKDF", false, [
          "deriveKey",
        ]);
        const derivedKey = await crypto.subtle.deriveKey(
          {
            name: "HKDF",
            salt: new TextEncoder().encode(PASSKEY_SALT),
            info: new Uint8Array(0),
            hash: "SHA-256",
          },
          wrappingKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        const masterKey = await unwrapMasterKey(wrappedB64, derivedKey);
        return { masterKey, method: "largeBlob" };
      }
    } catch {
      // largeBlob read failed — try PRF fallback (YubiKey may support both)
    }
  }

  // Try PRF (primary for platform, fallback for YubiKey)
  try {
    const masterKey = await unlockWithPrf(credentialId, wrappedB64);
    return { masterKey, method: "prf" };
  } catch {
    // PRF also failed
  }

  // Nothing worked. Give a clear error based on what was enrolled.
  if (enrolledMethod === "largeBlob") {
    throw new Error(
      "YubiKey unlock failed. largeBlob data is missing and PRF is not available. " +
        "Try re-inserting your YubiKey, or use a secret key instead.",
    );
  }
  throw new Error("Passkey unlock failed. PRF is not available on this authenticator. Use a secret key instead.");
}

/* ── Enrollment Status ─────────────────────────────────────── */

export function hasPasskeyEnrolled(): boolean {
  return !!localStorage.getItem(PASSKEY_CREDENTIAL_KEY) && !!localStorage.getItem(PASSKEY_WRAPPED_KEY);
}

export function getPasskeyEnrollment(): PasskeyEnrollment | null {
  const credentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY);
  const isYubiKey = localStorage.getItem(PASSKEY_IS_YUBIKEY) === "true";
  const method = localStorage.getItem(PASSKEY_METHOD_KEY) as "prf" | "largeBlob" | null;
  if (!credentialId) return null;
  return { credentialId, isYubiKey, method: method ?? (isYubiKey ? "largeBlob" : "prf") };
}

/** Remove passkey enrollment. */
export function removePasskeyEnrollment(): void {
  try { localStorage.removeItem(PASSKEY_CREDENTIAL_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(PASSKEY_WRAPPED_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(PASSKEY_IS_YUBIKEY); } catch { /* ignore */ }
  try { localStorage.removeItem(PASSKEY_METHOD_KEY); } catch { /* ignore */ }
}

/* ── Error Codes ───────────────────────────────────────────── */

export const PasskeyError = {
  NOT_AVAILABLE: "Passkeys are not available on this device",
  PRF_NOT_SUPPORTED:
    "Your authenticator does not support PRF. Use a secret key or a PRF-capable device (YubiKey Bio, Touch ID, etc.)",
  CANCELLED: "Authentication was cancelled",
  NO_ENROLLMENT: "No passkey enrolled. Set up a passkey first.",
  WRAP_FAILED: "Failed to wrap master key",
  UNWRAP_FAILED: "Failed to unlock — wrong authenticator or corrupted data",
} as const;
