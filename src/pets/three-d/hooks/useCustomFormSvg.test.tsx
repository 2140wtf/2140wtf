import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { useCustomFormSvg, verifyAssetHash } from './useCustomFormSvg';
import type { Pets } from '@/pets/core/types/pets';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

vi.mock('./useCustomForms', () => ({
  useCustomForms: () => ({}),
}));

function makeHash(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

function makePets(): Pets {
  return {
    id: 'pet-1',
    name: 'Test Pet',
    lifeStage: 'adult',
    state: 'active',
    breedCategory: 'custom',
    breedAsset: 'my-form',
    baseColor: '#f7931a',
    stats: { hunger: 100, happiness: 100, health: 100, hygiene: 100, energy: 100 },
    createdAt: 1,
  } as Pets;
}

function makeForm(svgText: string, sha256Override?: string, url = 'https://blossom.example.com/test.svg'): Record<string, CustomPetForm> {
  return {
    'my-form': {
      id: 'my-form',
      label: 'My Form',
      category: 'custom',
      svgBase: {
        url,
        sha256: sha256Override ?? makeHash(svgText),
        mime: 'image/svg+xml',
      },
    },
  };
}

describe('verifyAssetHash', () => {
  it('does not throw when the hash matches', () => {
    const text = 'hello svg';
    const hash = makeHash(text);
    expect(() => verifyAssetHash(new TextEncoder().encode(text), hash)).not.toThrow();
  });

  it('throws when the hash mismatches', () => {
    const text = 'hello svg';
    expect(() =>
      verifyAssetHash(new TextEncoder().encode(text), '0'.repeat(64)),
    ).toThrow(/hash mismatch/);
  });
});

describe('useCustomFormSvg', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the sanitized SVG when the fetched bytes match the declared hash', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10"/></svg>';
    const form = makeForm(svg, undefined, 'https://blossom.example.com/test-match.svg');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(svg).buffer),
    });

    const { result } = renderHook(() => useCustomFormSvg(makePets(), form));

    await waitFor(() => expect(result.current.error).toBe(false));
    await waitFor(() => expect(result.current.svg).toContain('<svg'));
    expect(result.current.svg).toContain('circle');
  });

  it('sets error when the fetched bytes do not match the declared hash', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10"/></svg>';
    const form = makeForm(svg, '0'.repeat(64), 'https://blossom.example.com/test-mismatch.svg');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(svg).buffer),
    });

    const { result } = renderHook(() => useCustomFormSvg(makePets(), form));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.svg).toBeUndefined();
  });

  it('sets error when the HTTP request fails', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const form = makeForm(svg, undefined, 'https://blossom.example.com/test-404.svg');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useCustomFormSvg(makePets(), form));

    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it('returns undefined and no error for non-custom pets', () => {
    const pets = makePets();
    pets.breedCategory = '2140-pets';
    pets.breedAsset = undefined;
    const { result } = renderHook(() => useCustomFormSvg(pets, {}));

    expect(result.current.svg).toBeUndefined();
    expect(result.current.error).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});
