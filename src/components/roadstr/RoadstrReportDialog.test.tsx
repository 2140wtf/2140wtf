import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import { RoadstrReportDialog } from './RoadstrReportDialog';

const mocks = vi.hoisted(() => ({
  currentUser: null as { pubkey: string } | null,
  publish: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mocks.currentUser }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: mocks.publish, isPending: false }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('RoadstrReportDialog', () => {
  beforeEach(() => {
    mocks.currentUser = null;
    mocks.publish.mockClear();
    mocks.toast.mockClear();

    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 12.345, longitude: 67.89 },
      } as GeolocationPosition);
    });
    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
  });

  it('prompts login when the user is not authenticated', async () => {
    await act(async () => {
      render(
        <TestApp>
          <RoadstrReportDialog open onOpenChange={() => {}} />
        </TestApp>,
      );
    });

    const reportButton = screen.getByRole('button', { name: /Report/i });
    await act(async () => {
      fireEvent.click(reportButton);
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Log in to report road events' }));
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('publishes a kind 1315 report using the provided location', async () => {
    mocks.currentUser = { pubkey: '11'.repeat(32) };

    await act(async () => {
      render(
        <TestApp>
          <RoadstrReportDialog
            open
            onOpenChange={() => {}}
            location={{ lat: 48.856614, lon: 2.3522219 }}
          />
        </TestApp>,
      );
    });

    const reportButton = screen.getByRole('button', { name: /Report/i });
    await act(async () => {
      fireEvent.click(reportButton);
    });

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const call = mocks.publish.mock.calls[0][0] as NostrEvent;
    expect(call.kind).toBe(1315);
    expect(call.content).toBe('');

    const tags = Object.fromEntries(call.tags.map(([k, v]) => [k, v]));
    expect(tags.t).toBe('other');
    expect(tags.lat).toBe('48.8566140');
    expect(tags.lon).toBe('2.3522219');
    expect(Number.isFinite(Number(tags.expiration))).toBe(true);
  });

  it('uses navigator.geolocation when no location is provided', async () => {
    mocks.currentUser = { pubkey: '11'.repeat(32) };

    await act(async () => {
      render(
        <TestApp>
          <RoadstrReportDialog open onOpenChange={() => {}} />
        </TestApp>,
      );
    });

    const reportButton = screen.getByRole('button', { name: /Report/i });
    await act(async () => {
      fireEvent.click(reportButton);
    });

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const call = mocks.publish.mock.calls[0][0] as NostrEvent;
    expect(call.kind).toBe(1315);

    const tags = Object.fromEntries(call.tags.map(([k, v]) => [k, v]));
    expect(tags.lat).toBe('12.3450000');
    expect(tags.lon).toBe('67.8900000');
  });
});
