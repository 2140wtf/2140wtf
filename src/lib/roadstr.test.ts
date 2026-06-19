import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  computeEffectiveExpiry,
  isRoadstrReportActive,
  parseRoadstrConfirmation,
  parseRoadstrReport,
} from './roadstr';

const NOW = 1_700_000_000;

function makeEvent(kind: number, tags: string[][], content = ''): NostrEvent {
  return {
    kind,
    id: '00'.repeat(32),
    pubkey: '11'.repeat(32),
    created_at: NOW,
    tags,
    content,
    sig: 'ff'.repeat(64),
  };
}

const validReportTags: string[][] = [
  ['t', 'police'],
  ['g', 'u09t'],
  ['g', 'u09tv'],
  ['g', 'u09tvw'],
  ['lat', '48.8566140'],
  ['lon', '2.3522219'],
  ['expiration', String(NOW + 14 * 24 * 60 * 60)],
  ['alt', 'Roadstr: police report'],
];

describe('parseRoadstrReport', () => {
  it('parses a valid kind 1315 report', () => {
    const event = makeEvent(1315, validReportTags, 'Checking seatbelts');
    const report = parseRoadstrReport(event);
    expect(report).toBeDefined();
    expect(report?.type).toBe('police');
    expect(report?.lat).toBe(48.856614);
    expect(report?.lon).toBe(2.3522219);
    expect(report?.geohashes).toEqual(['u09t', 'u09tv', 'u09tvw']);
    expect(report?.comment).toBe('Checking seatbelts');
    expect(report?.expiration).toBe(NOW + 14 * 24 * 60 * 60);
    expect(report?.alt).toBe('Roadstr: police report');
  });

  it('returns undefined for the wrong kind', () => {
    expect(parseRoadstrReport(makeEvent(1, validReportTags))).toBeUndefined();
  });

  it('returns undefined when the type tag is missing', () => {
    const tags = validReportTags.filter(([name]) => name !== 't');
    expect(parseRoadstrReport(makeEvent(1315, tags))).toBeUndefined();
  });

  it('returns undefined for an unknown event type', () => {
    const tags = validReportTags.map(([name, value]) => (name === 't' ? [name, 'ufo'] : [name, value]));
    expect(parseRoadstrReport(makeEvent(1315, tags))).toBeUndefined();
  });

  it('returns undefined when lat or lon is missing', () => {
    const noLat = validReportTags.filter(([name]) => name !== 'lat');
    const noLon = validReportTags.filter(([name]) => name !== 'lon');
    expect(parseRoadstrReport(makeEvent(1315, noLat))).toBeUndefined();
    expect(parseRoadstrReport(makeEvent(1315, noLon))).toBeUndefined();
  });

  it('returns undefined when no geohash tags are present', () => {
    const tags = validReportTags.filter(([name]) => name !== 'g');
    expect(parseRoadstrReport(makeEvent(1315, tags))).toBeUndefined();
  });

  it('parses reports without an expiration tag', () => {
    const tags = validReportTags.filter(([name]) => name !== 'expiration');
    const report = parseRoadstrReport(makeEvent(1315, tags));
    expect(report).toBeDefined();
    expect(report?.expiration).toBeUndefined();
  });
});

const validConfirmationTags: string[][] = [
  ['e', 'aa'.repeat(32)],
  ['g', 'u09t'],
  ['g', 'u09tv'],
  ['g', 'u09tvw'],
  ['status', 'still_there'],
  ['lat', '48.8566140'],
  ['lon', '2.3522219'],
  ['expiration', String(NOW + 14 * 24 * 60 * 60)],
];

describe('parseRoadstrConfirmation', () => {
  it('parses a valid kind 1316 confirmation', () => {
    const event = makeEvent(1316, validConfirmationTags);
    const conf = parseRoadstrConfirmation(event);
    expect(conf).toBeDefined();
    expect(conf?.reportId).toBe('aa'.repeat(32));
    expect(conf?.status).toBe('still_there');
    expect(conf?.lat).toBe(48.856614);
    expect(conf?.lon).toBe(2.3522219);
  });

  it('returns undefined for the wrong kind', () => {
    expect(parseRoadstrConfirmation(makeEvent(1315, validConfirmationTags))).toBeUndefined();
  });

  it('returns undefined when the report event id is missing', () => {
    const tags = validConfirmationTags.filter(([name]) => name !== 'e');
    expect(parseRoadstrConfirmation(makeEvent(1316, tags))).toBeUndefined();
  });

  it('returns undefined for an unknown status', () => {
    const tags = validConfirmationTags.map(([name, value]) =>
      name === 'status' ? [name, 'maybe'] : [name, value]
    );
    expect(parseRoadstrConfirmation(makeEvent(1316, tags))).toBeUndefined();
  });

  it('defaults lat/lon to 0 when missing', () => {
    const tags = validConfirmationTags.filter(([name]) => name !== 'lat' && name !== 'lon');
    const conf = parseRoadstrConfirmation(makeEvent(1316, tags));
    expect(conf?.lat).toBe(0);
    expect(conf?.lon).toBe(0);
  });
});

describe('computeEffectiveExpiry', () => {
  it('uses the type TTL when there are no confirmations', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    expect(computeEffectiveExpiry(report, [])).toBe(NOW + 2 * 60 * 60);
  });

  it('extends expiry on still_there confirmations', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    const conf = parseRoadstrConfirmation(
      makeEvent(1316, [
        ['e', report.id],
        ['status', 'still_there'],
      ])
    )!;
    conf.createdAt = NOW + 3_600;
    expect(computeEffectiveExpiry(report, [conf])).toBe(conf.createdAt + 2 * 60 * 60);
  });

  it('shortens expiry on no_longer_there confirmations', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    const conf = parseRoadstrConfirmation(
      makeEvent(1316, [
        ['e', report.id],
        ['status', 'no_longer_there'],
      ])
    )!;
    conf.createdAt = NOW + 600;
    expect(computeEffectiveExpiry(report, [conf])).toBe(conf.createdAt);
  });

  it('applies confirmations in chronological order', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    const gone = parseRoadstrConfirmation(
      makeEvent(1316, [
        ['e', report.id],
        ['status', 'no_longer_there'],
      ])
    )!;
    gone.createdAt = NOW + 600;
    const still = parseRoadstrConfirmation(
      makeEvent(1316, [
        ['e', report.id],
        ['status', 'still_there'],
      ])
    )!;
    still.createdAt = NOW + 1_200;
    expect(computeEffectiveExpiry(report, [gone, still])).toBe(still.createdAt + 2 * 60 * 60);
  });

  it('ignores confirmations for other reports', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    const conf = parseRoadstrConfirmation(
      makeEvent(1316, [
        ['e', 'bb'.repeat(32)],
        ['status', 'no_longer_there'],
      ])
    )!;
    conf.createdAt = NOW + 600;
    expect(computeEffectiveExpiry(report, [conf])).toBe(NOW + 2 * 60 * 60);
  });
});

describe('isRoadstrReportActive', () => {
  it('returns true before the effective expiry', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    expect(isRoadstrReportActive(report, [], NOW + 1)).toBe(true);
  });

  it('returns false after the effective expiry', () => {
    const report = parseRoadstrReport(makeEvent(1315, validReportTags))!;
    expect(isRoadstrReportActive(report, [], NOW + 2 * 60 * 60)).toBe(false);
  });
});
