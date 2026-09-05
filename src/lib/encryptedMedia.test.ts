import { describe, expect, it, vi } from 'vitest';

import { decryptAttachmentToObjectURL } from '@/lib/encryptedMedia';

const encryption = {
  algorithm: 'aes-256-gcm',
  key: '00'.repeat(32),
  nonce: '11'.repeat(16),
} as const;

describe('decryptAttachmentToObjectURL URL policy', () => {
  it('rejects local-network URLs before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));

    await expect(decryptAttachmentToObjectURL('https://192.168.1.10/file', encryption, 'video/mp4'))
      .rejects.toThrow('public HTTPS URL');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('rejects non-HTTPS URLs before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));

    await expect(decryptAttachmentToObjectURL('http://cdn.example/file', encryption, 'video/mp4'))
      .rejects.toThrow('public HTTPS URL');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
