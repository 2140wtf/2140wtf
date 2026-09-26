import { describe, expect, it } from 'vitest';
import {
  ROOM_CAPABILITIES_VERSION,
  PROBE_CONTRACT_VERSION,
  storageVerdictFromProbe,
  buildRoomCapabilities,
  storageVerdictAdvisory,
  liveOnlyAdmission,
  applyProbeToCapabilities,
} from './roomCapabilities';

describe('storageVerdictFromProbe - fail-closed folding', () => {
  it('maps a missing/inconclusive/rejected probe to unknown', () => {
    expect(storageVerdictFromProbe(null)).toBe('unknown');
    expect(storageVerdictFromProbe(undefined)).toBe('unknown');
    expect(storageVerdictFromProbe({})).toBe('unknown');
    expect(storageVerdictFromProbe({ conclusive: false, storesEphemeral: true })).toBe('unknown');
    expect(storageVerdictFromProbe({ accepted: false, conclusive: true, storesEphemeral: true })).toBe('unknown');
    expect(storageVerdictFromProbe({ accepted: false, conclusive: false, storesEphemeral: false })).toBe('unknown');
  });

  it('maps a decisive stored verdict', () => {
    expect(storageVerdictFromProbe({ conclusive: true, storesEphemeral: true, liveDelivered: true })).toBe('stored');
  });

  it('maps a decisive not-observed-storing verdict', () => {
    expect(storageVerdictFromProbe({ conclusive: true, storesEphemeral: false, liveDelivered: true })).toBe('not-observed-storing');
  });

  it('treats conclusive=false with storesEphemeral=true (default false-closed field) as unknown', () => {
    // The probe defaults storesEphemeral=true when inconclusive; verdict must stay unknown.
    expect(storageVerdictFromProbe({ conclusive: false, storesEphemeral: true, liveDelivered: false })).toBe('unknown');
  });
});

describe('buildRoomCapabilities', () => {
  it('produces a versioned document with unknown verdict when no probe given', () => {
    const doc = buildRoomCapabilities({ shielded: true, epoch: 3 });
    expect(doc.version).toBe(ROOM_CAPABILITIES_VERSION);
    expect(doc.probeContract).toBe(PROBE_CONTRACT_VERSION);
    expect(doc.storageVerdict).toBe('unknown');
    expect(doc.shielded).toBe(true);
    expect(doc.epoch).toBe(3);
    expect(doc.observedAt).toBeNull();
    expect(doc.relayUrl).toBeNull();
  });

  it('keeps epoch 0 distinct from null and coerces an absent epoch to null', () => {
    expect(buildRoomCapabilities({ epoch: 0 }).epoch).toBe(0);
    expect(buildRoomCapabilities({ epoch: null }).epoch).toBeNull();
    expect(buildRoomCapabilities({}).epoch).toBeNull();
  });

  it('records relay, time and verdict when a probe is applied', () => {
    const doc = buildRoomCapabilities({
      probe: { conclusive: true, storesEphemeral: false, liveDelivered: true },
      shielded: false,
      epoch: 1,
      observedAt: 1_000,
      relayUrl: 'wss://relay.bao.fund',
    });
    expect(doc.storageVerdict).toBe('not-observed-storing');
    expect(doc.observedAt).toBe(1_000);
    expect(doc.relayUrl).toBe('wss://relay.bao.fund');
  });
});

describe('storageVerdictAdvisory - honest wording per verdict', () => {
  const relay = 'wss://relay.bao.fund';
  it('stored verdict reports the live-only check failed', () => {
    const lines = storageVerdictAdvisory('stored', relay);
    expect(lines.join(' ')).toMatch(/kept a test message/i);
    expect(lines.join(' ')).toMatch(/needs fixing/i);
  });

  it('not-observed-storing never promises deletion', () => {
    const lines = storageVerdictAdvisory('not-observed-storing', relay).join(' ');
    expect(lines).toMatch(/not a guarantee/i);
    expect(lines).toMatch(/can store anything/i);
  });

  it('unknown verdict instructs assuming retention', () => {
    const lines = storageVerdictAdvisory('unknown', relay).join(' ');
    expect(lines).toMatch(/not measured/i);
    expect(lines).toMatch(/retaining everything/i);
  });

  it('accepts a null relay URL', () => {
    expect(() => storageVerdictAdvisory('unknown', null)).not.toThrow();
  });
});

describe('liveOnlyAdmission - join gate fails closed', () => {
  it('admits only a measured not-observed-storing relay', () => {
    expect(liveOnlyAdmission('not-observed-storing')).toEqual({ ok: true });
    expect(liveOnlyAdmission('stored').ok).toBe(false);
    expect(liveOnlyAdmission('unknown').ok).toBe(false);
  });

  it('gives a reason for both refusal cases', () => {
    expect(liveOnlyAdmission('stored').reason).toMatch(/storing/i);
    expect(liveOnlyAdmission('unknown').reason).toMatch(/not measured|fail closed/i);
  });
});

describe('applyProbeToCapabilities', () => {
  it('updates verdict and timestamp, keeps version/room fields', () => {
    const doc = buildRoomCapabilities({ shielded: true, epoch: 2, relayUrl: 'wss://r' });
    const next = applyProbeToCapabilities(doc, { conclusive: true, storesEphemeral: true }, 2_000);
    expect(next.storageVerdict).toBe('stored');
    expect(next.observedAt).toBe(2_000);
    expect(next.version).toBe(ROOM_CAPABILITIES_VERSION);
    expect(next.probeContract).toBe(PROBE_CONTRACT_VERSION);
    expect(next.shielded).toBe(true);
    expect(next.epoch).toBe(2);
    expect(next.relayUrl).toBe('wss://r');
  });
});
