import { useCallback, useEffect, useState } from "react";

import type { GifResult } from "@/hooks/useGifSearch";

const STORAGE_KEY = "armada:favorite-gifs";

/**
 * localStorage-backed favorites store for GIFs. Persists across sessions and
 * syncs across tabs via the storage event. Favorites are stored as a map of
 * gif id → GifResult so the favorites tab can render without re-fetching.
 */
export function useFavoriteGifs() {
  const [favorites, setFavorites] = useState<Map<string, GifResult>>(() => loadFavorites());

  // Re-sync from localStorage when another tab changes it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setFavorites(loadFavorites());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.has(id),
    [favorites],
  );

  const toggleFavorite = useCallback((gif: GifResult) => {
    setFavorites((prev) => {
      const next = new Map(prev);
      if (next.has(gif.id)) {
        next.delete(gif.id);
      } else {
        next.set(gif.id, gif);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const favoriteList = useCallback(
    () => Array.from(favorites.values()).reverse(), // most-recently-favorited first
    [favorites],
  );

  return { isFavorite, toggleFavorite, favoriteList, count: favorites.size };
}

function loadFavorites(): Map<string, GifResult> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as GifResult[];
    return new Map(arr.map((g) => [g.id, g]));
  } catch {
    return new Map();
  }
}

function saveFavorites(map: Map<string, GifResult>) {
  try {
    const arr = Array.from(map.values());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage may be full or unavailable; silently ignore.
  }
}
