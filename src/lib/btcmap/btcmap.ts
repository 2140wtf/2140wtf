/**
 * BTC Map data layer — fetches live Bitcoin business data from OpenStreetMap
 * via the Overpass API, caches results in memory, and transforms to the
 * app's internal shop format.
 */

import { fetchBitcoinBusinesses, type BBox, type OverpassElement } from './overpass';
import { safeUrl, sanitizeTel } from './discover';

export type { BBox } from './overpass';

function sanitizeOsmName(raw: string | undefined): string {
  const name = (raw || 'Unnamed Business').trim();
  // Strip control characters except normal whitespace
  let cleaned = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (
      code === 0x09 || code === 0x0a || code === 0x0d ||
      (code >= 0x20 && code !== 0x7f)
    ) {
      cleaned += name[i];
    }
  }
  return cleaned.slice(0, 200) || 'Unnamed Business';
}

const sanitizeOsmEmail = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const email = raw.trim().slice(0, 254);
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return null;
  return email;
};

export interface BtcShop {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  country?: string;
  city?: string;
  address: string;
  addressKnown: boolean;
  /** Whether this location can perform human verification stamps */
  canStamp: boolean;
  lightning: boolean;
  onchain: boolean;
  contactless: boolean;
  verified: boolean;
  osmId: string;
  /** Contact phone number */
  phone?: string | null;
  /** Business website URL */
  website?: string | null;
  /** Contact email address */
  email?: string | null;
  /** Opening hours in OSM format (e.g. "Mo-Fr 09:00-16:00") */
  hours?: string | null;
  /** Instagram URL */
  instagram?: string | null;
  /** Facebook URL */
  facebook?: string | null;
  /** Twitter/X URL */
  twitter?: string | null;
}

