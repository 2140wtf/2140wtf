import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_FRAME_DIM, QrScanDialog, boundedFrameSize } from './QrScanDialog';

const jsqrMock = vi.hoisted(() => vi.fn(() => ({ data: 'cashuBmocked-jsqr' })));
vi.mock('jsqr', () => ({ default: jsqrMock }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

it('fails closed with an explanatory message when scanning is unsupported', async () => {
  const getUserMedia = vi.fn();
  await act(async () => {
    root.render(
      <QrScanDialog
        open
        title="Scan a Cashu token"
        onResult={vi.fn()}
        onClose={vi.fn()}
        detectorFactory={() => null}
        frameDecoderFactory={() => null}
        mediaDevices={{ getUserMedia }}
      />,
    );
  });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=qr-scan-unsupported]')?.textContent).toContain('paste the code instead');
  });
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid=qr-scan-video]')).toBeNull();
});

it('falls back to the jsqr frame decoder when BarcodeDetector is unavailable', async () => {
  const onResult = vi.fn();
  const { stream } = fakeStream();
  await act(async () => {
    root.render(
      <QrScanDialog
        open
        title="Scan a Cashu token"
        onResult={onResult}
        onClose={vi.fn()}
        detectorFactory={() => null}
        frameDecoderFactory={() => () => 'cashuBvia-jsqr'}
        mediaDevices={{ getUserMedia: vi.fn(async () => stream) }}
      />,
    );
  });
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('cashuBvia-jsqr'), { timeout: 10_000 });
  expect(container.querySelector('[data-testid=qr-scan-unsupported]')).toBeNull();
  expect(container.querySelector('[data-testid=qr-scan-video]')).toBeTruthy();
});

it('decodes with the real jsqr default path (lazy import + canvas frame)', async () => {
  const onResult = vi.fn();
  const { stream } = fakeStream();
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4) }));
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D);
  const width = vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(320);
  const height = vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(240);
  try {
    await act(async () => {
      root.render(
        <QrScanDialog
          open
          title="Scan a Cashu token"
          onResult={onResult}
          onClose={vi.fn()}
          detectorFactory={() => null}
          mediaDevices={{ getUserMedia: vi.fn(async () => stream) }}
        />,
      );
    });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('cashuBmocked-jsqr'), { timeout: 10_000 });
    expect(jsqrMock).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
  } finally {
    getContext.mockRestore();
    width.mockRestore();
    height.mockRestore();
  }
});

it('bounds the jsqr decode frame to the max dimension (downscale, never upscale)', () => {
  expect(boundedFrameSize(1920, 1080)).toEqual({ width: MAX_FRAME_DIM, height: Math.round(1080 * (MAX_FRAME_DIM / 1920)) });
  expect(boundedFrameSize(1080, 1920)).toEqual({ width: Math.round(1080 * (MAX_FRAME_DIM / 1920)), height: MAX_FRAME_DIM });
  expect(boundedFrameSize(320, 240)).toEqual({ width: 320, height: 240 }); // no upscale
  expect(boundedFrameSize(0, 240)).toEqual({ width: 0, height: 0 });
});

it('downscales a large camera frame before jsqr (bounded per-tick work)', async () => {
  const onResult = vi.fn();
  const { stream } = fakeStream();
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4) }));
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D);
  const width = vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(3840);
  const height = vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(2160);
  try {
    await act(async () => {
      root.render(
        <QrScanDialog
          open
          title="Scan a Cashu token"
          onResult={onResult}
          onClose={vi.fn()}
          detectorFactory={() => null}
          mediaDevices={{ getUserMedia: vi.fn(async () => stream) }}
        />,
      );
    });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('cashuBmocked-jsqr'), { timeout: 10_000 });
    // 4K frames must never reach jsqr at full resolution.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_FRAME_DIM, Math.round(2160 * (MAX_FRAME_DIM / 3840)));
    expect(getImageData).toHaveBeenCalledWith(0, 0, MAX_FRAME_DIM, Math.round(2160 * (MAX_FRAME_DIM / 3840)));
  } finally {
    getContext.mockRestore();
    width.mockRestore();
    height.mockRestore();
  }
});

it('skips overlapping decode ticks while a decode is still in flight', async () => {
  vi.useFakeTimers();
  try {
    const onResult = vi.fn();
    const { stream } = fakeStream();
    const pending: Array<(codes: Array<{ rawValue: string }>) => void> = [];
    const detect = vi.fn(() => new Promise<Array<{ rawValue: string }>>((resolve) => pending.push(resolve)));
    await act(async () => {
      root.render(
        <QrScanDialog
          open
          title="Scan a Cashu token"
          onResult={onResult}
          onClose={vi.fn()}
          detectorFactory={() => ({ detect })}
          mediaDevices={{ getUserMedia: vi.fn(async () => stream) }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Three 300ms ticks while the first detect() never settles: one decode.
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(detect).toHaveBeenCalledTimes(1);
    // Settling the in-flight decode releases the latch for the next tick.
    await act(async () => {
      pending[0]([]);
      await Promise.resolve();
    });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(detect).toHaveBeenCalledTimes(2);
    pending[1]([]);
  } finally {
    vi.useRealTimers();
  }
});

it('delivers a static QR code and closes the dialog', async () => {
  const onResult = vi.fn();
  const onClose = vi.fn();
  const { stream } = fakeStream();
  const getUserMedia = vi.fn(async () => stream);
  await act(async () => {
    root.render(
      <QrScanDialog
        open
        title="Scan a Cashu token"
        onResult={onResult}
        onClose={onClose}
        detectorFactory={() => ({ detect: async () => [{ rawValue: 'cashuBstatic-code' }] })}
        mediaDevices={{ getUserMedia }}
      />,
    );
  });
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled(), { timeout: 10_000 });
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('cashuBstatic-code'), { timeout: 10_000 });
  expect(onClose).toHaveBeenCalled();
});

it('shows the camera error when permission is denied', async () => {
  const onResult = vi.fn();
  await act(async () => {
    root.render(
      <QrScanDialog
        open
        title="Scan a Lightning invoice"
        onResult={onResult}
        onClose={vi.fn()}
        detectorFactory={() => ({ detect: async () => [] })}
        mediaDevices={{ getUserMedia: vi.fn(async () => { throw new Error('Permission denied'); }) }}
      />,
    );
  });
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid=qr-scan-error]')?.textContent).toContain('Permission denied');
  });
  expect(onResult).not.toHaveBeenCalled();
});

it('keeps scanning after an invalid frame (animated QR in progress)', async () => {
  const onResult = vi.fn();
  const { stream } = fakeStream();
  let calls = 0;
  await act(async () => {
    root.render(
      <QrScanDialog
        open
        title="Scan a Cashu token"
        onResult={onResult}
        onClose={vi.fn()}
        detectorFactory={() => ({
          detect: async () => {
            calls += 1;
            return calls === 1 ? [{ rawValue: 'ur:bytes/broken-part' }] : [{ rawValue: 'cashuBrecovered' }];
          },
        })}
        mediaDevices={{ getUserMedia: vi.fn(async () => stream) }}
      />,
    );
  });
  await vi.waitFor(() => expect(container.querySelector('[data-testid=qr-scan-error]')).toBeTruthy(), { timeout: 10_000 });
  await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith('cashuBrecovered'), { timeout: 10_000 });
});
