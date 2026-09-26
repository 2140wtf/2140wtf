import { evaluateAdmission, } from './admission.js';
/**
 * Evaluate the P3 admission menu for a join. Called by the welcomer daemon
 * AFTER the base policy + invite gate pass. `proofs` come from the
 * decrypted join request payload.
 */
export async function evaluateJoinAdmissionMenu(cfg, burnerPub, proofs) {
    return evaluateAdmission(cfg.menu, proofs, {
        roomId: cfg.roomId,
        burnerPub,
        ...(cfg.clock !== undefined ? { clock: cfg.clock } : {}),
    }, cfg.providers);
}
