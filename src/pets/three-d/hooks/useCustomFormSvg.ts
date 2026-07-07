/**
 * Hook to fetch a custom species SVG for an adult pet.
 *
 * Custom species SVGs are hosted on Blossom and referenced from the owner's
 * kind 11125 profile content. This hook fetches the SVG text on demand and
 * returns it sanitized for the Pets rendering pipeline.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Pets } from '@/pets/core/types/pets';
import { sanitizePetsSvg } from '@/lib/sanitizePetsSvg';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';
import { useCustomForms } from './useCustomForms';

interface UseCustomFormSvgResult {
  /** The sanitized SVG string, or undefined if not loaded / not applicable. */
  svg: string | undefined;
  /** True while the SVG is being fetched. */
  isLoading: boolean;
  /** True if the fetch failed. */
  error: boolean;
}

const SVG_CACHE = new Map<string, string>();

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
  const url = useMemo(() => {
    if (!form) return undefined;
    const entry = isSleeping ? (form.svgSleeping ?? form.svgBase) : form.svgBase;
    return entry.url;
  }, [form, isSleeping]);

  const cached = url ? SVG_CACHE.get(url) : undefined;
  const [svg, setSvg] = useState<string | undefined>(cached);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!url) {
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
        const text = await res.text();
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
  }, [url]);

  return { svg, isLoading, error };
}
