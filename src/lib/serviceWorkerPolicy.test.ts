import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service-worker and deployment privacy policy', () => {
  const serviceWorker = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  it('does not allow notification assets to trigger third-party fetches', () => {
    expect(serviceWorker).toContain("parsed.origin === self.location.origin");
    expect(serviceWorker).not.toContain("parsed.protocol === 'https:'");
    expect(serviceWorker).toContain("data: {},");
  });

  it('bounds push-controlled notification fields and tags', () => {
    expect(serviceWorker).toContain("value.length > 2048");
    expect(serviceWorker).toContain("slice(0, 100)");
    expect(serviceWorker).toContain("slice(0, 300)");
    expect(serviceWorker).toContain("tag.slice(0, 100)");
  });

  it('disables ambient device capabilities in the document policy', () => {
    expect(indexHtml).toContain('http-equiv="Permissions-Policy"');
    for (const capability of ['camera', 'microphone', 'geolocation', 'display-capture', 'usb', 'serial', 'midi']) {
      expect(indexHtml).toContain(`${capability}=()`);
    }
  });
});
