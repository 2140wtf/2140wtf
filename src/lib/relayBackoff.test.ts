import { describe, expect, it, vi } from 'vitest';
import { RelayBackoff, nextDelayMs, RELAY_RETRY_BASE_MS, RELAY_RETRY_MAX_MS } from './relayBackoff';

describe('nextDelayMs', () => {
  it('keeps the first few consecutive failures on the fast path', () => {
    expect(nextDelayMs(1)).toBe(RELAY_RETRY_BASE_MS);
    expect(nextDelayMs(2)).toBe(RELAY_RETRY_BASE_MS);
    expect(nextDelayMs(3)).toBe(RELAY_RETRY_BASE_MS);
  });

  it('doubles after the fast path', () => {
    expect(nextDelayMs(4)).toBe(10_000);
    expect(nextDelayMs(5)).toBe(20_000);
    expect(nextDelayMs(6)).toBe(40_000);
    expect(nextDelayMs(7)).toBe(80_000);
    expect(nextDelayMs(8)).toBe(160_000);
  });

  it('caps at 5 minutes', () => {
    expect(nextDelayMs(9)).toBe(RELAY_RETRY_MAX_MS);
    expect(nextDelayMs(20)).toBe(RELAY_RETRY_MAX_MS);
    expect(nextDelayMs(1_000)).toBe(RELAY_RETRY_MAX_MS);
  });
});

describe('RelayBackoff', () => {
  it('advances one tier per consecutive failure', () => {
    const backoff = new RelayBackoff({ relayUrl: 'wss://relay.example/' });
    expect(backoff.next()).toBe(5_000);
    expect(backoff.next()).toBe(5_000);
    expect(backoff.next()).toBe(5_000);
    expect(backoff.next()).toBe(10_000);
    expect(backoff.next()).toBe(20_000);
    expect(backoff.retries).toBe(5);
  });

  it('resets to the fast path after a successful open', () => {
    const backoff = new RelayBackoff({ relayUrl: 'wss://relay.example/' });
    backoff.next();
    backoff.next();
    backoff.next();
    backoff.next();
    backoff.next();
    backoff.reset(); // websocket-ts calls this on every successful (re)open
    expect(backoff.retries).toBe(0);
    expect(backoff.current).toBe(RELAY_RETRY_BASE_MS);
    // A single new failure after recovery retries fast again — one-off blips
    // must not inherit the old penalty.
    expect(backoff.next()).toBe(RELAY_RETRY_BASE_MS);
  });

  it('logs once per state transition, not per attempt', () => {
    const log = vi.fn();
    const backoff = new RelayBackoff({ relayUrl: 'wss://relay.example/', log });

    // Five attempts cross three tiers (5s fast → 10s → 20s): three lines.
    for (let i = 0; i < 5; i++) backoff.next();
    expect(log).toHaveBeenCalledTimes(3);

    // Four more failures climb to the cap (40s → 80s → 160s → 300s): four lines.
    for (let i = 0; i < 4; i++) backoff.next();
    expect(log).toHaveBeenCalledTimes(7);

    // Repeating the capped tier logs nothing more.
    for (let i = 0; i < 5; i++) backoff.next();
    expect(log).toHaveBeenCalledTimes(7);

    // Recovery logs exactly one reset line, and the counter starts clean.
    backoff.reset();
    expect(log).toHaveBeenCalledTimes(8);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('backoff reset'));

    // A reset with no failures logged is silent (initial state).
    log.mockClear();
    backoff.reset();
    expect(log).not.toHaveBeenCalled();
  });
});
