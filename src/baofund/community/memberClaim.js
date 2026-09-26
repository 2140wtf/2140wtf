/**
 * Durable member-claim admission (audit F7, welcomer half).
 *
 * A joiner proves KEY CONTROL of a durable, room-scoped member key at
 * admission: a schnorr signature by the member key over a domain-separated
 * digest binding (roomId, burnerPub, memberPub). The claim rides INSIDE the
 * NIP-44-encrypted join request (never relay-visible, §6) next to the
 * existing agent lane. Verification gives the welcomer a STABLE identity to
 * gate, allowlist and log across joins — a banned member key cannot rejoin
 * on a fresh burner, which is exactly the ban-evasion hole the in-room
 * claim alone cannot close (a patched client simply rotates burners).
 *
 * Agent parity: identical treatment for agents and humans, no personhood
 * attestation, no actor-class branching anywhere (owner invariant).
 * Rooms with no member policy admit exactly as before (fully optional).
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { utf8ToBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX128 = /^[0-9a-fA-F]{128}$/;
/** Domain separation — MUST match the in-room claim digest shape by room/
 *  epoch binding semantics: the admission claim omits epoch (the burner has
 *  none yet) and binds roomId + burner instead. */
const CLAIM_DOMAIN = 'bao-fund/member-claim-admission/v1';
export function memberAdmissionClaimHash(roomId, burnerPub, memberPub) {
    return sha256(utf8ToBytes(`${CLAIM_DOMAIN}\n${roomId}\n${burnerPub.toLowerCase()}\n${memberPub.toLowerCase()}`));
}
/** Build the admission claim carried inside the encrypted join request. */
export async function buildMemberAdmissionClaim(memberSecretKey, roomId, burnerPub) {
    const memberPub = bytesToHex(schnorr.getPublicKey(memberSecretKey));
    const sig = bytesToHex(await schnorr.sign(memberAdmissionClaimHash(roomId, burnerPub, memberPub), memberSecretKey));
    return { memberPub, sig };
}
/** Verify an admission claim: the member key controls its signature over
 *  (roomId, burnerPub, memberPub). Never throws. */
export function verifyMemberAdmissionClaim(claim, roomId, burnerPub) {
    if (!claim || typeof claim !== 'object')
        return false;
    const { memberPub, sig } = claim;
    if (typeof memberPub !== 'string' || !HEX64.test(memberPub))
        return false;
    if (typeof sig !== 'string' || !HEX128.test(sig))
        return false;
    try {
        return schnorr.verify(hexToBytes(sig), memberAdmissionClaimHash(roomId, burnerPub, memberPub), hexToBytes(memberPub));
    }
    catch {
        return false;
    }
}
export function parseMemberPolicy(raw) {
    if (raw === undefined || raw === null || raw === '' || raw === 'none')
        return { policy: 'none' };
    if (raw === 'all')
        return { policy: 'all' };
    if (typeof raw === 'string' && raw.startsWith('selected:')) {
        const list = raw.slice('selected:'.length).split(',').map((s) => s.trim().toLowerCase()).filter((s) => HEX64.test(s));
        if (list.length === 0)
            return { policy: 'invalid' };
        return { policy: 'selected', allowlist: new Set(list) };
    }
    return { policy: 'invalid' };
}
/** Evaluate the member-claim policy for a join. Returns a verdict the
 *  daemon logs; `none` always admits (policy off). */
export function evaluateMemberPolicy(policy, req, roomId, burnerPub) {
    if (policy.policy === 'invalid')
        return { verdict: 'reject', reason: 'member policy invalid (config)' };
    if (policy.policy === 'none')
        return { verdict: 'admit', reason: 'member policy none' };
    if (!verifyMemberAdmissionClaim(req.member, roomId, burnerPub)) {
        return { verdict: 'reject', reason: policy.policy === 'all' ? 'member claim missing or invalid' : 'member claim missing or invalid (policy selected)' };
    }
    const memberPub = String(req.member.memberPub).toLowerCase();
    if (policy.policy === 'selected' && !policy.allowlist.has(memberPub)) {
        return { verdict: 'reject', reason: 'member key not on room allowlist', memberPub };
    }
    return { verdict: 'admit', reason: 'member claim verified', memberPub };
}
