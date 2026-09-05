import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCommitSecret,
  createCommitment,
  loadCommitSecret,
  saveCommitSecret,
} from './auctionCommit';

const pubkey = 'a'.repeat(64);
const auctionAddress = '30001:' + 'b'.repeat(64) + ':auction';

describe('auction commitment secret storage', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => null);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  });

  it('keeps reveal secrets in memory without writing browser storage', () => {
    const { secret } = createCommitment({ auctionAddress, pubkey, valueSats: 21_000 });

    saveCommitSecret({ pubkey, auctionAddress, scope: 'max', secret });

    expect(loadCommitSecret({ pubkey, auctionAddress, scope: 'max' })).toEqual(secret);
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
  });

  it('removes a tab-memory secret after settlement cleanup', () => {
    const secret = { valueSats: 1_000, nonce: 'c'.repeat(32) };
    saveCommitSecret({ pubkey, auctionAddress, scope: 'reserve', secret });

    clearCommitSecret({ pubkey, auctionAddress, scope: 'reserve' });

    expect(loadCommitSecret({ pubkey, auctionAddress, scope: 'reserve' })).toBeNull();
  });
});
