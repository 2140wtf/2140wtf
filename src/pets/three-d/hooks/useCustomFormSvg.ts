/**
 * Hook to fetch a custom species SVG for an adult pet.
 *
 * Custom species SVGs are hosted on Blossom and referenced from the owner's
 * kind 11125 profile content. This hook fetches the SVG text on demand and
 * returns it sanitized for the Pets rendering pipeline.
 */

import { useEffect, useMemo, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { Pets } from '@/pets/core/types/pets';
import { sanitizePetsSvg } from '@/lib/sanitizePetsSvg';
import type { Asset3DEntry } from '@/pets/three-d/lib/three-d-schema';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';
import { useCustomForms } from './useCustomForms';

interface UseCustomFormSvgResult {
  /** The sanitized SVG string, or undefined if not loaded / not applicable. */
  svg: string | undefined;
  /** True while the SVG is being fetched. */
  isLoading: boolean;
  /** True if the fetch or hash verification failed. */
  error: boolean;
}

const SVG_CACHE = new Map<string, string>();

/**
 * Verify downloaded bytes against the expected SHA-256 declared in the asset entry.
 * Throws a descriptive error if the hash does not match.
 */
function verifyAssetHash(bytes: Uint8Array, expectedHash: string): void {
  const actualHash = bytesToHex(sha256(bytes)).toLowerCase();
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error(
      `SVG hash mismatch: expected ${expectedHash} but got ${actualHash}. The asset has been rejected.`,
    );
  }
}

/**
 * Fetch the custom species SVG for a pet if it belongs to the custom category.
 *
 * @param pets - The pet being rendered.
 * @param customForms - Optional pre-fetched custom forms map. If omitted, the
 *   current user's profile custom forms are used.
 * @returns Sanitized SVG string and loading/error state.
 */
export function useCustomFormSvg(
  pets: Pets,
  customForms?: Record<string, CustomPetForm>,
): UseCustomFormSvgResult {
  const profileCustomForms = useCustomForms();
  const forms = customForms ?? profileCustomForms;

  const form = useMemo(() => {
    if (pets.breedCategory !== 'custom' || !pets.breedAsset) return undefined;
    return forms[pets.breedAsset];
  }, [forms, pets.breedCategory, pets.breedAsset]);

  const isSleeping = pets.state === 'sleeping' || pets.isSleeping === true;
  const entry = useMemo<Asset3DEntry | undefined>(() => {
    if (!form) return undefined;
    return isSleeping ? (form.svgSleeping ?? form.svgBase) : form.svgBase;
  }, [form, isSleeping]);

  const url = entry?.url;
  const cached = url ? SVG_CACHE.get(url) : undefined;
  const [svg, setSvg] = useState<string | undefined>(cached);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!entry || !url) {
      setSvg(undefined);
      setIsLoading(false);
      setError(false);
      return;
    }

    const cachedSvg = SVG_CACHE.get(url);
    if (cachedSvg) {
      setSvg(cachedSvg);
      setIsLoading(false);
      setError(false);
      return;
    }

    setIsLoading(true);
    setError(false);

    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        verifyAssetHash(bytes, entry.sha256);
        const text = new TextDecoder().decode(bytes);
        const sanitized = sanitizePetsSvg(text);
        SVG_CACHE.set(url, sanitized);
        return sanitized;
      })
      .then((sanitized) => {
        setSvg(sanitized);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [entry, url]);

  return { svg, isLoading, error };
}

/**
 * Re-export the verifier so callers that fetch custom-form assets outside React
 * (e.g. persistence or preview paths) can reuse the same SHA-256 check.
 */
export { verifyAssetHash };
