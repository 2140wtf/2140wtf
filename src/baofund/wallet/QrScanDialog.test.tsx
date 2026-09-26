import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QrScanDialog } from './QrScanDialog';

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
