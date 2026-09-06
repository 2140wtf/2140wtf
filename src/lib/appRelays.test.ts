import { describe, expect, it } from 'vitest';

import { APP_RELAYS } from './appRelays';

/**
 * Measured dead on 2026-09-06 (scripts/relay-latency-bench.mjs):
 *  - purplepag.es → HTTP 502 on every connect
 *  - nostr-relay.psfoundation.info → never sends EOSE (8s query abort)
 * A relay that never EOSEs holds every grouped pool query until the abort,
 * which made the whole feed wait ~8s. If a relay here is expected back,
 * re-add it only after it passes the bench script.
 */
const MEASURED_DEAD = ['wss://purplepag.es', 'wss://nostr-relay.psfoundation.info'];

describe('APP_RELAYS', () => {
  it('contains no measured-dead relays (feed-latency regression guard)', () => {
    const urls = APP_RELAYS.relays.map((r) => r.url.toLowerCase().replace(/\/+$/, ''));
    for (const dead of MEASURED_DEAD) {
      expect(urls).not.toContain(dead);
    }
  });

  it('every relay is wss, flag-typed, and unique after normalization', () => {
    const seen = new Set<string>();
    for (const r of APP_RELAYS.relays) {
      expect(r.url).toMatch(/^wss:\/\//);
      expect(typeof r.read).toBe('boolean');
      expect(typeof r.write).toBe('boolean');
      const norm = r.url.toLowerCase().replace(/\/+$/, '');
      expect(seen.has(norm)).toBe(false);
      seen.add(norm);
    }
    expect(APP_RELAYS.relays.length).toBeGreaterThanOrEqual(8);
  });
});