// ── Country bounding boxes (rough, covers most land area) ──
export const COUNTRY_BBOXES: Record<string, BBox> = {
  'United Kingdom':     { minLat: 49.8,  minLon: -10.5, maxLat: 59.0,  maxLon: 2.0 },
  'United States':      { minLat: 24.0,  minLon: -125.0, maxLat: 49.5, maxLon: -66.0 },
  'Canada':             { minLat: 41.5,  minLon: -141.0, maxLat: 60.0, maxLon: -52.0 },
  'Germany':            { minLat: 47.0,  minLon: 5.5,   maxLat: 55.5,  maxLon: 15.5 },
  'France':             { minLat: 41.0,  minLon: -5.5,  maxLat: 51.5,  maxLon: 10.0 },
  'Japan':              { minLat: 24.0,  minLon: 122.0, maxLat: 46.0,  maxLon: 146.0 },
  'Brazil':             { minLat: -34.0, minLon: -74.0, maxLat: 5.5,   maxLon: -34.0 },
  'Australia':          { minLat: -44.0, minLon: 112.0, maxLat: -10.0, maxLon: 154.0 },
  'New Zealand':        { minLat: -48.0, minLon: 166.0, maxLat: -34.0, maxLon: 179.0 },
  'South Africa':       { minLat: -35.0, minLon: 16.0,  maxLat: -22.0, maxLon: 33.0 },
  'Philippines':        { minLat: 4.5,   minLon: 116.0, maxLat: 21.5,  maxLon: 127.0 },
  'Malaysia':           { minLat: 0.8,   minLon: 99.0,  maxLat: 7.5,   maxLon: 119.5 },
  'Georgia':            { minLat: 41.0,  minLon: 40.0,  maxLat: 43.5,  maxLon: 47.0 },
  'Isle of Man':        { minLat: 54.0,  minLon: -4.8,  maxLat: 54.45, maxLon: -4.3 },
  'Netherlands':        { minLat: 50.7,  minLon: 3.2,   maxLat: 53.7,  maxLon: 7.2 },
  'Switzerland':        { minLat: 45.8,  minLon: 5.9,   maxLat: 47.8,  maxLon: 10.5 },
  'Spain':              { minLat: 35.0,  minLon: -10.0, maxLat: 44.0,  maxLon: 4.5 },
  'Portugal':           { minLat: 36.8,  minLon: -9.8,  maxLat: 42.2,  maxLon: -6.0 },
  'Italy':              { minLat: 36.5,  minLon: 6.5,   maxLat: 47.0,  maxLon: 18.5 },
  'Austria':            { minLat: 46.3,  minLon: 9.4,   maxLat: 49.1,  maxLon: 17.2 },
  'Czech Republic':     { minLat: 48.5,  minLon: 12.0,  maxLat: 51.1,  maxLon: 19.0 },
  'Poland':             { minLat: 49.0,  minLon: 14.0,  maxLat: 55.0,  maxLon: 24.5 },
  'Sweden':             { minLat: 55.0,  minLon: 10.5,  maxLat: 69.0,  maxLon: 24.5 },
  'Norway':             { minLat: 57.8,  minLon: 4.5,   maxLat: 71.0,  maxLon: 31.5 },
  'Denmark':            { minLat: 54.5,  minLon: 8.0,   maxLat: 57.8,  maxLon: 13.0 },
  'Finland':            { minLat: 59.5,  minLon: 19.5,  maxLat: 70.0,  maxLon: 31.5 },
  'Ireland':            { minLat: 51.2,  minLon: -10.7, maxLat: 55.4,  maxLon: -5.9 },
  'Belgium':            { minLat: 49.4,  minLon: 2.5,   maxLat: 51.5,  maxLon: 6.5 },
  'Luxembourg':         { minLat: 49.4,  minLon: 5.7,   maxLat: 50.2,  maxLon: 6.6 },
  'Greece':             { minLat: 34.8,  minLon: 19.3,  maxLat: 41.8,  maxLon: 29.6 },
  'Argentina':          { minLat: -55.0, minLon: -74.0, maxLat: -21.0, maxLon: -53.0 },
  'Mexico':             { minLat: 14.3,  minLon: -118.0, maxLat: 32.8, maxLon: -86.7 },
  'El Salvador':        { minLat: 13.0,  minLon: -90.2, maxLat: 14.5,  maxLon: -87.6 },
  'Guatemala':          { minLat: 13.6,  minLon: -92.3, maxLat: 17.8,  maxLon: -88.2 },
  'Honduras':           { minLat: 12.9,  minLon: -89.4, maxLat: 16.5,  maxLon: -83.1 },
  'Costa Rica':         { minLat: 8.0,   minLon: -86.0, maxLat: 11.2,  maxLon: -82.5 },
  'Panama':             { minLat: 7.0,   minLon: -83.0, maxLat: 9.8,   maxLon: -77.0 },
  'Colombia':           { minLat: -4.3,  minLon: -79.0, maxLat: 12.5,  maxLon: -66.8 },
  'Venezuela':          { minLat: 0.5,   minLon: -73.5, maxLat: 12.5,  maxLon: -59.8 },
  'Chile':              { minLat: -56.0, minLon: -76.0, maxLat: -17.5, maxLon: -66.0 },
  'Peru':               { minLat: -18.5, minLon: -81.5, maxLat: -0.1,  maxLon: -68.5 },
  'Ecuador':            { minLat: -5.0,  minLon: -81.5, maxLat: 1.5,   maxLon: -75.0 },
  'Bolivia':            { minLat: -23.0, minLon: -70.0, maxLat: -9.5,  maxLon: -57.5 },
  'Paraguay':           { minLat: -28.0, minLon: -63.0, maxLat: -19.0, maxLon: -54.0 },
  'Uruguay':            { minLat: -35.0, minLon: -58.5, maxLat: -30.0, maxLon: -53.0 },
  'India':              { minLat: 6.5,   minLon: 68.0,  maxLat: 37.0,  maxLon: 97.5 },
  'Thailand':           { minLat: 5.5,   minLon: 97.0,  maxLat: 20.5,  maxLon: 106.0 },
  'Vietnam':            { minLat: 8.3,   minLon: 102.0, maxLat: 23.5,  maxLon: 110.5 },
  'Indonesia':          { minLat: -11.0, minLon: 95.0,  maxLat: 6.5,   maxLon: 141.0 },
  'Singapore':          { minLat: 1.2,   minLon: 103.6, maxLat: 1.47,  maxLon: 104.1 },
  'Hong Kong':          { minLat: 22.1,  minLon: 113.8, maxLat: 22.6,  maxLon: 114.4 },
  'South Korea':        { minLat: 33.0,  minLon: 124.5, maxLat: 38.8,  maxLon: 131.0 },
  'Taiwan':             { minLat: 21.8,  minLon: 119.8, maxLat: 25.4,  maxLon: 122.1 },
  'China':              { minLat: 18.0,  minLon: 73.5,  maxLat: 53.6,  maxLon: 135.0 },
  'Russia':             { minLat: 41.0,  minLon: 19.5,  maxLat: 82.0,  maxLon: 180.0 },
  'Turkey':             { minLat: 35.8,  minLon: 25.8,  maxLat: 42.5,  maxLon: 44.8 },
  'Israel':             { minLat: 29.4,  minLon: 34.2,  maxLat: 33.4,  maxLon: 35.9 },
  'United Arab Emirates': { minLat: 22.6, minLon: 51.6, maxLat: 26.5, maxLon: 56.5 },
  'Saudi Arabia':       { minLat: 16.0,  minLon: 34.5,  maxLat: 32.2,  maxLon: 55.7 },
  'Egypt':              { minLat: 22.0,  minLon: 25.0,  maxLat: 31.7,  maxLon: 35.0 },
  'Morocco':            { minLat: 27.6,  minLon: -13.5, maxLat: 36.0,  maxLon: -1.0 },
  'Kenya':              { minLat: -4.8,  minLon: 33.8,  maxLat: 5.0,   maxLon: 42.0 },
  'Nigeria':            { minLat: 4.0,   minLon: 2.5,   maxLat: 14.0,  maxLon: 14.7 },
  'Ghana':              { minLat: 4.5,  minLon: -3.5,  maxLat: 11.2,  maxLon: 1.3 },
  'Tanzania':           { minLat: -12.0, minLon: 29.2,  maxLat: -1.0,  maxLon: 40.8 },
  'Uganda':             { minLat: -1.5,  minLon: 29.5,  maxLat: 4.5,   maxLon: 35.2 },
  'Burundi':            { minLat: -4.5,  minLon: 29.0,  maxLat: -2.2,  maxLon: 30.9 },
  'Eritrea':            { minLat: 12.2,  minLon: 36.4,  maxLat: 18.0,  maxLon: 43.3 },
  'Senegal':            { minLat: 12.2,  minLon: -17.6, maxLat: 16.8,  maxLon: -11.3 },
  'Ivory Coast':        { minLat: 4.0,   minLon: -8.7,  maxLat: 10.8,  maxLon: -2.4 },
  'Zimbabwe':           { minLat: -22.5, minLon: 25.0,  maxLat: -15.5, maxLon: 33.2 },
  'Botswana':           { minLat: -27.0, minLon: 19.8,  maxLat: -17.7, maxLon: 29.5 },
  'Namibia':            { minLat: -29.0, minLon: 11.5,  maxLat: -16.9, maxLon: 25.3 },
  'Madagascar':         { minLat: -25.8, minLon: 43.0,  maxLat: -11.9, maxLon: 50.7 },
  'Croatia':            { minLat: 42.1,  minLon: 13.0,  maxLat: 46.6,  maxLon: 19.5 },
  'Serbia':             { minLat: 41.8,  minLon: 18.8,  maxLat: 46.2,  maxLon: 23.0 },
  'Bosnia':             { minLat: 42.5,  minLon: 15.7,  maxLat: 45.3,  maxLon: 19.6 },
  'Slovenia':           { minLat: 45.4,  minLon: 13.3,  maxLat: 46.9,  maxLon: 16.6 },
  'Hungary':            { minLat: 45.7,  minLon: 16.0,  maxLat: 48.6,  maxLon: 22.9 },
  'Slovakia':           { minLat: 47.7,  minLon: 16.8,  maxLat: 49.6,  maxLon: 22.6 },
  'Romania':            { minLat: 43.6,  minLon: 20.2,  maxLat: 48.3,  maxLon: 30.0 },
  'Bulgaria':           { minLat: 41.2,  minLon: 22.3,  maxLat: 44.2,  maxLon: 28.6 },
  'Ukraine':            { minLat: 44.3,  minLon: 22.0,  maxLat: 52.5,  maxLon: 40.3 },
  'Belarus':            { minLat: 51.2,  minLon: 23.1,  maxLat: 56.2,  maxLon: 32.8 },
  'Lithuania':          { minLat: 53.8,  minLon: 20.9,  maxLat: 56.5,  maxLon: 26.9 },
  'Latvia':             { minLat: 55.6,  minLon: 20.9,  maxLat: 58.1,  maxLon: 28.3 },
  'Estonia':            { minLat: 57.5,  minLon: 21.7,  maxLat: 59.7,  maxLon: 28.2 },
  'Iceland':            { minLat: 63.2,  minLon: -25.0, maxLat: 66.6, maxLon: -13.0 },
  'Liechtenstein':      { minLat: 47.0,  minLon: 9.4,   maxLat: 47.3,  maxLon: 9.7 },
  'Monaco':             { minLat: 43.7,  minLon: 7.3,   maxLat: 43.8,  maxLon: 7.5 },
  'Andorra':            { minLat: 42.4,  minLon: 1.4,   maxLat: 42.7,  maxLon: 1.8 },
  'San Marino':         { minLat: 43.9,  minLon: 12.4,  maxLat: 44.0,  maxLon: 12.5 },
  'Malta':              { minLat: 35.8,  minLon: 14.1,  maxLat: 36.1,  maxLon: 14.6 },
  'Cyprus':             { minLat: 34.8,  minLon: 32.0,  maxLat: 35.8,  maxLon: 34.6 },
  'Jordan':             { minLat: 29.1,  minLon: 34.8,  maxLat: 33.4,  maxLon: 39.3 },
  'Lebanon':            { minLat: 33.0,  minLon: 35.0,  maxLat: 34.7,  maxLon: 36.6 },
  'Pakistan':           { minLat: 23.6,  minLon: 60.8,  maxLat: 37.1,  maxLon: 77.0 },
  'Bangladesh':         { minLat: 20.6,  minLon: 88.0,  maxLat: 26.7,  maxLon: 92.7 },
  'Sri Lanka':          { minLat: 5.8,   minLon: 79.5,  maxLat: 9.9,   maxLon: 82.0 },
  'Nepal':              { minLat: 26.2,  minLon: 80.0,  maxLat: 30.6,  maxLon: 88.2 },
  'Myanmar':            { minLat: 9.5,   minLon: 92.0,  maxLat: 28.6,  maxLon: 101.2 },
  'Cambodia':           { minLat: 10.3,  minLon: 102.8, maxLat: 14.7,  maxLon: 107.6 },
  'Laos':               { minLat: 13.8,  minLon: 100.0, maxLat: 22.5,  maxLon: 108.0 },
  'Mongolia':           { minLat: 41.5,  minLon: 87.5,  maxLat: 52.2,  maxLon: 120.0 },
  'Kazakhstan':         { minLat: 40.8,  minLon: 46.5,  maxLat: 55.5,  maxLon: 87.3 },
  'Uzbekistan':         { minLat: 37.1,  minLon: 55.8,  maxLat: 45.6,  maxLon: 73.1 },
  'Kyrgyzstan':         { minLat: 39.1,  minLon: 69.2,  maxLat: 43.3,  maxLon: 80.3 },
  'Tajikistan':         { minLat: 36.6,  minLon: 67.3,  maxLat: 41.1,  maxLon: 75.2 },
  'Turkmenistan':       { minLat: 35.1,  minLon: 52.4,  maxLat: 42.8,  maxLon: 66.7 },
  'Afghanistan':        { minLat: 29.3,  minLon: 60.4,  maxLat: 38.5,  maxLon: 75.0 },
  'Iran':               { minLat: 25.0,  minLon: 44.0,  maxLat: 39.8,  maxLon: 63.4 },
  'Iraq':               { minLat: 29.0,  minLon: 38.7,  maxLat: 37.4,  maxLon: 48.8 },
  'Syria':              { minLat: 32.2,  minLon: 35.5,  maxLat: 37.4,  maxLon: 42.4 },
  'Qatar':              { minLat: 24.4,  minLon: 50.7,  maxLat: 26.2,  maxLon: 52.5 },
  'Kuwait':             { minLat: 28.5,  minLon: 46.5,  maxLat: 30.1,  maxLon: 49.0 },
  'Bahrain':            { minLat: 25.5,  minLon: 50.3,  maxLat: 26.3,  maxLon: 50.8 },
  'Oman':               { minLat: 16.5,  minLon: 52.0,  maxLat: 26.5,  maxLon: 60.0 },
  'Yemen':              { minLat: 12.5,  minLon: 42.5,  maxLat: 19.0,  maxLon: 54.5 },
  'Armenia':            { minLat: 38.8,  minLon: 43.4,  maxLat: 41.3,  maxLon: 46.6 },
  'Azerbaijan':         { minLat: 38.3,  minLon: 44.7,  maxLat: 41.9,  maxLon: 50.6 },
  'Moldova':            { minLat: 45.4,  minLon: 26.6,  maxLat: 48.5,  maxLon: 30.2 },
  'Albania':            { minLat: 39.6,  minLon: 19.2,  maxLat: 42.7,  maxLon: 21.1 },
  'North Macedonia':    { minLat: 40.8,  minLon: 20.3,  maxLat: 42.4,  maxLon: 23.0 },
  'Montenegro':         { minLat: 41.8,  minLon: 18.4,  maxLat: 43.6,  maxLon: 20.4 },
  'Kosovo':             { minLat: 41.8,  minLon: 20.0,  maxLat: 43.3,  maxLon: 21.8 },
  'Algeria':            { minLat: 18.9,  minLon: -8.7,  maxLat: 37.4,  maxLon: 12.0 },
  'Tunisia':            { minLat: 30.2,  minLon: 7.5,   maxLat: 37.6,  maxLon: 11.6 },
  'Libya':              { minLat: 19.5,  minLon: 9.3,   maxLat: 33.2,  maxLon: 25.2 },
  'Sudan':              { minLat: 8.6,   minLon: 21.8,  maxLat: 23.2,  maxLon: 39.0 },
  'South Sudan':        { minLat: 3.4,   minLon: 23.4,  maxLat: 12.3,  maxLon: 35.9 },
  'Chad':               { minLat: 7.4,   minLon: 13.4,  maxLat: 23.5,  maxLon: 24.0 },
  'Niger':              { minLat: 11.6,  minLon: 0.0,   maxLat: 23.5,  maxLon: 16.0 },
  'Mali':               { minLat: 10.1,  minLon: -12.0, maxLat: 25.0,  maxLon: 4.3 },
  'Burkina Faso':       { minLat: 9.3,   minLon: -5.5,  maxLat: 15.1,  maxLon: 2.4 },
  'Mauritania':         { minLat: 14.7,  minLon: -17.1, maxLat: 27.3,  maxLon: -4.7 },
  'Cameroon':           { minLat: 1.6,   minLon: 8.4,   maxLat: 13.1,  maxLon: 16.2 },
  'Central African Republic': { minLat: 2.2, minLon: 14.4, maxLat: 11.0, maxLon: 27.5 },
  'Equatorial Guinea':  { minLat: 0.9,   minLon: 8.7,   maxLat: 3.8,   maxLon: 11.3 },
  'Gabon':              { minLat: -3.9,  minLon: 8.6,   maxLat: 2.3,   maxLon: 14.5 },
  'Congo':              { minLat: -5.1,  minLon: 11.0,  maxLat: 3.8,   maxLon: 18.6 },
  'DR Congo':           { minLat: -13.5, minLon: 12.0,  maxLat: 5.4,   maxLon: 31.3 },
  'Angola':             { minLat: -18.0, minLon: 11.6,  maxLat: -4.4,  maxLon: 24.1 },
  'Mozambique':         { minLat: -26.9, minLon: 30.0,  maxLat: -10.4, maxLon: 40.8 },
  'Malawi':             { minLat: -17.2, minLon: 32.6,  maxLat: -9.2,  maxLon: 35.9 },
  'Zambia':             { minLat: -18.2, minLon: 21.9,  maxLat: -8.0,  maxLon: 33.7 },
  'Lesotho':            { minLat: -30.7, minLon: 27.0,  maxLat: -28.5, maxLon: 29.5 },
  'Eswatini':           { minLat: -27.5, minLon: 30.7,  maxLat: -25.7, maxLon: 32.2 },
  'Comoros':            { minLat: -12.5, minLon: 43.2,  maxLat: -11.2, maxLon: 44.5 },
  'Seychelles':         { minLat: -4.8,  minLon: 55.3,  maxLat: -4.2,  maxLon: 55.9 },
  'Mauritius':          { minLat: -20.6, minLon: 56.4,  maxLat: -19.9, maxLon: 57.8 },
  'Cape Verde':         { minLat: 14.8,  minLon: -25.4, maxLat: 17.2,  maxLon: -22.6 },
  'Guinea':             { minLat: 7.1,   minLon: -15.1, maxLat: 12.7,  maxLon: -7.6 },
  'Guinea-Bissau':      { minLat: 10.8,  minLon: -16.8, maxLat: 12.7,  maxLon: -13.6 },
  'Sierra Leone':       { minLat: 6.8,   minLon: -13.4, maxLat: 10.0,  maxLon: -10.2 },
  'Liberia':            { minLat: 4.3,   minLon: -11.5, maxLat: 8.6,   maxLon: -7.3 },
  'Gambia':             { minLat: 13.0,  minLon: -16.8, maxLat: 13.8,  maxLon: -13.7 },
  'Togo':               { minLat: 5.9,   minLon: -0.2,  maxLat: 11.2,  maxLon: 1.8 },
  'Benin':              { minLat: 6.2,   minLon: 0.7,   maxLat: 12.5,  maxLon: 3.9 },
  'Djibouti':           { minLat: 10.9,  minLon: 41.7,  maxLat: 12.8,  maxLon: 43.5 },
  'Somalia':            { minLat: -1.2,  minLon: 40.9,  maxLat: 12.0,  maxLon: 51.1 },
  'Ethiopia':           { minLat: 3.3,   minLon: 33.0,  maxLat: 18.0,  maxLon: 48.0 },
  'Rwanda':             { minLat: -2.9,  minLon: 28.8,  maxLat: -1.0,  maxLon: 30.9 },
  'New Caledonia':      { minLat: -22.8, minLon: 163.5, maxLat: -19.0, maxLon: 170.0 },
  'Fiji':               { minLat: -20.0, minLon: 176.0, maxLat: -12.0, maxLon: -178.0 },
  'Papua New Guinea':   { minLat: -11.8, minLon: 140.8, maxLat: -0.8,  maxLon: 157.0 },
  'Solomon Islands':    { minLat: -11.9, minLon: 155.0, maxLat: -5.2,  maxLon: 167.5 },
  'Vanuatu':            { minLat: -20.3, minLon: 166.3, maxLat: -13.0, maxLon: 170.3 },
  'Samoa':              { minLat: -14.1, minLon: -172.8, maxLat: -13.4, maxLon: -171.4 },
  'Tonga':              { minLat: -21.5, minLon: -175.4, maxLat: -15.5, maxLon: -173.7 },
  'Kiribati':           { minLat: -11.5, minLon: -174.5, maxLat: 4.7,   maxLon: -150.0 },
  'Tuvalu':             { minLat: -8.6,  minLon: 176.0, maxLat: -5.6,  maxLon: 178.0 },
  'Nauru':              { minLat: -0.6,  minLon: 166.8, maxLat: -0.5,  maxLon: 167.0 },
  'Palau':              { minLat: 2.9,   minLon: 131.0, maxLat: 8.2,   maxLon: 134.7 },
  'Marshall Islands':   { minLat: 4.5,   minLon: 160.0, maxLat: 15.0,  maxLon: 172.0 },
  'Micronesia':         { minLat: 1.0,   minLon: 137.0, maxLat: 10.0,  maxLon: 164.0 },
  'Brunei':             { minLat: 4.0,   minLon: 114.0, maxLat: 5.1,   maxLon: 115.4 },
  'East Timor':         { minLat: -9.5,  minLon: 124.0, maxLat: -8.1,  maxLon: 127.4 },
  'Guyana':             { minLat: 1.1,   minLon: -61.5, maxLat: 8.6,   maxLon: -56.4 },
  'Suriname':           { minLat: 1.8,   minLon: -58.1, maxLat: 6.0,   maxLon: -53.9 },
  'French Guiana':      { minLat: 2.1,   minLon: -54.6, maxLat: 5.8,   maxLon: -51.6 },
  'Trinidad and Tobago':{ minLat: 10.0,  minLon: -62.0, maxLat: 11.4,  maxLon: -60.5 },
  'Barbados':           { minLat: 12.9,  minLon: -59.7, maxLat: 13.4,  maxLon: -59.4 },
  'Jamaica':            { minLat: 17.6,  minLon: -78.4, maxLat: 18.6,  maxLon: -76.1 },
  'Haiti':              { minLat: 18.0,  minLon: -74.5, maxLat: 20.1,  maxLon: -71.6 },
  'Dominican Republic': { minLat: 17.4,  minLon: -72.0, maxLat: 19.9,  maxLon: -68.2 },
  'Cuba':               { minLat: 19.7,  minLon: -85.0, maxLat: 23.2,  maxLon: -74.0 },
  'Puerto Rico':        { minLat: 17.8,  minLon: -67.3, maxLat: 18.6,  maxLon: -65.2 },
  'Belize':             { minLat: 15.8,  minLon: -89.3, maxLat: 18.5,  maxLon: -87.4 },
  'Nicaragua':          { minLat: 10.7,  minLon: -87.7, maxLat: 15.0,  maxLon: -82.5 },
  'Cayman Islands':     { minLat: 19.2,  minLon: -81.4, maxLat: 19.8,  maxLon: -79.7 },
  'Bahamas':            { minLat: 20.9,  minLon: -79.0, maxLat: 27.3,  maxLon: -72.7 },
  'Bermuda':            { minLat: 32.2,  minLon: -64.9, maxLat: 32.4,  maxLon: -64.6 },
  'Greenland':          { minLat: 59.7,  minLon: -73.3, maxLat: 83.7,  maxLon: -11.5 },
};

