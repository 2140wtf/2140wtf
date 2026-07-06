import { describe, expect, it } from 'vitest';

import {
  parseAsset3DTag,
  buildAsset3DTag,
  parseAssets3DContent,
  ASSET_3D_SHA256_LENGTH,
} from '@/pets/three-d/lib/three-d-schema';

const VALID_URL = 'https://blossom.example.com/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';
const VALID_HASH = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';

const VALID_TAG: string[] = ['asset_3d', VALID_URL, VALID_HASH, 'model/gltf-binary'];

describe('three-d-schema', () => {
  describe('parseAsset3DTag', () => {
    it('parses a valid asset_3d tag', () => {
      const parsed = parseAsset3DTag([VALID_TAG]);
      expect(parsed).toBeDefined();
      expect(parsed?.url).toBe(VALID_URL);
      expect(parsed?.sha256).toBe(VALID_HASH);
      expect(parsed?.mime).toBe('model/gltf-binary');
    });

    it('returns undefined for a non-asset tag', () => {
      expect(parseAsset3DTag([['url', VALID_URL]])).toBeUndefined();
    });

    it('returns undefined when the URL is invalid', () => {
      expect(parseAsset3DTag([['asset_3d', 'javascript:alert(1)', VALID_HASH]])).toBeUndefined();
    });

    it('returns undefined when the sha256 is invalid', () => {
      expect(parseAsset3DTag([['asset_3d', VALID_URL, 'not-a-hash']])).toBeUndefined();
      expect(parseAsset3DTag([['asset_3d', VALID_URL, VALID_HASH.slice(0, -1)]])).toBeUndefined();
    });

    it('skips an invalid tag and finds a later valid one', () => {
      const parsed = parseAsset3DTag([
        ['asset_3d', VALID_URL, 'badhash'],
        VALID_TAG,
      ]);
      expect(parsed?.sha256).toBe(VALID_HASH);
    });
  });

  describe('buildAsset3DTag', () => {
    it('builds a minimal tag', () => {
      const tag = buildAsset3DTag({ url: VALID_URL, sha256: VALID_HASH });
      expect(tag).toEqual(['asset_3d', VALID_URL, VALID_HASH]);
    });

    it('includes optional fields in order', () => {
      const tag = buildAsset3DTag({
        url: VALID_URL,
        sha256: VALID_HASH,
        mime: 'model/gltf-binary',
        dim: '1024x1024',
        size: 1234,
        variant: 'walk',
      });
      expect(tag).toEqual([
        'asset_3d',
        VALID_URL,
        VALID_HASH,
        'model/gltf-binary',
        '1024x1024',
        '1234',
        'walk',
      ]);
    });

    it('throws for an invalid URL', () => {
      expect(() => buildAsset3DTag({ url: 'http://insecure.com/x', sha256: VALID_HASH })).toThrow();
    });

    it('throws for an invalid sha256', () => {
      expect(() => buildAsset3DTag({ url: VALID_URL, sha256: 'bad' })).toThrow();
    });
  });

  describe('parseAssets3DContent', () => {
    it('parses profile-level pet and room assets', () => {
      const content = JSON.stringify({
        assets_3d: {
          v: 1,
          pet: { url: VALID_URL, sha256: VALID_HASH, mime: 'model/gltf-binary' },
          room: { url: VALID_URL + '2', sha256: VALID_HASH },
        },
      });

      const parsed = parseAssets3DContent(content);
      expect(parsed?.pet?.url).toBe(VALID_URL);
      expect(parsed?.room?.url).toBe(VALID_URL + '2');
    });

    it('parses per-form overrides', () => {
      const content = JSON.stringify({
        assets_3d: {
          v: 1,
          by_form: {
            catti: { url: VALID_URL, sha256: VALID_HASH },
          },
        },
      });

      const parsed = parseAssets3DContent(content);
      expect(parsed?.by_form?.catti?.sha256).toBe(VALID_HASH);
    });

    it('drops invalid entries without failing', () => {
      const content = JSON.stringify({
        assets_3d: {
          v: 1,
          pet: { url: VALID_URL, sha256: 'bad' },
          by_form: {
            catti: { url: VALID_URL, sha256: VALID_HASH },
          },
        },
      });

      const parsed = parseAssets3DContent(content);
      expect(parsed?.pet).toBeUndefined();
      expect(parsed?.by_form?.catti).toBeDefined();
    });

    it('returns undefined for malformed content', () => {
      expect(parseAssets3DContent('')).toBeUndefined();
      expect(parseAssets3DContent('not json')).toBeUndefined();
      expect(parseAssets3DContent(JSON.stringify({ assets_3d: { v: 2 } }))).toBeUndefined();
    });
  });

  it('sha256 length constant matches spec', () => {
    expect(ASSET_3D_SHA256_LENGTH).toBe(64);
  });
});
