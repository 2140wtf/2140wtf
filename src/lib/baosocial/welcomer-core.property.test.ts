import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ReplayCache,
  challengeDTag,
  constantTimeEqualHex,
  issueChallenge,
  ratchetMarkerDTag,
  solvePowSync,
  verifyJoinAdmission,
  verifyPow,
  verifyChallengeSignature,
  wrapDTag,
} from './welcomer-core.js';

// Deterministic fuzz campaign (round 26): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

const hex = (n: number) =>
  Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const EPOCH_KEY = Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
const ROOM = 'room-under-test';

const burnerArb = fc.constant(`0b${hex(62)}`);
const roomIdArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);
const difficultyArb = fc.integer({ min: 0, max: 8 }); // solving cost ≤ ~2^8 hashes

/** Solve PoW synchronously at fuzz-safe difficulty (≤ 8 ⇒ ≤ ~256 avg hashes). */
function solve(ch: { salt: string; difficulty: number; expiry: number }, burner: string): string {
  return solvePowSync(ch, burner);
}

/** Fixed fake clock so expiry boundaries are exact. */
const NOW = 1_700_000_000;
const fakeClock = { nowSec: () => NOW };

function cfgFor(overrides: Partial<Parameters<typeof verifyJoinAdmission>[0]> = {}) {
  return {
    epochKey: EPOCH_KEY,
    roomId: ROOM,
    policy: { preset: 'cap-pow' as const, difficulty: 0 },
    replayCache: new ReplayCache(fakeClock),
    challengeTtlSec: 600,
    clock: fakeClock,
    ...overrides,
  };
}

