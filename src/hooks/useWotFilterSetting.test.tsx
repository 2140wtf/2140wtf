import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSettings } from '@/hooks/useEncryptedSettings';
import { DEFAULT_WOT_THRESHOLD, useWotFilterSetting } from './useWotFilterSetting';

vi.mock('@/hooks/useCurrentUser');
vi.mock('@/hooks/useEncryptedSettings');

const mutate = vi.fn();
const pubkey = 'a'.repeat(64);

function mockAccount(wotFilter?: { enabled: boolean; threshold: number }) {
  vi.mocked(useCurrentUser).mockReturnValue({
    user: { pubkey },
  } as ReturnType<typeof useCurrentUser>);
  vi.mocked(useEncryptedSettings).mockReturnValue({
    settings: wotFilter ? { wotFilter } : null,
    updateSettings: { mutate },
    hasNip44Support: true,
  } as unknown as ReturnType<typeof useEncryptedSettings>);
}

describe('useWotFilterSetting', () => {
  beforeEach(() => {
    localStorage.clear();
    mutate.mockReset();
    mockAccount();
  });

  it('protects a new account with an enabled score of 40', async () => {
    const { result } = renderHook(() => useWotFilterSetting(), { wrapper: TestApp });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current.enabled).toBe(true);
    expect(result.current.threshold).toBe(DEFAULT_WOT_THRESHOLD);
    expect(DEFAULT_WOT_THRESHOLD).toBe(40);
  });

  it('respects the account setting restored from encrypted NIP-78 storage', async () => {
    mockAccount({ enabled: false, threshold: 73 });

    const { result } = renderHook(() => useWotFilterSetting(), { wrapper: TestApp });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current.enabled).toBe(false);
    expect(result.current.threshold).toBe(73);
  });

  it('applies changes immediately and debounces encrypted cross-device sync', async () => {
    const { result } = renderHook(() => useWotFilterSetting(), { wrapper: TestApp });
    await waitFor(() => expect(result.current).not.toBeNull());
    vi.useFakeTimers();

    act(() => result.current.setThreshold(62));
    expect(result.current.threshold).toBe(62);
    expect(mutate).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(
      { wotFilter: { enabled: true, threshold: 62 } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    vi.useRealTimers();
  });
});
