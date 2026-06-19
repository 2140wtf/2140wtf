import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { RoadstrReportContent, RoadstrConfirmationContent } from './RoadstrReportContent';

vi.mock('@/lib/timeAgo', () => ({
  timeAgo: (_ts: number) => '2h ago',
}));

vi.mock('@/lib/encodeEvent', () => ({
  encodeEventAddress: () => 'nevent1fake',
}));

const NOW = 1_700_000_000;

function makeReportEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '00'.repeat(32),
    pubkey: '11'.repeat(32),
    created_at: NOW,
    kind: 1315,
    tags: [
      ['t', 'police'],
      ['g', 'u09t'],
      ['g', 'u09tv'],
      ['lat', '48.8566140'],
      ['lon', '2.3522219'],
      ['expiration', String(NOW + 14 * 24 * 60 * 60)],
    ],
    content: 'Checking seatbelts',
    sig: 'ff'.repeat(64),
    ...overrides,
  };
}

function makeConfirmationEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '22'.repeat(32),
    pubkey: '33'.repeat(32),
    created_at: NOW + 300,
    kind: 1316,
    tags: [
      ['e', '00'.repeat(32)],
      ['status', 'still_there'],
      ['g', 'u09t'],
    ],
    content: '',
    sig: 'ff'.repeat(64),
    ...overrides,
  };
}

describe('RoadstrReportContent', () => {
  it('renders the type label, coordinates, and comment', () => {
    render(
      <TestApp>
        <RoadstrReportContent event={makeReportEvent()} />
      </TestApp>,
    );

    expect(screen.getByText('Police')).toBeInTheDocument();
    expect(screen.getByText(/48\.85661, 2\.35222/)).toBeInTheDocument();
    expect(screen.getByText('Checking seatbelts')).toBeInTheDocument();
  });

  it('shows an expired badge when the report is no longer active', () => {
    render(
      <TestApp>
        <RoadstrReportContent
          event={makeReportEvent()}
          confirmations={[]}
          now={NOW + 10 * 60 * 60}
        />
      </TestApp>,
    );

    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('shows confirmation counts in expanded mode', () => {
    render(
      <TestApp>
        <RoadstrReportContent
          event={makeReportEvent()}
          confirmations={[
            {
              id: '22'.repeat(32),
              pubkey: '33'.repeat(32),
              createdAt: NOW + 300,
              kind: 1316,
              reportId: '00'.repeat(32),
              status: 'still_there',
              lat: 48.856614,
              lon: 2.352222,
              geohashes: ['u09t'],
              event: makeConfirmationEvent(),
            },
          ]}
          expanded
        />
      </TestApp>,
    );

    expect(screen.getByText(/1 still there/)).toBeInTheDocument();
  });
});

describe('RoadstrConfirmationContent', () => {
  it('renders a still_there confirmation', () => {
    render(
      <TestApp>
        <RoadstrConfirmationContent event={makeConfirmationEvent({ tags: [['e', '00'.repeat(32)], ['status', 'still_there']] })} />
      </TestApp>,
    );

    expect(screen.getByText('confirmed a road event')).toBeInTheDocument();
  });

  it('renders a no_longer_there confirmation', () => {
    render(
      <TestApp>
        <RoadstrConfirmationContent
          event={makeConfirmationEvent({ tags: [['e', '00'.repeat(32)], ['status', 'no_longer_there']] })}
        />
      </TestApp>,
    );

    expect(screen.getByText('marked a road event as gone')).toBeInTheDocument();
  });
});
