/**
 * Shared helpers for the BTC Map merchant view — shop types, distances,
 * and safe URL / image helpers.
 */

export const SHOP_CHAT_RADIUS_METERS = 50;

export const getTypeIcon = (type: string) => {
  const map: Record<string, string> = {
    cafe: '☕', restaurant: '🍽️', pub: '🍺', fast_food: '🍔',
    hotel: '🏨', guest_house: '🏡', apartment: '🏢',
    electronics: '💻', car: '🚗', bicycle: '🚲',
    beauty: '💅', business: '🏢', engineer: '🔧', it: '💻',
    gift: '🎁', optician: '👓', graphic_design: '🎨',
    alcohol: '🍷', variety_store: '🛒', community_centre: '🏛️',
  };
  return map[type] || '🏪';
};

export const COMMON_TYPES = [
  'restaurant', 'cafe', 'fast_food', 'pub', 'bar', 'hotel', 'guest_house',
  'supermarket', 'convenience', 'bakery', 'hairdresser', 'beauty',
  'clothes', 'car_repair', 'electronics', 'it', 'company', 'farm',
  'bureau_de_change', 'tattoo', 'jewelry', 'lawyer', 'massage',
  'dentist', 'department_store', 'apartment', 'fuel', 'atm', 'business',
];

export const getTypeLabel = (type: string) => {
  const map: Record<string, string> = {
    cafe: 'Cafe', restaurant: 'Restaurant', pub: 'Pub', fast_food: 'Fast Food',
    hotel: 'Hotel', guest_house: 'Guest House', apartment: 'Apartment',
    electronics: 'Electronics', car: 'Car Dealership', bicycle: 'Bike Shop',
    beauty: 'Beauty', business: 'Business', engineer: 'Engineering', it: 'IT Services',
    gift: 'Gift Shop', optician: 'Optician', graphic_design: 'Design',
    alcohol: 'Liquor', variety_store: 'Variety Store', community_centre: 'Community',
    supermarket: 'Supermarket', convenience: 'Convenience', bakery: 'Bakery',
    hairdresser: 'Hairdresser', clothes: 'Clothes', car_repair: 'Car Repair',
    company: 'Company', farm: 'Farm', bureau_de_change: 'Exchange',
    tattoo: 'Tattoo', jewelry: 'Jewelry', lawyer: 'Lawyer', massage: 'Massage',
    dentist: 'Dentist', department_store: 'Department Store', fuel: 'Fuel',
    atm: 'ATM', bar: 'Bar',
  };
  return map[type] || type.replace(/_/g, ' ');
};

const toRad = (n: number) => n * Math.PI / 180;

export const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return Infinity;
  const R = 6371e3; // metres
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1);
  const a = Math.min(1, Math.max(0, Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2));
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const formatDistance = (m: number) => {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
};

export const sanitizeTel = (raw: string | null | undefined): string | undefined => {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d+\-().\s]/g, '').trim();
  if (!cleaned || cleaned.length < 3) return undefined;
  return cleaned;
};

const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_DATA_URL_LENGTH = 2_000_000;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const sanitizeEmail = (raw: string | null | undefined): string | undefined => {
  if (!raw) return undefined;
  const email = raw.trim().slice(0, 254);
  if (!EMAIL_RE.test(email)) return undefined;
  return email;
};

export const isValidCoordinate = (lat: number, lon: number): boolean => {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
};

export const safeImageUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  if (url.length > MAX_DATA_URL_LENGTH && url.startsWith('data:')) return undefined;
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.href : 'https://localhost');
    if (u.protocol === 'data:') {
      return IMAGE_DATA_URL_RE.test(u.href) ? u.href : undefined;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.href;
  } catch {
    return undefined;
  }
};

const URL_RE = /^(https?:\/\/)[^\s"<>]+$/i;

export const safeUrl = (raw: string | null | undefined): string | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!URL_RE.test(trimmed)) return undefined;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.href;
  } catch {
    return undefined;
  }
};
