export interface OwnerAttestation {
    owner: string;
    conditions: string;
    sig: string;
}
export type Condition = {
    type: 'kind';
    value: number;
} | {
    type: 'created_at<';
    value: number;
} | {
    type: 'created_at>';
    value: number;
};
/** Parse an `auth` tag. Null when malformed (wrong arity, bad hex). */
export declare function parseAuthTag(tag: unknown): OwnerAttestation | null;
/** SHA256("nostr:agent-auth:" || agentPub || ":" || conditions). */
export declare function authPreimageHash(agentPub: string, conditions: string): Uint8Array;
/** Verify the owner signature over the agent-binding preimage. */
export declare function verifyOwnerAttestation(att: OwnerAttestation, agentPub: string): boolean;
/**
 * Parse and validate the conditions grammar. Returns the clause list, or
 * null when the string is malformed (whitespace, empty clauses, bad
 * operators, non-canonical decimals, out-of-range values, unknown clauses).
 */
export declare function parseConditions(conditions: string): Condition[] | null;
/** Evaluate every clause against an event. Malformed conditions → false. */
export declare function evaluateConditions(conditions: string, event: {
    kind: number;
    created_at: number;
}): boolean;
/**
 * Full NIP-OA event-level verification: the event must carry EXACTLY ONE
 * well-formed auth tag, the owner must differ from the event author (no
 * self-attestation), the signature must verify over the event-author
 * binding, and every condition clause must hold against the event.
 */
export declare function verifyAuthTag(event: {
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
}): boolean;
/**
 * Proof that the joiner controls the claimed agent key: a schnorr signature
 * by the AGENT key over SHA256("bao/agent-join:" || roomId || ":" || burnerPub).
 * The burner signs the join request; this proves the durable agent identity
 * behind it without ever putting the agent key on the wire.
 */
export declare function agentJoinProofHash(roomId: string, burnerPub: string): Uint8Array;
export declare function buildAgentJoinProof(agentSecretKey: Uint8Array, roomId: string, burnerPub: string): Promise<string>;
export declare function verifyAgentJoinProof(proof: string, agentPub: string, roomId: string, burnerPub: string): boolean;
/**
 * Full admission check for an externally-attested agent join:
 *   1. the claimed agent pubkey carries a valid NIP-OA from a LISTED owner;
 *   2. the joiner proves control of the agent key (join proof);
 *   3. condition clauses, if any, hold (time clauses evaluate against the
 *      join request's created_at; kind= clauses are identity-binding only
 *      and are not meaningful at admission, mirroring NIP-IA's treatment).
 */
export declare function verifyAgentAdmission(args: {
    agentPub: string;
    authTag: unknown;
    joinProof: string;
    roomId: string;
    burnerPub: string;
    oaOwners: string[];
    nowSec?: number;
}): boolean;
