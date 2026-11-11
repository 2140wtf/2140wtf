/**
 * courtPins - the client's trust anchors for BAO Court relay data.
 *
 * Two pins, both fail-closed:
 *
 * - {@link courtGroupPin} - the empaneled FROST group key. Kind-39018 batch
 *   attestations and kind-39007 verdict attestations verify against it.
 * - {@link courtProposalPin} - the key allowed to assert a case's
 *   *attribution* (the `dispute` tag on a kind-38026 proposal, and the
 *   publisher of a summons). Defaults to the group key: a deployment that
 *   publishes proposals/summons from a separate coordinator key sets
 *   `VITE_FUND_COURT_PROPOSAL_PUBKEY`.
 *
 * Security round 35: a batch leaf binds `(session, outcome, supporting)`
 * only, never the case id, so without a publisher pin any key could replay a
 * genuine court-signed batch under a different `dispute` tag and the client
 * would show that case `final`. A pin that is unset or malformed falls back
 * to the group key - never to "no pin".
 */
import { fundCourtGroupPubkey } from "@/baofund/lib/court/courtGroupPubkey";

const HEX64 = /^[0-9a-f]{64}$/;

/** The pinned court group key (lowercase), or null when unresolvable. */
export function courtGroupPin(): string | null {
  const pin = fundCourtGroupPubkey();
  return typeof pin === "string" ? normalisePin(pin) : null;
}

/**
 * The key allowed to assert case attribution / publish summons. Falls back to
 * the group pin, so this is only null when there is no usable anchor at all.
 */
export function courtProposalPin(): string | null {
  const raw = import.meta.env.VITE_FUND_COURT_PROPOSAL_PUBKEY;
  if (typeof raw === "string") {
    const normalised = normalisePin(raw);
    if (normalised) return normalised;
  }
  return courtGroupPin();
}

function normalisePin(value: string): string | null {
  const lower = value.toLowerCase();
  return HEX64.test(lower) ? lower : null;
}
