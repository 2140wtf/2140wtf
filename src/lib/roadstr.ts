import type { NostrEvent } from '@nostrify/nostrify';
import { isRoadstrEventType, ROADSTR_EVENT_TYPES, type RoadstrEventType } from '@/components/roadstr/roadstrTypes';

export interface RoadstrReport {
  id: string;
  pubkey: string;
  createdAt: number;
  kind: 1315;
  type: RoadstrEventType;
  lat: number;
  lon: number;
  geohashes: string[];
  comment: string;
  expiration?: number;
  alt?: string;
  event: NostrEvent;
}

export interface RoadstrConfirmation {
  id: string;
  pubkey: string;
  createdAt: number;
  kind: 1316;
  reportId: string;
  status: 'still_there' | 'no_longer_there';
  lat: number;
  lon: number;
  geohashes: string[];
  alt?: string;
  event: NostrEvent;
}

function parseNumberTag(tags: string[][], name: string): number | undefined {
  const value = tags.find(([n]) => n === name)?.[1];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStringTag(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

/**
 * Parse a kind 1315 Roadstr report event.
 * Returns undefined if required tags are missing or malformed.
 */
export function parseRoadstrReport(event: NostrEvent): RoadstrReport | undefined {
  if (event.kind !== 1315) return undefined;

  const typeValue = parseStringTag(event.tags, 't');
  if (!typeValue || !isRoadstrEventType(typeValue)) return undefined;

  const lat = parseNumberTag(event.tags, 'lat');
  const lon = parseNumberTag(event.tags, 'lon');
  if (lat === undefined || lon === undefined) return undefined;

  const expiration = parseNumberTag(event.tags, 'expiration');

  const geohashes = event.tags.filter(([n]) => n === 'g').map(([, v]) => v).filter(Boolean);
  if (geohashes.length === 0) return undefined;

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: 1315,
    type: typeValue,
    lat,
    lon,
    geohashes,
    comment: event.content ?? '',
    expiration,
    alt: parseStringTag(event.tags, 'alt'),
    event,
  };
}

/**
 * Parse a kind 1316 Roadstr confirmation/denial event.
 * Returns undefined if required tags are missing or malformed.
 */
export function parseRoadstrConfirmation(event: NostrEvent): RoadstrConfirmation | undefined {
  if (event.kind !== 1316) return undefined;

  const reportId = parseStringTag(event.tags, 'e');
  if (!reportId) return undefined;

  const statusValue = parseStringTag(event.tags, 'status');
  if (statusValue !== 'still_there' && statusValue !== 'no_longer_there') return undefined;

  const geohashes = event.tags.filter(([n]) => n === 'g').map(([, v]) => v).filter(Boolean);

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: 1316,
    reportId,
    status: statusValue,
    lat: parseNumberTag(event.tags, 'lat') ?? 0,
    lon: parseNumberTag(event.tags, 'lon') ?? 0,
    geohashes,
    alt: parseStringTag(event.tags, 'alt'),
    event,
  };
}

/**
 * Compute the effective expiry of a report based on its type TTL and
 * any confirmations received, per the Roadstr spec.
 */
export function computeEffectiveExpiry(
  report: RoadstrReport,
  confirmations: RoadstrConfirmation[],
): number {
  const ttl = ROADSTR_EVENT_TYPES[report.type].ttlSeconds;
  let expiry = report.createdAt + ttl;

  const sorted = [...confirmations]
    .filter((c) => c.reportId === report.id)
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const conf of sorted) {
    if (conf.status === 'still_there') {
      expiry = Math.max(expiry, conf.createdAt + ttl);
    } else {
      expiry = Math.min(expiry, conf.createdAt);
    }
  }

  return expiry;
}

/**
 * Returns true if the report is still active at the given timestamp.
 */
export function isRoadstrReportActive(
  report: RoadstrReport,
  confirmations: RoadstrConfirmation[],
  now?: number,
): boolean {
  const ts = now ?? Math.floor(Date.now() / 1000);
  return computeEffectiveExpiry(report, confirmations) > ts;
}