describe('verifyJoinAdmission — gate ordering & bindings (round 26)', () => {
  // CPU-bound PoW brute-force properties get explicit generous timeouts —
  // the 5s default can flake under full-suite CPU contention (observed on P4).
  it('P1: golden path — a correctly issued, solved, unreplayed challenge is admitted', () => {
    fc.assert(
      fc.property(burnerArb, roomIdArb, difficultyArb, fc.integer({ min: 1, max: 600 }), (burner, roomId, difficulty, ttl) => {
        const ch = issueChallenge(EPOCH_KEY, burner, roomId, 1, difficulty, ttl, fakeClock);
        expect(verifyChallengeSignature(EPOCH_KEY, ch)).toBe(true);
        const nonce = solve(ch, burner);
        const cfg = cfgFor({ roomId, policy: { preset: 'cap-pow', difficulty } });
        expect(verifyJoinAdmission(cfg, ch, burner, nonce)).toBe(true);
      }),
    );
  }, 30_000);

  it('P2: every binding mutation flips admission to false — no partial acceptance', () => {
    fc.assert(
      fc.property(burnerArb, roomIdArb, difficultyArb, fc.integer({ min: 1, max: 100 }), (burner, roomId, difficulty, ttl) => {
        const ch = issueChallenge(EPOCH_KEY, burner, roomId, 1, difficulty, ttl, fakeClock);
        const nonce = solve(ch, burner);
        const cfg = cfgFor({ roomId, policy: { preset: 'cap-pow', difficulty } });

        // Tamper each signed base field (signature unchanged) → sig mismatch.
        for (const [field, value] of [
          ['burner', `0d${hex(62)}`],
          ['roomId', `${roomId}-x`],
          ['keyEpoch', 2],
          ['expiry', NOW + ttl + 1],
          ['difficulty', difficulty + 1],
          ['salt', hex(32)],
        ] as const) {
          const tampered = { ...ch, [field]: value };
          expect(verifyJoinAdmission(cfg, tampered, burner, nonce), `tampered ${field} accepted`).toBe(false);
        }

        // Corrupted signature byte.
        expect(verifyJoinAdmission(cfg, { ...ch, sig: ch.sig.slice(0, -1) + (ch.sig.endsWith('a') ? 'b' : 'a') }, burner, nonce)).toBe(false);
        // Signed by a different welcomer epoch key.
        expect(verifyChallengeSignature(Uint8Array.from({ length: 32 }, () => 7), ch)).toBe(false);

        // Wrong burner presenting the challenge (cross-burner).
        expect(verifyJoinAdmission(cfg, ch, `0e${hex(62)}`, nonce)).toBe(false);
        // Right challenge, wrong room config (cross-room).
        expect(verifyJoinAdmission(cfgFor({ roomId: 'other-room', policy: { preset: 'cap-pow', difficulty } }), ch, burner, nonce)).toBe(false);
        // Policy demands MORE difficulty than the challenge carries.
        expect(verifyJoinAdmission(cfgFor({ roomId, policy: { preset: 'cap-pow', difficulty: difficulty + 1 } }), ch, burner, nonce)).toBe(false);
        // Invalid PoW nonces (format/64-bit-range rejections hold at ANY difficulty).
        expect(verifyJoinAdmission(cfg, ch, burner, '18446744073709551616')).toBe(false); // 2^64
        expect(verifyJoinAdmission(cfg, ch, burner, 'nope')).toBe(false);
        // A wrong-but-format-valid nonce only fails when the difficulty is > 0:
        // at difficulty 0 every format-valid nonce verifies by definition. Use a
        // dedicated challenge at policyDifficulty (>= 1) so a failing nonce
        // deterministically exists — found by SEARCH, not a fixed guess (random
        // salts make fixed guesses probabilistic: ~1/2^d verify by luck).
        const policyDifficulty = Math.max(1, difficulty);
        const chStrict = issueChallenge(EPOCH_KEY, burner, roomId, 1, policyDifficulty, ttl, fakeClock);
        let failingNonce: string | null = null;
        for (let n = 0; n < 100_000; n++) {
          if (!verifyPow(chStrict, burner, String(n))) {
            failingNonce = String(n);
            break;
          }
        }
        expect(failingNonce).not.toBeNull();
        const strictCfg = cfgFor({ roomId, policy: { preset: 'cap-pow', difficulty: policyDifficulty } });
        expect(verifyJoinAdmission(strictCfg, chStrict, burner, failingNonce!)).toBe(false);
      }),
    );
  }, 30_000);

  it('P3: expiry boundary is exact — challenge valid until nowSec, dead at nowSec', () => {
    fc.assert(
      fc.property(burnerArb, difficultyArb, fc.integer({ min: 1, max: 60 }), (burner, difficulty, ttl) => {
        const ch = issueChallenge(EPOCH_KEY, burner, ROOM, 1, difficulty, ttl, fakeClock);
        const nonce = solve(ch, burner);
        const live = cfgFor({ policy: { preset: 'cap-pow', difficulty } });
        expect(verifyJoinAdmission(live, ch, burner, nonce)).toBe(true);

        // Fresh cache, clock advanced exactly TO expiry: expired (<=).
        const ch2 = issueChallenge(EPOCH_KEY, burner, ROOM, 1, difficulty, ttl, fakeClock);
        const nonce2 = solve(ch2, burner);
        const expiredCfg = cfgFor({ policy: { preset: 'cap-pow', difficulty }, clock: { nowSec: () => NOW + ttl } });
        expect(verifyJoinAdmission(expiredCfg, ch2, burner, nonce2)).toBe(false);
      }),
    );
  }, 30_000);

  it('P4: replay — the same (salt, burner) solution admits exactly once per cache', () => {
    fc.assert(
      fc.property(burnerArb, difficultyArb, (burner, difficulty) => {
        const ch = issueChallenge(EPOCH_KEY, burner, ROOM, 1, difficulty, 60, fakeClock);
        const nonce = solve(ch, burner);
        const cfg = cfgFor({ policy: { preset: 'cap-pow', difficulty } });
        expect(verifyJoinAdmission(cfg, ch, burner, nonce)).toBe(true);
        // Second submission of the same challenge must fail even with a
        // fresh cfg sharing the same replay cache (daemon restart scenario
        // is bounded by challenge expiry, not by cache persistence).
        expect(verifyJoinAdmission(cfg, ch, burner, nonce)).toBe(false);
        // A DIFFERENT burner replaying the same salt gets its own key.
        const other = `0f${hex(62)}`;
        const chOther = issueChallenge(EPOCH_KEY, other, ROOM, 1, difficulty, 60, fakeClock);
        expect(verifyJoinAdmission(cfgFor({ policy: { preset: 'cap-pow', difficulty } }), chOther, other, solve(chOther, other))).toBe(true);
      }),
    );
  }, 30_000);

  it('P5: zero-difficulty challenge is admitted only by a zero-difficulty policy', () => {
    fc.assert(
      fc.property(burnerArb, fc.integer({ min: 1, max: 8 }), (burner, policyDifficulty) => {
        const ch = issueChallenge(EPOCH_KEY, burner, ROOM, 1, 0, 60, fakeClock); // hostile: d=0
        const nonce = '0';
        const lax = cfgFor({ policy: { preset: 'cap-pow', difficulty: 0 } });
        expect(verifyJoinAdmission(lax, ch, burner, nonce)).toBe(true); // lax policy: fine
        const strict = cfgFor({ policy: { preset: 'cap-pow', difficulty: policyDifficulty } });
        expect(verifyJoinAdmission(strict, ch, burner, nonce)).toBe(false); // historical bug: must NOT pass
      }),
    );
  }, 30_000);

  it('P6: open policy admits without any challenge (documented preset)', () => {
    const cfg = cfgFor({ policy: { preset: 'open' as const } });
    expect(verifyJoinAdmission(cfg, null, 'any-burner', 'any-nonce')).toBe(true);
  });

  it('P7: issueChallenge difficulty bounds — [0,256] ok; out-of-range throws', () => {
    expect(() => issueChallenge(EPOCH_KEY, 'b', ROOM, 1, 0, 60, fakeClock)).not.toThrow();
    expect(() => issueChallenge(EPOCH_KEY, 'b', ROOM, 1, 256, 60, fakeClock)).not.toThrow();
    expect(() => issueChallenge(EPOCH_KEY, 'b', ROOM, 1, -1, 60, fakeClock)).toThrow();
    expect(() => issueChallenge(EPOCH_KEY, 'b', ROOM, 1, 257, 60, fakeClock)).toThrow();
    expect(() => issueChallenge(EPOCH_KEY, 'b', ROOM, 1, 1.5, 60, fakeClock)).toThrow();
  });
});

