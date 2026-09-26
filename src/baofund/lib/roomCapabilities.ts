/**
 * Room capability document (review R07 - consumer side of storage
 * observation). A room's relay is probed with `probeRelayStorage` and the
 * measured verdict - NOT the relay's self-description - becomes the room's
 * machine-readable storage capability. Semantics are fail-closed:
 *
 *   - `unknown`  probe missing, inconclusive, rejected, timed out or
 *                transport-failed - the relay MAY store everything;
 *   - `stored`   the probe WAS served back to a fresh reader - the relay
 *                provably stores this event kind despite any claim;
 *   - `not-observed-storing`  live delivery succeeded, the fresh reader got
 *                EOSE with no event. Records that THIS SAMPLE was not served
 *                back. It is not a guarantee: a hostile relay can special-case
 *                the probe, and deletion-after-read exists. (The module also
 *                treats an unparseable/absent NIP-11 assertion as nothing.)
 *
 * A negative observation can therefore never render "nothing is stored".
 * Every verdict carries the probe contract version so a consumer can tell
 * stale measurements from fresh ones.
 */
export const ROOM_CAPABILITIES_VERSION = 1;

export const PROBE_CONTRACT_VERSION = 1;

/** Versioned, machine-readable capability document for one room+relay pair. */
export interface RoomCapabilities {
  /** Schema version for the document itself. */
  version: typeof ROOM_CAPABILITIES_VERSION;
  /** Version of the probe contract that produced `storageVerdict`. */
  probeContract: typeof PROBE_CONTRACT_VERSION;
  /** Storage observation verdict for the room's relay. */
  storageVerdict: StorageVerdict;
  /** Whether the room's transport is shielded (NIP-59 gift wrap). */
  shielded: boolean;
  /** The joined room's CURRENT epoch (join result); verdicts are per-epoch.
   *  Null until a join provides one (probe-only docs, failed/rejected joins);
   *  epoch 0 is a real epoch and is preserved, never coerced to null. */
  epoch: number | null;
  /** Probe measurement time (unix seconds); consumers decide staleness. */
  observedAt: number | null;
  /** Relay URL the verdict applies to (capability is per-relay). */
  relayUrl: string | null;
}

export type StorageVerdict = 'unknown' | 'stored' | 'not-observed-storing';

export interface ProbeLike {
  storesEphemeral?: boolean;
  conclusive?: boolean;
  liveDelivered?: boolean;
  accepted?: boolean;
}

/** Fold one probe result into the fail-closed storage verdict. */
export function storageVerdictFromProbe(probe: ProbeLike | null | undefined): StorageVerdict {
  if (!probe) return 'unknown';
  if (probe.accepted === false) return 'unknown'; // rejection proves nothing
  if (probe.conclusive && probe.storesEphemeral === true) return 'stored';
  if (probe.conclusive && probe.storesEphemeral === false) return 'not-observed-storing';
  return 'unknown';
}

export interface CapabilityInput {
  probe?: ProbeLike | null;
  shielded?: boolean;
  epoch?: number | null;
  /** Probe completion time (unix seconds). */
  observedAt?: number | null;
  relayUrl?: string | null;
}

/** Build the versioned capability document. Absent probe ⇒ `unknown`. */
export function buildRoomCapabilities(input: CapabilityInput): RoomCapabilities {
  return {
    version: ROOM_CAPABILITIES_VERSION,
    probeContract: PROBE_CONTRACT_VERSION,
    storageVerdict: storageVerdictFromProbe(input.probe),
    shielded: input.shielded === true,
    epoch: input.epoch ?? null,
    observedAt: input.observedAt ?? null,
    relayUrl: input.relayUrl ?? null,
  };
}

/** Human-facing advisory lines for the rooms that OPT IN to the live-only
 *  storage check (today: BAO). Each verdict's wording preserves the
 *  honest limits - especially "not-observed-storing", which must never read
 *  as a promise that nothing is stored. Rooms that do not opt in never see
 *  these lines at all. */
export function storageVerdictAdvisory(verdict: StorageVerdict, relayUrl: string | null): string[] {
  void relayUrl; // reserved for relay-specific detail in a future version
  switch (verdict) {
    case 'stored':
      return [
        'Live-only check failed: this relay kept a test message that should have vanished - the room’s retention needs fixing.',
      ];
    case 'not-observed-storing':
      return [
        'Live-only check passed: a fresh reader did not receive the test message back. This sample showed no retention - it is not a guarantee. A relay can store anything it sees.',
      ];
    case 'unknown':
    default:
      return [
        'Live-only check not measured (probe missing, rejected or timed out). Treat this relay as retaining everything it can read.',
      ];
  }
}

/** Join-time gate for rooms advertised as live-only / ephemeral. The room's
 * own advertisement (join-link or NIP-11) is a CLAIM; the measured verdict is
 * the evidence. `stored` fails the check; `unknown` fails closed. */
export function liveOnlyAdmission(verdict: StorageVerdict): { ok: boolean; reason?: string } {
  if (verdict === 'not-observed-storing') return { ok: true };
  if (verdict === 'stored') {
    return { ok: false, reason: 'Relay measured STORING events advertised as ephemeral - join refused.' };
  }
  return { ok: false, reason: 'Storage behavior not measured (probe missing/inconclusive) - join refused (fail closed).' };
}

/** Re-evaluate an existing document against a newer probe result. */
export function applyProbeToCapabilities(doc: RoomCapabilities, probe: ProbeLike | null, observedAt: number): RoomCapabilities {
  return {
    ...doc,
    probeContract: PROBE_CONTRACT_VERSION,
    storageVerdict: storageVerdictFromProbe(probe),
    observedAt,
  };
}
