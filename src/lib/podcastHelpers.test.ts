import { describe, expect, it } from 'vitest';
import { parsePodcastEpisode, parsePodcastTrailer } from './podcastHelpers';
import type { NostrEvent } from '@nostrify/nostrify';

function makeEvent(overrides: Partial<NostrEvent> & { tags?: string[][]; content?: string } = {}): NostrEvent {
  return {
    id: 'id',
    pubkey: 'pub',
    created_at: 1234567890,
    kind: 30054,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
    sig: 'sig',
    ...overrides,
  };
}

describe('parsePodcastEpisode', () => {
  it('returns a sanitized HTTPS audio URL', () => {
    const event = makeEvent({ tags: [['audio', 'https://example.com/ep.mp3']] });
    const parsed = parsePodcastEpisode(event);
    expect(parsed?.audioUrl).toBe('https://example.com/ep.mp3');
  });

  it('rejects a non-HTTPS audio URL', () => {
    const event = makeEvent({ tags: [['audio', 'http://example.com/ep.mp3']] });
    expect(parsePodcastEpisode(event)).toBeNull();
  });

  it('rejects a javascript: audio URL', () => {
    const event = makeEvent({ tags: [['audio', 'javascript:alert(1)']] });
    expect(parsePodcastEpisode(event)).toBeNull();
  });

  it('sanitizes artwork to HTTPS', () => {
    const event = makeEvent({ tags: [['audio', 'https://example.com/ep.mp3'], ['image', 'https://example.com/art.png']] });
    const parsed = parsePodcastEpisode(event);
    expect(parsed?.artwork).toBe('https://example.com/art.png');
  });

  it('drops non-HTTPS artwork', () => {
    const event = makeEvent({ tags: [['audio', 'https://example.com/ep.mp3'], ['image', 'http://example.com/art.png']] });
    const parsed = parsePodcastEpisode(event);
    expect(parsed?.artwork).toBeUndefined();
  });

  it('reads artwork from imeta thumbnail', () => {
    const event = makeEvent({
      tags: [['imeta', 'url https://example.com/ep.mp3', 'image https://example.com/thumb.png', 'm audio/mpeg']],
    });
    const parsed = parsePodcastEpisode(event);
    expect(parsed?.audioUrl).toBe('https://example.com/ep.mp3');
    expect(parsed?.artwork).toBe('https://example.com/thumb.png');
  });
});

describe('parsePodcastTrailer', () => {
  it('returns a sanitized HTTPS trailer URL', () => {
    const event = makeEvent({ kind: 30055, tags: [['url', 'https://example.com/trailer.mp3']] });
    const parsed = parsePodcastTrailer(event);
    expect(parsed?.url).toBe('https://example.com/trailer.mp3');
  });

  it('rejects a non-HTTPS trailer URL', () => {
    const event = makeEvent({ kind: 30055, tags: [['url', 'http://example.com/trailer.mp3']] });
    expect(parsePodcastTrailer(event)).toBeNull();
  });
});