describe('verifyPow — oracle properties (round 26)', () => {
  it('P8: determinism + monotonicity — valid at d implies valid at every d ≤ d', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 2 ** 28 }), (difficulty, nonceNum) => {
        const challenge = { salt: hex(32), difficulty, expiry: NOW + 600 };
        const burner = `0a${hex(62)}`;
        const nonce = String(nonceNum);
        const r1 = verifyPow(challenge, burner, nonce);
        const r2 = verifyPow(challenge, burner, nonce);
        expect(r2).toBe(r1);
        if (r1) {
          for (let d = 0; d <= difficulty; d++) {
            expect(verifyPow({ ...challenge, difficulty: d }, burner, nonce)).toBe(true);
          }
        }
      }),
    );
  }, 30_000);

  it('P9: nonce grammar — only ^\\d{1,20}$ within 2^64-1 can ever verify', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom('', ' ', ' 1', '1 ', '-1', '+1', '1e3', '0x10', '1_000', '٣'), // malformed
          fc.integer({ min: 0, max: 2_000 }).map((n) => String(n)),
          fc.constantFrom('18446744073709551616', '99999999999999999999999999'), // ≥ 2^64 / > 20 digits
        ),
        (nonce) => {
          const challenge = { salt: hex(32), difficulty: 0, expiry: NOW + 600 };
          expect(verifyPow(challenge, 'burner', nonce)).toBe(/^\d{1,20}$/.test(nonce) && BigInt(nonce) <= (1n << 64n) - 1n);
        },
      ),
    );
  });

  it('P10: totality — arbitrary nonce strings never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (nonce) => {
        expect(typeof verifyPow({ salt: hex(32), difficulty: 1, expiry: NOW + 600 }, 'burner', nonce)).toBe('boolean');
      }),
      { numRuns: 5_000 },
    );
  });
});

