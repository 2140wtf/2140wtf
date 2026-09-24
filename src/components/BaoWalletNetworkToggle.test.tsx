import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BaoWalletNetworkToggle } from './BaoWalletNetworkToggle';

describe('BaoWalletNetworkToggle', () => {
  it('shows the active mode and reports a switch', () => {
    const onChange = vi.fn();
    render(<BaoWalletNetworkToggle value="demo" onChange={onChange} />);

    const demo = screen.getByRole('tab', { name: 'Demo · signet' });
    const testnet = screen.getByRole('tab', { name: 'Testnet' });
    expect(demo).toHaveAttribute('aria-selected', 'true');
    expect(testnet).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(testnet);
    expect(onChange).toHaveBeenCalledWith('testnet');
  });

  it('marks Testnet selected when it is the active mode', () => {
    render(<BaoWalletNetworkToggle value="testnet" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Testnet' })).toHaveAttribute('aria-selected', 'true');
  });
});
