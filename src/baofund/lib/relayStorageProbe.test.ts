import { afterEach, describe, expect, it, vi } from 'vitest';
import { advertisedEphemeralKinds, probeRelayStorage, type ProbeOptions } from './relayStorageProbe';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: unknown[][] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  receive(message: unknown[]) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
afterEach(() => vi.useRealTimers());
function run(opts: Partial<ProbeOptions> = {}) {
  FakeWebSocket.instances = [];
  return probeRelayStorage({ relayUrl: 'wss://example.invalid', WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket, skipDocument: true, timeoutMs: 300, ...opts });
}
async function ready() {
  await vi.waitFor(() => expect(FakeWebSocket.instances[1]?.sent[0]?.[0]).toBe('REQ'));
  const [writer, observer] = FakeWebSocket.instances;
  expect(writer.sent).toHaveLength(0);
  observer.receive(['EOSE', 'probe-live']);
  const event = writer.sent[0][1] as { id: string; content: string };
  return { writer, observer, event };
}
async function acceptAndDeliver() {
  const state = await ready();
  state.writer.receive(['OK', state.event.id, true, '']);
  state.observer.receive(['EVENT', 'probe-live', state.event]);
  await vi.waitFor(() => expect(FakeWebSocket.instances[2]?.sent[0]?.[0]).toBe('REQ'));
  return { ...state, reader: FakeWebSocket.instances[2] };
}
describe('storage observations require acceptance, independent live delivery and a fresh reader', () => {
  it('detects a signed stored event from a new connection', async () => {
    const result = run(); const { reader, event } = await acceptAndDeliver();
    reader.receive(['EVENT', 'probe-read', event]);
    expect(await result).toMatchObject({ conclusive: true, storesEphemeral: true, accepted: true, liveDelivered: true });
    expect(FakeWebSocket.instances.every(socket => socket.closed)).toBe(true);
  });
  it('observes no retention only after a successful live path and fresh-reader EOSE', async () => {
    const result = run(); const { reader } = await acceptAndDeliver();
    reader.receive(['EOSE', 'probe-read']);
    expect(await result).toMatchObject({ conclusive: true, storesEphemeral: false, accepted: true, liveDelivered: true });
  });
  it.each(['disallowed kind', 'rate limited', 'auth required', 'internal error'])('does not mistake rejection for privacy: %s', async reason => {
    const result = run(); const { writer, event } = await ready();
    writer.receive(['OK', event.id, false, reason]);
    expect(await result).toMatchObject({ conclusive: false, storesEphemeral: true, accepted: false, liveDelivered: false });
  });
  it('cannot use EOSE on the live connection as a non-storage verdict', async () => {
    const result = run(); const { writer, observer, event } = await ready();
    writer.receive(['OK', event.id, true, '']);
    observer.receive(['EOSE', 'probe-read']);
    expect(await result).toMatchObject({ conclusive: false, storesEphemeral: true, liveDelivered: false });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
  it('ignores forged events with a matching id but invalid signed content', async () => {
    const result = run(); const { writer, observer, event } = await ready();
    writer.receive(['OK', event.id, true, '']);
    observer.receive(['EVENT', 'probe-live', { ...event, content: 'forged' }]);
    expect(await result).toMatchObject({ conclusive: false, liveDelivered: false });
  });
  it('accepts live delivery arriving before the positive acknowledgement', async () => {
    const result = run(); const { writer, observer, event } = await ready();
    observer.receive(['EVENT', 'probe-live', event]);
    expect(FakeWebSocket.instances).toHaveLength(2);
    writer.receive(['OK', event.id, true, '']);
    await vi.waitFor(() => expect(FakeWebSocket.instances[2]?.sent.length).toBe(1));
    FakeWebSocket.instances[2].receive(['EOSE', 'probe-read']);
    expect(await result).toMatchObject({ conclusive: true, storesEphemeral: false });
  });
  it('cleans up all sockets on connection error', async () => {
    const result = run(); const { writer } = await ready(); writer.onerror?.();
    expect(await result).toMatchObject({ conclusive: false, storesEphemeral: true });
    expect(FakeWebSocket.instances.every(socket => socket.closed)).toBe(true);
  });
  it('handles constructor failure without leaking a timeout', async () => {
    class BrokenSocket { constructor() { throw new Error('cannot connect'); } }
    expect(await run({ WebSocketCtor: BrokenSocket as unknown as typeof WebSocket })).toMatchObject({ conclusive: false, storesEphemeral: true });
  });
  it('rejects invalid budgets before opening sockets', async () => {
    await expect(run({ timeoutMs: Infinity })).rejects.toThrow(TypeError);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
describe('NIP-11 assertions are metadata, not storage evidence', () => {
  it('extracts only integer kind identifiers', () => {
    expect(advertisedEphemeralKinds({ storage: { ephemeralKinds: [21045, 21046, 'x', null, -1, 1.5, Infinity] } })).toEqual([21045, 21046]);
  });
  it('returns undefined when no assertion exists', () => {
    expect(advertisedEphemeralKinds({})).toBeUndefined();
    expect(advertisedEphemeralKinds(null)).toBeUndefined();
  });
});

it('does not turn a corrupted matching readback into a privacy verdict', async () => {
  const result = run(); const { reader, event } = await acceptAndDeliver();
  reader.receive(['EVENT', 'probe-read', { ...event, content: 'corrupted' }]);
  reader.receive(['EOSE', 'probe-read']);
  expect(await result).toMatchObject({ conclusive: false, storesEphemeral: true });
});
