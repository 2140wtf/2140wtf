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

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}));

import { downloadDataUrlFile, openUrl, sanitizeOpenUrl } from './downloadFile';

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

describe('sanitizeOpenUrl', () => {
  it('allows safe external HTTPS URLs and app-relative paths', () => {
    expect(sanitizeOpenUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(sanitizeOpenUrl('/i/bitcoin:tx:abc')).toBe('/i/bitcoin:tx:abc');
  });

  it('allows supported payment and signer deep links', () => {
    expect(sanitizeOpenUrl('lightning:lnbc1abc')).toBe('lightning:lnbc1abc');
    const address = 'bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5';
    expect(sanitizeOpenUrl(`bitcoin:${address}?amount=1`)).toBe(`bitcoin:${address}?amount=1`);
    expect(sanitizeOpenUrl(`nostrconnect://${'a'.repeat(64)}?secret=abc`)).toContain('nostrconnect://');
    expect(sanitizeOpenUrl('simplex:/contact#/?v=1')).toBe('simplex:/contact#/?v=1');
  });

  it('rejects executable, private-network, and unknown schemes', () => {
    expect(sanitizeOpenUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeOpenUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(sanitizeOpenUrl('https://127.0.0.1/admin')).toBeUndefined();
    expect(sanitizeOpenUrl('ftp://example.com/file')).toBeUndefined();
    expect(sanitizeOpenUrl('//example.com')).toBeUndefined();
  });
});

describe('openUrl', () => {
  it('does not call window.open for an unsafe URL', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await expect(openUrl('javascript:alert(1)')).rejects.toThrow('unsafe URL');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
