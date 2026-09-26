export declare function memberAdmissionClaimHash(roomId: string, burnerPub: string, memberPub: string): Uint8Array;
/** Build the admission claim carried inside the encrypted join request. */
export declare function buildMemberAdmissionClaim(memberSecretKey: Uint8Array, roomId: string, burnerPub: string): Promise<{
    memberPub: string;
    sig: string;
}>;
/** Verify an admission claim: the member key controls its signature over
 *  (roomId, burnerPub, memberPub). Never throws. */
export declare function verifyMemberAdmissionClaim(claim: {
    memberPub?: unknown;
    sig?: unknown;
} | undefined, roomId: string, burnerPub: string): boolean;
/** Identity policy for a room, parsed from its provisioned config string:
 *  'none' (default — policy off, no gating) | 'all' (a verified claim is
 *  REQUIRED) | 'selected:<hex64>[,<hex64>…] (verified claim REQUIRED and
 *  the member key must be listed). Parse failure = fail-closed `invalid`
 *  (the daemon refuses to start with a policy it cannot honor). */
export type MemberPolicy = {
    policy: 'none';
} | {
    policy: 'all';
} | {
    policy: 'selected';
    allowlist: Set<string>;
} | {
    policy: 'invalid';
};
export declare function parseMemberPolicy(raw: unknown): MemberPolicy;
/** Evaluate the member-claim policy for a join. Returns a verdict the
 *  daemon logs; `none` always admits (policy off). */
export declare function evaluateMemberPolicy(policy: MemberPolicy, req: {
    member?: {
        memberPub?: unknown;
        sig?: unknown;
    };
}, roomId: string, burnerPub: string): {
    verdict: 'admit' | 'reject';
    reason: string;
    memberPub?: string;
};
