import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Moon, Sun, Terminal } from 'lucide-react';

import { ThemeQuickSwitch } from './ThemeQuickSwitch';

const mocks = vi.hoisted(() => ({
  selectBright: vi.fn(),
  theme: 'custom' as 'custom' | 'system',
  customTheme: { title: 'Sunset' } as { title?: string } | undefined,
}));

vi.mock('@/hooks/useAppearanceModes', () => ({
  useAppearanceModes: () => [
    { id: 'bright', label: 'Bright', icon: Sun, active: false, onSelect: mocks.selectBright },
    { id: 'dark', label: 'Dark', icon: Moon, active: false, onSelect: vi.fn() },
    { id: 'hacker', label: 'Hacker', icon: Terminal, active: false, onSelect: vi.fn() },
  ],
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: mocks.theme, customTheme: mocks.customTheme }),
}));

describe('ThemeQuickSwitch fallback mode', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.theme = 'custom';
    mocks.customTheme = { title: 'Sunset' };
  });

  it('shows the active custom theme truthfully in the expanded control', () => {
    render(<ThemeQuickSwitch />);

    const fallback = screen.getByRole('button', { name: 'Sunset color theme; switch to Bright' });
    expect(fallback).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(fallback);
    expect(mocks.selectBright).toHaveBeenCalledOnce();
  });

  it('labels system mode truthfully in the expanded control', () => {
    mocks.theme = 'system';
    mocks.customTheme = undefined;
    render(<ThemeQuickSwitch />);

    expect(screen.getByRole('button', { name: 'System color theme; switch to Bright' })).toHaveAttribute('aria-pressed', 'true');
  });
});
