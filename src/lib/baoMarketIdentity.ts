/**
 * BAO per-market anonymous trading identity.
 *
 * Derives a market-specific secp256k1 keypair from the user's master Nostr
 * private key. The derived pubkey is used as `trader_pubkey` on `/v1/smj/bet`
 * so the trade record is unlinkable to the user's main identity across
 * markets. The API verifies a schnorr proof signed by the master key.
 *
 * Derivation matches packages/api/src/services/marketIdentity.ts:
 *   baoId = `market-${marketId}`
 *   path  = `bao/${baoId}/0`
 *   privkey = HMAC-SHA256(key=masterPrivkey, message=path), clamped to valid scalar
 *   pubkey  = secp256k1 schnorr public key of privkey
 *
 * Proof:
 *   sig = schnorr.sign(sha256("bao-market-trade:" + marketId + ":" + pubkey), masterPrivkey)
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';

const DERIVATION_INDEX = 0;
const HEX_PRIVKEY_LENGTH = 64;
const SECP256K1_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const TRADE_PROOF_PREFIX = 'bao-market-trade:';

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result = (result << BigInt(8)) + BigInt(bytes[i]);
  }
  return result;
}

function ensureValidScalar(derived: Uint8Array, depth = 0): Uint8Array {
  if (depth >= 100) {
    throw new Error('ensureValidScalar: failed to produce a valid scalar');
  }
  const scalar = bytesToBigInt(derived);
  if (scalar === BigInt(0) || scalar >= SECP256K1_ORDER) {
    const tweaked = hmac(sha256, derived, new TextEncoder().encode('scalar-tweak'));
    return ensureValidScalar(tweaked, depth + 1);
  }
  return derived;
}

export interface MarketIdentity {
  marketId: string;
  masterPubkey: string;
  pubkey: string;
  privkey: string;
}

/**
 * Derive a deterministic market-specific identity from the master nsec.
 * @param masterPrivkey 64-character hex private key
 * @param marketId Market identifier
 */
export function getBaoMarketIdentity(masterPrivkey: string, marketId: string): MarketIdentity {
  if (!masterPrivkey || masterPrivkey.length !== HEX_PRIVKEY_LENGTH || !/^[0-9a-fA-F]+$/.test(masterPrivkey)) {
    throw new Error('Invalid master private key');
  }
  if (!marketId || marketId.length > 256) {
    throw new Error('Invalid marketId');
  }

  const baoId = `market-${marketId}`;
  const derivationPath = `bao/${baoId}/${DERIVATION_INDEX}`;
  const seed = hexToBytes(masterPrivkey);
  const path = new TextEncoder().encode(derivationPath);
  const derived = ensureValidScalar(hmac(sha256, seed, path));
  const privkey = bytesToHex(derived);
  const pubkey = bytesToHex(schnorr.getPublicKey(derived));
  const masterPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(masterPrivkey)));

  return { marketId, masterPubkey, pubkey, privkey };
}

/**
 * Generate the proof the API requires to accept a derived trader_pubkey.
 */
export function signBaoMarketTradeProof(
  masterPrivkey: string,
  marketId: string,
  derivedPubkey: string,
): string {
  const msg = sha256(new TextEncoder().encode(`${TRADE_PROOF_PREFIX}${marketId}:${derivedPubkey}`));
  const sig = schnorr.sign(msg, hexToBytes(masterPrivkey));
  return bytesToHex(sig);
}

/**
 * Convenience: get identity + proof in one call.
 */
export function getBaoMarketIdentityWithProof(
  masterPrivkey: string,
  marketId: string,
): MarketIdentity & { proof: string } {
  const identity = getBaoMarketIdentity(masterPrivkey, marketId);
  const proof = signBaoMarketTradeProof(masterPrivkey, marketId, identity.pubkey);
  return { ...identity, proof };
}