export function getCountryBbox(countryName: string): BBox | undefined {
  return COUNTRY_BBOXES[countryName];
}

export function getAllCountries(): string[] {
  return Object.keys(COUNTRY_BBOXES).sort();
}

// ── Transform OSM element to app shop format ──
export function transformOsmElement(el: OverpassElement): BtcShop {
  const tags = el.tags;
  const name = sanitizeOsmName(tags['name:en'] || tags['name']);

  // Determine business type from OSM tags
  const type =
    tags['shop'] ||
    tags['amenity'] ||
    tags['tourism'] ||
    tags['office'] ||
    tags['leisure'] ||
    tags['craft'] ||
    'business';

  // Build address string
  const parts: string[] = [];
  if (tags['addr:street']) {
    parts.push(`${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim());
  }
  if (tags['addr:city']) parts.push(tags['addr:city']);
  if (tags['addr:country']) parts.push(tags['addr:country']);
  const address = parts.join(', ') || 'Address unknown';
  const addressKnown = !!tags['addr:street'] || !!tags['addr:place'];

  // Detect unattended / automated locations that cannot perform human verification
  const typeLower = type.toLowerCase();
  const nameLower = name.toLowerCase();
  const isUnattended =
    typeLower === 'atm' ||
    tags['amenity'] === 'atm' ||
    tags['amenity'] === 'vending_machine' ||
    nameLower.includes(' atm') ||
    nameLower.includes('atm ') ||
    nameLower.includes('bitcoin atm') ||
    nameLower.includes('btm') ||
    nameLower.includes('vending');
  const canStamp = addressKnown && !isUnattended;

  // Payment methods
  const lightning = tags['payment:lightning'] === 'yes';
  const onchain = tags['payment:onchain'] === 'yes';
  const contactless = tags['payment:lightning_contactless'] === 'yes';

  // Verification heuristic: has check_date or not marked as out of date
  const verified =
    !!tags['check_date'] ||
    (!!tags['survey:date']) ||
    (!!tags['Bitcoin'] && !tags['disused:shop']);

  return {
    id: `${el.type}:${el.id}`,
    name,
    type,
    lat: el.lat ?? el.center?.lat ?? 0,
    lon: el.lon ?? el.center?.lon ?? 0,
    country: tags['addr:country'] || undefined,
    city: tags['addr:city'] || undefined,
    address,
    addressKnown,
    canStamp,
    lightning,
    onchain,
    contactless,
    verified,
    osmId: `${el.type}:${el.id}`,
    phone: sanitizeTel(tags['phone'] || tags['contact:phone']) || null,
    website: safeUrl(tags['website'] || tags['contact:website']) || null,
    email: sanitizeOsmEmail(tags['email'] || tags['contact:email']) || null,
    hours: tags['opening_hours'] || null,
    instagram: safeUrl(tags['contact:instagram'] || tags['Instagram']) || null,
    facebook: safeUrl(tags['contact:facebook']) || null,
    twitter: safeUrl(tags['contact:twitter']) || null,
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch detailed info for a single BTC Map element by its full ID
 * (e.g. "node:9778525869"). Returns enriched BtcShop with contact,
 * hours, and links when available.
 */
export async function fetchShopDetails(elementId: string): Promise<Partial<BtcShop> | null> {
  if (!/^(node|way|relation):\d+$/.test(elementId)) return null;
  try {
    const res = await fetchWithTimeout(`https://api.btcmap.org/v2/elements/${encodeURIComponent(elementId)}`, 10_000);
    if (!res.ok) return null;
    const data = await res.json();
    const osm = data.osm_json || {};
    const tags = osm.tags || {};

    return {
      phone: sanitizeTel(tags['phone'] || tags['contact:phone']) || null,
      website: safeUrl(tags['website'] || tags['contact:website']) || null,
      email: sanitizeOsmEmail(tags['email'] || tags['contact:email']) || null,
      hours: tags['opening_hours'] || null,
      instagram: safeUrl(tags['contact:instagram'] || tags['Instagram']) || null,
      facebook: safeUrl(tags['contact:facebook']) || null,
      twitter: safeUrl(tags['contact:twitter']) || null,
    };
  } catch {
    return null;
  }
}

// ── In-memory cache for the current session ──
const sessionCache = new Map<string, { shops: BtcShop[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50;

function cacheKey(bbox: BBox): string {
  // Round to 2 decimal places for cache granularity
  return [
    bbox.minLat.toFixed(2),
    bbox.minLon.toFixed(2),
    bbox.maxLat.toFixed(2),
    bbox.maxLon.toFixed(2),
  ].join(',');
}

/**
 * Return true when a bbox is too large to send to Overpass without getting a 400.
 */
export function isBBoxTooLarge(bbox: BBox): boolean {
  return (
    !bbox ||
    typeof bbox.minLat !== 'number' ||
    typeof bbox.minLon !== 'number' ||
    typeof bbox.maxLat !== 'number' ||
    typeof bbox.maxLon !== 'number' ||
    bbox.maxLat < bbox.minLat ||
    bbox.maxLon < bbox.minLon ||
    Math.abs(bbox.maxLat - bbox.minLat) > 5 ||
    Math.abs(bbox.maxLon - bbox.minLon) > 5
  );
}

/**
 * Fetch Bitcoin businesses for a bounding box, with session-level caching.
 */
export async function fetchShopsForBBox(bbox: BBox): Promise<BtcShop[]> {
  if (isBBoxTooLarge(bbox)) return [];
  const key = cacheKey(bbox);
  const cached = sessionCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.shops;
  }

  let elements: OverpassElement[];
  try {
    elements = await fetchBitcoinBusinesses(bbox);
  } catch (err: unknown) {
    console.warn('[BTCMap] fetchBitcoinBusinesses failed:', (err as Error | undefined)?.message || err);
    return [];
  }
  const shops = elements.map(transformOsmElement);

  sessionCache.set(key, { shops, fetchedAt: Date.now() });
  // Evict stale entries to prevent unbounded growth
  for (const [k, v] of sessionCache) {
    if (Date.now() - v.fetchedAt > CACHE_TTL_MS) sessionCache.delete(k);
  }
  // Enforce max cache size (LRU eviction — Map preserves insertion order)
  while (sessionCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = sessionCache.keys().next().value;
    if (firstKey !== undefined) sessionCache.delete(firstKey);
  }
  return shops;
}

/**
 * Fetch Bitcoin businesses for a country by name.
 */
export async function fetchShopsForCountry(countryName: string): Promise<BtcShop[]> {
  const bbox = getCountryBbox(countryName);
  if (!bbox) return [];
  return fetchShopsForBBox(bbox);
}

/**
 * Fetch Bitcoin businesses for a world region (initial view).
 * Uses a bbox that's roughly the whole world but filters to
 * a reasonable sample by querying multiple regions.
 */
export async function fetchShopsForWorld(): Promise<BtcShop[]> {
  // Query a few key regions in parallel to get a global sample
  const regions: BBox[] = [
    { minLat: 35, minLon: -125, maxLat: 55, maxLon: -60 },   // North America
    { minLat: 35, minLon: -10, maxLat: 60, maxLon: 30 },    // Europe
    { minLat: 20, minLon: 110, maxLat: 45, maxLon: 145 },   // East Asia
    { minLat: -35, minLon: -70, maxLat: -10, maxLon: -35 }, // South America
    { minLat: -35, minLon: 15, maxLat: -15, maxLon: 35 },   // Southern Africa
    { minLat: -45, minLon: 165, maxLat: -30, maxLon: 180 }, // Oceania
  ];

  const results = await Promise.allSettled(regions.map((r) => fetchShopsForBBox(r)));
  const shops: BtcShop[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') shops.push(...r.value);
  }
  // Deduplicate by ID
  const seen = new Set<string>();
  return shops.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// ISO 3166-1 alpha-2 country code → human-readable name
export const ISO_COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AG: 'Antigua and Barbuda',
  AI: 'Anguilla', AL: 'Albania', AM: 'Armenia', AO: 'Angola', AQ: 'Antarctica',
  AR: 'Argentina', AS: 'American Samoa', AT: 'Austria', AU: 'Australia', AW: 'Aruba',
  AX: 'Aland Islands', AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BB: 'Barbados',
  BD: 'Bangladesh', BE: 'Belgium', BF: 'Burkina Faso', BG: 'Bulgaria', BH: 'Bahrain',
  BI: 'Burundi', BJ: 'Benin', BL: 'Saint Barthelemy', BM: 'Bermuda', BN: 'Brunei',
  BO: 'Bolivia', BQ: 'Caribbean Netherlands', BR: 'Brazil', BS: 'Bahamas', BT: 'Bhutan',
  BV: 'Bouvet Island', BW: 'Botswana', BY: 'Belarus', BZ: 'Belize', CA: 'Canada',
  CC: 'Cocos Islands', CD: 'DR Congo', CF: 'Central African Republic', CG: 'Republic of the Congo',
  CH: 'Switzerland', CI: 'Ivory Coast', CK: 'Cook Islands', CL: 'Chile', CM: 'Cameroon',
  CN: 'China', CO: 'Colombia', CR: 'Costa Rica', CU: 'Cuba', CV: 'Cape Verde',
  CW: 'Curacao', CX: 'Christmas Island', CY: 'Cyprus', CZ: 'Czech Republic',
  DE: 'Germany', DJ: 'Djibouti', DK: 'Denmark', DM: 'Dominica', DO: 'Dominican Republic',
  DZ: 'Algeria', EC: 'Ecuador', EE: 'Estonia', EG: 'Egypt', EH: 'Western Sahara',
  ER: 'Eritrea', ES: 'Spain', ET: 'Ethiopia', FI: 'Finland', FJ: 'Fiji',
  FK: 'Falkland Islands', FM: 'Micronesia', FO: 'Faroe Islands', FR: 'France',
  GA: 'Gabon', GB: 'United Kingdom', GD: 'Grenada', GE: 'Georgia', GF: 'French Guiana',
  GG: 'Guernsey', GH: 'Ghana', GI: 'Gibraltar', GL: 'Greenland', GM: 'Gambia',
  GN: 'Guinea', GP: 'Guadeloupe', GQ: 'Equatorial Guinea', GR: 'Greece', GS: 'South Georgia',
  GT: 'Guatemala', GU: 'Guam', GW: 'Guinea-Bissau', GY: 'Guyana', HK: 'Hong Kong',
  HM: 'Heard Island and McDonald Islands', HN: 'Honduras', HR: 'Croatia', HT: 'Haiti',
  HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IL: 'Israel', IM: 'Isle of Man',
  IN: 'India', IO: 'British Indian Ocean Territory', IQ: 'Iraq', IR: 'Iran',
  IS: 'Iceland', IT: 'Italy', JE: 'Jersey', JM: 'Jamaica', JO: 'Jordan',
  JP: 'Japan', KE: 'Kenya', KG: 'Kyrgyzstan', KH: 'Cambodia', KI: 'Kiribati',
  KM: 'Comoros', KN: 'Saint Kitts and Nevis', KP: 'North Korea', KR: 'South Korea',
  KW: 'Kuwait', KY: 'Cayman Islands', KZ: 'Kazakhstan', LA: 'Laos', LB: 'Lebanon',
  LC: 'Saint Lucia', LI: 'Liechtenstein', LK: 'Sri Lanka', LR: 'Liberia', LS: 'Lesotho',
  LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia', LY: 'Libya', MA: 'Morocco',
  MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro', MF: 'Saint Martin', MG: 'Madagascar',
  MH: 'Marshall Islands', MK: 'North Macedonia', ML: 'Mali', MM: 'Myanmar', MN: 'Mongolia',
  MO: 'Macau', MP: 'Northern Mariana Islands', MQ: 'Martinique', MR: 'Mauritania',
  MS: 'Montserrat', MT: 'Malta', MU: 'Mauritius', MV: 'Maldives', MW: 'Malawi',
  MX: 'Mexico', MY: 'Malaysia', MZ: 'Mozambique', NA: 'Namibia', NC: 'New Caledonia',
  NE: 'Niger', NF: 'Norfolk Island', NG: 'Nigeria', NI: 'Nicaragua', NL: 'Netherlands',
  NO: 'Norway', NP: 'Nepal', NR: 'Nauru', NU: 'Niue', NZ: 'New Zealand',
  OM: 'Oman', PA: 'Panama', PE: 'Peru', PF: 'French Polynesia', PG: 'Papua New Guinea',
  PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PM: 'Saint Pierre and Miquelon',
  PN: 'Pitcairn Islands', PR: 'Puerto Rico', PS: 'Palestine', PT: 'Portugal',
  PW: 'Palau', PY: 'Paraguay', QA: 'Qatar', RE: 'Reunion', RO: 'Romania',
  RS: 'Serbia', RU: 'Russia', RW: 'Rwanda', SA: 'Saudi Arabia', SB: 'Solomon Islands',
  SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SG: 'Singapore', SH: 'Saint Helena',
  SI: 'Slovenia', SJ: 'Svalbard', SK: 'Slovakia', SL: 'Sierra Leone', SM: 'San Marino',
  SN: 'Senegal', SO: 'Somalia', SR: 'Suriname', SS: 'South Sudan', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', SX: 'Sint Maarten', SY: 'Syria', SZ: 'Eswatini', TA: 'Tristan da Cunha',
  TC: 'Turks and Caicos', TD: 'Chad', TF: 'French Southern Territories', TG: 'Togo',
  TH: 'Thailand', TJ: 'Tajikistan', TK: 'Tokelau', TL: 'Timor Leste', TM: 'Turkmenistan',
  TN: 'Tunisia', TO: 'Tonga', TR: 'Turkey', TT: 'Trinidad and Tobago', TV: 'Tuvalu',
  TW: 'Taiwan', TZ: 'Tanzania', UA: 'Ukraine', UG: 'Uganda', UM: 'US Minor Outlying Islands',
  US: 'United States', UY: 'Uruguay', UZ: 'Uzbekistan', VA: 'Vatican City',
  VC: 'St Vincent and the Grenadines', VE: 'Venezuela', VG: 'British Virgin Islands',
  VI: 'US Virgin Islands', VN: 'Vietnam', VU: 'Vanuatu', WF: 'Wallis and Futuna',
  WS: 'Samoa', XK: 'Kosovo', YE: 'Yemen', YT: 'Mayotte', ZA: 'South Africa',
  ZM: 'Zambia', ZW: 'Zimbabwe',
};

// Reverse lookup for the subset of countries we have bounding boxes for.
export const COUNTRY_NAME_TO_ISO: Record<string, string> = {};
for (const [code, name] of Object.entries(ISO_COUNTRY_NAMES)) {
  if (COUNTRY_BBOXES[name]) {
    COUNTRY_NAME_TO_ISO[name] = code;
  }
}

/**
 * Normalize a country display name or ISO code to its ISO 3166-1 alpha-2 code.
 * Returns undefined if the input isn't recognized.
 */
export function getCountryCode(countryName: string): string | undefined {
  if (countryName.length === 2 && ISO_COUNTRY_NAMES[countryName]) {
    return countryName;
  }
  return COUNTRY_NAME_TO_ISO[countryName];
}
