import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: mocks.writeFile },
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

import { downloadDataUrlFile } from './downloadFile';

describe('downloadDataUrlFile', () => {
  beforeEach(() => {
    mocks.native = false;
    mocks.writeFile.mockReset();
  });

  it('writes only the base64 payload to the native Documents directory', async () => {
    mocks.native = true;

    await downloadDataUrlFile('pet-photo.png', 'data:image/png;base64,AQID');

    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'pet-photo.png',
      data: 'AQID',
      directory: 'DOCUMENTS',
    });
  });

  it('uses an attached download anchor on web', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadDataUrlFile('pet-photo.png', 'data:image/png;base64,AQID');

    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="pet-photo.png"]')).toBeNull();
    click.mockRestore();
  });

  it('rejects unsafe filenames and malformed data URLs', async () => {
    await expect(downloadDataUrlFile('../pet.png', 'data:image/png;base64,AQID'))
      .rejects.toThrow('Invalid download filename');
    await expect(downloadDataUrlFile('pet.png', 'data:image/png,not-base64'))
      .rejects.toThrow('Invalid base64 data URL');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
