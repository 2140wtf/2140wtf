/**
 * nipOa — NIP-OA owner attestation verification (external-agent admission).
 *
 * NIP-OA lets an owner key authorize an agent key: an `auth` tag proves the
 * agent was authorized by a human (or org) without assigning the event to
 * the owner. This is how agents built on OTHER stacks (Buzz & co.) arrive
 * at our rooms carrying verifiable provenance instead of an anonymous key.
 *
 * ATTRIBUTION, NOT PROOF (design rule — SAM middleware lesson): an owner
 * attestation is the owner's WORD about who speaks. It is not a capability
 * and proves nothing about what the agent may DO; policy that cares about
 * authorization must bind it separately (admission menu verdicts today;
 * attenuated capabilities if/when deferred register triggers). Keep the
 * two layers conceptually distinct in every caller: attribution feeds
 * identity/roster decisions; proofs gate actions.
 *
 * Tag shape (exactly four elements):
 *   ["auth", "<owner-pubkey-hex>", "<conditions>", "<sig-hex>"]
 * Preimage:  "nostr:agent-auth:" || agentPubkey || ":" || conditions
 * Message:   SHA256(preimage)   — BIP-340 schnorr verify under the owner key.
 *
 * Conditions grammar: clauses joined by '&', each one of
 *   kind=<decimal> | created_at<<decimal> | created_at><decimal>
 * Empty string = no constraints. No whitespace, no empty clauses, canonical
 * decimals (no leading zeroes). The conditions string is part of the signed
 * preimage — verifiers MUST use it exactly as written (never reorder,
 * dedupe, or canonicalize before hashing).
 *
 * Clean-room implementation from the published spec; includes the spec's
 * test vector in the test suite.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const DOMAIN = 'nostr:agent-auth:';
/** Parse an `auth` tag. Null when malformed (wrong arity, bad hex). */
export function parseAuthTag(tag) {
    if (!Array.isArray(tag) || tag.length !== 4 || tag[0] !== 'auth')
        return null;
    const [, owner, conditions, sig] = tag;
    if (typeof owner !== 'string' || !HEX64.test(owner))
        return null;
    if (typeof conditions !== 'string')
        return null;
    if (typeof sig !== 'string' || !HEX128.test(sig))
        return null;
    return { owner: owner.toLowerCase(), conditions, sig };
}
/** SHA256("nostr:agent-auth:" || agentPub || ":" || conditions). */
export function authPreimageHash(agentPub, conditions) {
    return sha256(utf8ToBytes(`${DOMAIN}${agentPub.toLowerCase()}:${conditions}`));
}
/** Verify the owner signature over the agent-binding preimage. */
export function verifyOwnerAttestation(att, agentPub) {
    if (!HEX64.test(agentPub))
        return false;
    try {
        return schnorr.verify(hexToBytes(att.sig), authPreimageHash(agentPub, att.conditions), hexToBytes(att.owner));
    }
    catch {
        return false;
    }
}
/**
 * Parse and validate the conditions grammar. Returns the clause list, or
 * null when the string is malformed (whitespace, empty clauses, bad
 * operators, non-canonical decimals, out-of-range values, unknown clauses).
 */
