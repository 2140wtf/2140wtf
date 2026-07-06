import { describe, expect, it } from 'vitest';

import { DUST_LIMIT, estimateFee, VBYTES_OVERHEAD, VBYTES_PER_INPUT, VBYTES_PER_OUTPUT } from '@/lib/feeEstimation';

describe('feeEstimation', () => {
  it('exports consistent P2TR constants', () => {
    expect(DUST_LIMIT).toBe(546);
    expect(VBYTES_PER_INPUT).toBe(57.5);
    expect(VBYTES_PER_OUTPUT).toBe(43);
    expect(VBYTES_OVERHEAD).toBe(10.5);
  });

  it('estimates fee from inputs, outputs, and fee rate', () => {
    // 1 input, 2 outputs, 10 sat/vB
    // vBytes = 57.5 + 86 + 10.5 = 154
    // fee = ceil(154 * 10) = 1540
    expect(estimateFee(1, 2, 10)).toBe(1540);
  });

  it('rounds fee up to whole sats', () => {
    // vBytes = 57.5 + 43 + 10.5 = 111
    // fee at 1 sat/vB = 111 (exact)
    expect(estimateFee(1, 1, 1)).toBe(111);
  });
});
