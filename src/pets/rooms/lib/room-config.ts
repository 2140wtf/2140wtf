/**
 * Pets Room System — IDs, metadata, ordering, navigation.
 *
 * Room order is data, not control flow, so it can be customised per-user later.
 * The kind 11125 profile has a `room` tag for cross-session continuity.
 * Currently read on mount but not yet written back on room change (session-local only).
 */

import { Home, Refrigerator, Cross, Moon, Shirt, type LucideIcon } from 'lucide-react';

// ─── Room IDs ─────────────────────────────────────────────────────────────────

export type PetsRoomId = 'home' | 'kitchen' | 'care' | 'rest' | 'closet';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export interface PetsRoomMeta {
  id: PetsRoomId;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const ROOM_META: Record<PetsRoomId, PetsRoomMeta> = {
  home: {
    id: 'home',
    label: 'Home',
    description: 'Main living room',
    icon: Home,
  },
  kitchen: {
    id: 'kitchen',
    label: 'Kitchen',
    description: 'Feed your NOSTR PETS',
    icon: Refrigerator,
  },
  care: {
    id: 'care',
    label: 'Care Room',
    description: 'Hygiene, care, and medicine',
    icon: Cross,
  },
  rest: {
    id: 'rest',
    label: 'Bedroom',
    description: 'Rest and recharge',
    icon: Moon,
  },
  closet: {
    id: 'closet',
    label: 'Closet',
    description: 'Wardrobe and accessories',
    icon: Shirt,
  },
};

// ─── Default Order ────────────────────────────────────────────────────────────

export const DEFAULT_ROOM_ORDER: PetsRoomId[] = [
  'care',
  'kitchen',
  'home',
  'rest',
  // 'closet', — re-enable when wardrobe is ready
];

export const DEFAULT_INITIAL_ROOM: PetsRoomId = 'home';

/** Validate a string as a room ID (for parsing persisted values) */
export function isValidRoomId(value: string | undefined): value is PetsRoomId {
  return !!value && value in ROOM_META;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export function getNextRoom(
  current: PetsRoomId,
  order: PetsRoomId[] = DEFAULT_ROOM_ORDER,
): PetsRoomId {
  const idx = order.indexOf(current);
  if (idx === -1) return order[0];
  return order[(idx + 1) % order.length];
}

export function getPreviousRoom(
  current: PetsRoomId,
  order: PetsRoomId[] = DEFAULT_ROOM_ORDER,
): PetsRoomId {
  const idx = order.indexOf(current);
  if (idx === -1) return order[order.length - 1];
  return order[(idx - 1 + order.length) % order.length];
}

export function getRoomIndex(
  room: PetsRoomId,
  order: PetsRoomId[] = DEFAULT_ROOM_ORDER,
): number {
  return order.indexOf(room);
}
