/**
 * Redact Nostr/Bitcoin wallet secrets from free-form strings before they are
 * logged, displayed, or sent to telemetry.
 *
 * This is a defense-in-depth helper; sensitive values should never be
 * interpolated into messages in the first place.
 */
export function redactSecrets(value: string): string {
  return (
    value
      // nsec private keys (bech32)
      .replace(/nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}/g, 'nsec1***')
      // NWC connection URIs (both accepted spellings)
      .replace(/(nostr\+walletconnect:\/\/|nostrwalletconnect:\/\/)[^\s"'<>]*/gi, '[nwc-uri-redacted]')
      // NIP-46 bunker URIs
      .replace(/(bunker:\/\/)[^\s"'<>]*/gi, '[bunker-uri-redacted]')
      // 64-char hex that is very likely a private key because it is surrounded
      // by words like private/secret/key/seed in the same string fragment.
      .replace(
        /((?:private|secret|priv|key|seed|nsec|hex)\s*[:=]?\s*)([0-9a-fA-F]{64})(\b)/gi,
        '$1[hex-redacted]$3',
      )
  );
}

/** Keys whose values should be replaced wholesale in telemetry objects. */
const SENSITIVE_KEYS = new Set([
  'secret',
  'secretKey',
  'privateKey',
  'privateKeyHex',
  'privkey',
  'seed',
  'mnemonic',
  'nwcUri',
  'nostrWalletConnectUri',
  'bunkerUri',
  'connectionSecret',
  'clientKey',
  'proofs',
  'cashuSeed',
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('private');
}

/**
 * Recursively redact secrets from an arbitrary Sentry/telemetry payload.
 * Preserves structure but replaces sensitive string values and sensitive-keyed
 * values with placeholders.
 */
export function redactSensitiveData(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? '[REDACTED]' : redactSensitiveData(val);
    }
    return result;
  }
  return value;
}
