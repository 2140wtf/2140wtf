import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebRelayConn } from '@/baofund/community-websocket/websocket.js';
import type { NostrEvent } from '@/baofund/community/crypto.js';

class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  sent: unknown[][] = [];
  constructor() { Socket.current = this; queueMicrotask(() => this.onopen?.()); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
let conn: WebRelayConn;
const event = { id: 'test-event' } as NostrEvent;
beforeEach(() => { vi.stubGlobal('WebSocket', Socket); conn = new WebRelayConn('wss://example.invalid'); });
afterEach(() => { conn.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function publish() {
  const result = conn.publish(event);
  // Wait for connect and publish to send the EVENT, without private access.
  await Promise.resolve(); await Promise.resolve();
  expect(Socket.current.sent[0]).toEqual(['EVENT', event]);
  return { result };
}
it('resolves only a positive relay acknowledgement', async () => {
  const { result } = await publish();
  Socket.current.receive(['OK', event.id, true, '']);
  await expect(result).resolves.toBeUndefined();
});
it.each([false, 'true', 1, null])('rejects non-boolean-positive OK: %s', async (accepted) => {
  const { result } = await publish();
  const check = expect(result).rejects.toThrow('blocked: test policy');
  Socket.current.receive(['OK', event.id, accepted, 'blocked: test policy']);
  await check;
});
it('ignores malformed frames and acknowledgements for another event', async () => {
  const { result } = await publish();
  Socket.current.receive(null);
  Socket.current.receive(['OK', 'another-event', false, 'wrong event']);
  Socket.current.receive(['OK', event.id, true, '']);
  await expect(result).resolves.toBeUndefined();
});
it('rejects a pending publish when closed', async () => {
  const { result } = await publish();
  const check = expect(result).rejects.toThrow();
  conn.close();
  await check;
  await expect(conn.publish(event)).rejects.toThrow('closed');
});
it('times out when the relay never acknowledges', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const { result } = await publish();
  const check = expect(result).rejects.toThrow('publish OK timeout');
  await vi.advanceTimersByTimeAsync(10_000);
  await check;
});
