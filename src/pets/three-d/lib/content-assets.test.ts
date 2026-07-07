import { describe, expect, it } from 'vitest';

import {
  readAssets3DContent,
  updateAssets3DContent,
} from '@/pets/three-d/lib/content-assets';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';

const PET_ASSET: Asset3DEntry = {
  url: 'https://blossom.example/pet.glb',
  sha256: 'a'.repeat(64),
  mime: 'model/gltf-binary',
  size: 1234,
};

const ROOM_ASSET: Asset3DEntry = {
  url: 'https://blossom.example/room.glb',
  sha256: 'b'.repeat(64),
  mime: 'model/gltf-binary',
};

describe('updateAssets3DContent', () => {
  it('adds assets_3d to empty content', () => {
    const result = updateAssets3DContent('', { pet: PET_ASSET });
    const parsed = JSON.parse(result);
    expect(parsed.assets_3d).toEqual({ v: 1, pet: PET_ASSET });
  });

  it('preserves unrelated content fields', () => {
    const prev = JSON.stringify({ foo: 'bar', count: 42 });
    const result = updateAssets3DContent(prev, { pet: PET_ASSET });
    const parsed = JSON.parse(result);
    expect(parsed.foo).toBe('bar');
    expect(parsed.count).toBe(42);
    expect(parsed.assets_3d.pet).toEqual(PET_ASSET);
  });

  it('updates existing pet without clobbering room', () => {
    const prev = JSON.stringify({
      assets_3d: { v: 1, room: ROOM_ASSET },
    });
    const result = updateAssets3DContent(prev, { pet: PET_ASSET });
    const parsed = JSON.parse(result);
    expect(parsed.assets_3d.pet).toEqual(PET_ASSET);
    expect(parsed.assets_3d.room).toEqual(ROOM_ASSET);
  });

  it('removes pet asset when null is passed', () => {
    const prev = JSON.stringify({
      assets_3d: { v: 1, pet: PET_ASSET, room: ROOM_ASSET },
    });
    const result = updateAssets3DContent(prev, { pet: null });
    const parsed = JSON.parse(result);
    expect(parsed.assets_3d.pet).toBeUndefined();
    expect(parsed.assets_3d.room).toEqual(ROOM_ASSET);
  });

  it('removes assets_3d entirely when both slots are cleared', () => {
    const prev = JSON.stringify({
      assets_3d: { v: 1, pet: PET_ASSET },
    });
    const result = updateAssets3DContent(prev, { pet: null });
    const parsed = JSON.parse(result);
    expect(parsed.assets_3d).toBeUndefined();
  });

  it('survives malformed previous content', () => {
    const result = updateAssets3DContent('not json', { room: ROOM_ASSET });
    const parsed = JSON.parse(result);
    expect(parsed.assets_3d).toEqual({ v: 1, room: ROOM_ASSET });
  });
});

describe('readAssets3DContent', () => {
  it('returns undefined for empty content', () => {
    expect(readAssets3DContent('')).toBeUndefined();
  });

  it('returns undefined for malformed content', () => {
    expect(readAssets3DContent('not json')).toBeUndefined();
  });

  it('returns parsed assets_3d when valid', () => {
    const content = JSON.stringify({ assets_3d: { v: 1, pet: PET_ASSET } });
    expect(readAssets3DContent(content)).toEqual({ v: 1, pet: PET_ASSET });
  });

  it('returns undefined for missing assets_3d', () => {
    const content = JSON.stringify({ foo: 'bar' });
    expect(readAssets3DContent(content)).toBeUndefined();
  });

  it('returns undefined for wrong version', () => {
    const content = JSON.stringify({ assets_3d: { v: 2 } });
    expect(readAssets3DContent(content)).toBeUndefined();
  });
});
