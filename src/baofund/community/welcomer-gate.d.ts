/**
 * Welcomer gate — P3 admission menu evaluation.
 *
 * The base policy (open / cap-pow) and the invite-v2 gate run FIRST; when
 * the room provisions an admission menu, it is evaluated AFTER those pass.
 * Proofs ride INSIDE the encrypted join request — the relay never sees
 * claimed identities, credentials, or vouches (§6).
 *
 * This module is the only place in the codebase that imports from admission.ts.
 * The welcomer-core module (base protocol) has zero dependency on this seam.
 */
import { type Clock } from './crypto.js';
import { type AdmissionMenu, type AdmissionProofs, type AdmissionProviders, type AdmissionResult, type VouchBudget } from './admission.js';
export interface JoinMenuGateConfig {
    roomId: string;
    menu: AdmissionMenu;
    providers: AdmissionProviders & {
        vouchBudget: VouchBudget;
    };
    clock?: Clock;
}
/**
 * Evaluate the P3 admission menu for a join. Called by the welcomer daemon
 * AFTER the base policy + invite gate pass. `proofs` come from the
 * decrypted join request payload.
 */
export declare function evaluateJoinAdmissionMenu(cfg: JoinMenuGateConfig, burnerPub: string, proofs: AdmissionProofs): Promise<AdmissionResult>;