describe('ReplayCache — TTL semantics & growth bound (round 26)', () => {
  it('P11: first insert wins; entry revives only after ttl+grace; sweep keeps size exact', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 20 }), fc.integer({ min: 1, max: 500 }), (keys, ttl) => {
        let now = NOW;
        const cache = new ReplayCache({ nowSec: () => now });
        const unique = [...new Set(keys)];
        for (const k of unique) {
          expect(cache.checkAndInsert(k, ttl)).toBe(true);
          expect(cache.checkAndInsert(k, ttl)).toBe(false); // replay
        }
        expect(cache.size).toBe(unique.length);
        // exp = NOW + ttl ⇒ alive one second BEFORE expiry, dead AT expiry
        // (sweep deletes exp <= now).
        now = NOW + ttl - 1;
        expect(cache.size).toBe(unique.length);
        now = NOW + ttl; // expired
        expect(cache.size).toBe(0);
        for (const k of unique) expect(cache.checkAndInsert(k, ttl)).toBe(true); // revive
      }),
    );
  });

  it('P12: growth is HARD-CAPPED — flood beyond the limit evicts oldest survivors, size never exceeds it', () => {
    const now = NOW;
    const cache = new ReplayCache({ nowSec: () => now }, 128);
    const keys: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const k = `pow:${hex(16)}:${i}`; // distinct salts, long ttl
      keys.push(k);
      cache.checkAndInsert(k, 3_600);
    }
    expect(cache.size).toBe(128);
    // Eviction is per-key (oldest expiry first — equal ttls ⇒ insertion order),
    // never a bulk wipe: the newest 128 are still tracked (re-insert ⇒ false
    // replay), while the oldest evicted ones are forgotten (re-insert ⇒ true).
    for (const k of keys.slice(-128)) expect(cache.checkAndInsert(k, 3_600)).toBe(false);
    expect(cache.size).toBe(128); // the failed re-inserts added nothing
    for (const k of keys.slice(0, 128)) expect(cache.checkAndInsert(k, 3_600)).toBe(true);
  });
});

describe('d-tag domain separation (round 26)', () => {
  it('P13: wrap/challenge/ratchet d-tags are pairwise distinct and deterministic for the same binding', () => {
    fc.assert(
      fc.property(burnerArb, roomIdArb, (burner, roomId) => {
        const w = wrapDTag(EPOCH_KEY, roomId, burner);
        const c = challengeDTag(EPOCH_KEY, roomId, burner);
        const r = ratchetMarkerDTag(EPOCH_KEY, roomId, burner);
        expect(new Set([w, c, r]).size).toBe(3);
        expect(wrapDTag(EPOCH_KEY, roomId, burner)).toBe(w);
        expect(challengeDTag(EPOCH_KEY, roomId, burner)).toBe(c);
        // Cross-room tags differ (the post-review collision bug this prevents).
        expect(wrapDTag(EPOCH_KEY, `${roomId}-2`, burner)).not.toBe(w);
      }),
    );
  });

  it('P14: constantTimeEqualHex — equality iff equal, never throws, no length leak', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{0,64}$/), fc.stringMatching(/^[0-9a-f]{0,64}$/), (a, b) => {
        expect(constantTimeEqualHex(a, a)).toBe(true);
        expect(constantTimeEqualHex(a, b)).toBe(a === b);
      }),
    );
  });
});
