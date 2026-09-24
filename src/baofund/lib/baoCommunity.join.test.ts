import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createJoinLink } from '@/baofund/community/client.js';

const mocks = vi.hoisted(() => ({ join: vi.fn(), sockets: [] as { close: ReturnType<typeof vi.fn> }[] }));
vi.mock('@/baofund/community/client.js', async original => ({
  ...await original<typeof import('@/baofund/community/client.js')>(), joinFromLink: mocks.join,
}));
vi.mock('@/baofund/community/websocket.js', () => ({
  WebRelayConn: class { close = vi.fn(); constructor() { mocks.sockets.push(this); } },
}));
import { joinFundRoom } from './baoCommunity';
const invite = () => createJoinLink('example.invalid', 'ab'.repeat(32), 'room', {
  relay: 'wss://relay.example', routingId: 'ef'.repeat(32), welcomerPub: 'cd'.repeat(32),
});
beforeEach(() => { mocks.join.mockReset(); mocks.sockets.length = 0; });
describe('browser admission boundary', () => {
  it('rejects malformed invites before transport or admission', async () => {
    await expect(joinFundRoom('bad secret invite')).rejects.toThrow('Invalid, incomplete or expired room invite');
    expect(mocks.join).not.toHaveBeenCalled(); expect(mocks.sockets).toHaveLength(0);
  });
  it('closes every transport on failed admission and redacts the underlying error', async () => {
    const link = invite();
    mocks.join.mockImplementation(async (_link, opts) => {
      opts.connFactory('wss://relay.example'); opts.connFactory('wss://relay.example');
      throw new Error(`remote failure: ${link}`);
    });
    await expect(joinFundRoom(link)).rejects.toThrow(/^Room admission failed$/);
    expect(mocks.sockets).toHaveLength(2);
    for (const socket of mocks.sockets) expect(socket.close).toHaveBeenCalledTimes(1);
  });
  it('passes the complete original link without rewriting it', async () => {
    const link = invite(); const result = { joined: {}, session: {}, conn: {} };
    mocks.join.mockResolvedValue(result);
    expect(await joinFundRoom(link)).toBe(result);
    expect(mocks.join.mock.calls[0][0]).toBe(link);
  });
});