export function parseConditions(conditions) {
    if (conditions === '')
        return [];
    if (/\s/.test(conditions))
        return null;
    const parts = conditions.split('&');
    const out = [];
    for (const part of parts) {
        if (part.length === 0)
            return null; // leading/trailing/double '&'
        let m = /^kind=(\d+)$/.exec(part);
        if (m) {
            if (m[1].length > 1 && m[1].startsWith('0'))
                return null; // canonical decimal
            const v = Number(m[1]);
            if (!Number.isSafeInteger(v) || v < 0 || v > 65535)
                return null;
            out.push({ type: 'kind', value: v });
            continue;
        }
        m = /^created_at([<>])(\d+)$/.exec(part);
        if (m) {
            if (m[2].length > 1 && m[2].startsWith('0'))
                return null;
            const v = Number(m[2]);
            if (!Number.isSafeInteger(v) || v < 0 || v > 4294967295)
                return null;
            out.push({ type: m[1] === '<' ? 'created_at<' : 'created_at>', value: v });
            continue;
        }
        return null; // unknown clause
    }
    return out;
}
/** Evaluate every clause against an event. Malformed conditions → false. */
export function evaluateConditions(conditions, event) {
    const clauses = parseConditions(conditions);
    if (clauses === null)
        return false;
    for (const c of clauses) {
        if (c.type === 'kind' && event.kind !== c.value)
            return false;
        if (c.type === 'created_at<' && !(event.created_at < c.value))
            return false;
        if (c.type === 'created_at>' && !(event.created_at > c.value))
            return false;
    }
    return true;
}
/**
 * Full NIP-OA event-level verification: the event must carry EXACTLY ONE
 * well-formed auth tag, the owner must differ from the event author (no
 * self-attestation), the signature must verify over the event-author
 * binding, and every condition clause must hold against the event.
 */
export function verifyAuthTag(event) {
    const authTags = event.tags.filter((t) => t[0] === 'auth');
    if (authTags.length !== 1)
        return false; // zero or multiple → no valid tag
    const att = parseAuthTag(authTags[0]);
    if (!att)
        return false;
    if (att.owner === event.pubkey.toLowerCase())
        return false; // self-attestation
    if (!verifyOwnerAttestation(att, event.pubkey))
        return false;
    return evaluateConditions(att.conditions, event);
}
// ─── Agent-join binding (our admission lane) ────────────────────────────────
/**
 * Proof that the joiner controls the claimed agent key: a schnorr signature
 * by the AGENT key over SHA256("bao/agent-join:" || roomId || ":" || burnerPub).
 * The burner signs the join request; this proves the durable agent identity
 * behind it without ever putting the agent key on the wire.
 */
export function agentJoinProofHash(roomId, burnerPub) {
    return sha256(utf8ToBytes(`bao/agent-join:${roomId}:${burnerPub.toLowerCase()}`));
}
export async function buildAgentJoinProof(agentSecretKey, roomId, burnerPub) {
    return bytesToHex(await schnorr.sign(agentJoinProofHash(roomId, burnerPub), agentSecretKey));
}
export function verifyAgentJoinProof(proof, agentPub, roomId, burnerPub) {
    if (!HEX128.test(proof) || !HEX64.test(agentPub))
        return false;
    try {
        return schnorr.verify(hexToBytes(proof), agentJoinProofHash(roomId, burnerPub), hexToBytes(agentPub));
    }
    catch {
        return false;
    }
}
/**
 * Full admission check for an externally-attested agent join:
 *   1. the claimed agent pubkey carries a valid NIP-OA from a LISTED owner;
 *   2. the joiner proves control of the agent key (join proof);
 *   3. condition clauses, if any, hold (time clauses evaluate against the
 *      join request's created_at; kind= clauses are identity-binding only
 *      and are not meaningful at admission, mirroring NIP-IA's treatment).
 */
export function verifyAgentAdmission(args) {
    const owners = new Set(args.oaOwners.map((o) => o.toLowerCase()));
    const att = parseAuthTag(args.authTag);
    if (!att)
        return false;
    if (!owners.has(att.owner))
        return false;
    if (att.owner === args.agentPub.toLowerCase())
        return false;
    if (!verifyOwnerAttestation(att, args.agentPub))
        return false;
    const clauses = parseConditions(att.conditions);
    if (clauses === null)
        return false;
    // Time clauses bound the credential's freshness; kind= clauses are not
    // meaningful for admission (identity-binding evidence, not capability).
    const now = args.nowSec ?? Math.floor(Date.now() / 1000);
    for (const c of clauses) {
        if (c.type === 'created_at<' && !(now < c.value))
            return false;
        if (c.type === 'created_at>' && !(now > c.value))
            return false;
    }
    return verifyAgentJoinProof(args.joinProof, args.agentPub, args.roomId, args.burnerPub);
}
