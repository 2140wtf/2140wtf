import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: { autoplayVideos: false, blossomServerMetadata: { servers: [] }, useAppBlossomServers: false },
  }),
}));
vi.mock('@/hooks/useBlossomFallback', () => ({
  useBlossomFallback: (url: string) => ({ src: url, onError: () => false, failed: false, candidates: [url] }),
}));
vi.mock('@/hooks/useHls', () => ({ useHls: () => ({ isHls: false }) }));
vi.mock('@/hooks/useVideoThumbnail', () => ({ useVideoThumbnail: () => undefined }));
vi.mock('@/hooks/usePlayerControls', () => ({
  usePlayerControls: () => ({
    showControls: true,
    revealControls: () => {},
    scheduleHide: () => {},
    isMuted: false,
    volume: 1,
    toggleMute: () => {},
    handleVolumeChange: () => {},
  }),
}));
vi.mock('@/contexts/audioPlayerContextDef', () => ({
  useAudioPlayer: () => ({ playVideoTrack: vi.fn() }),
}));
vi.mock('@/components/TimedCommentLayer', () => ({ TimedCommentLayer: () => null }));
vi.mock('@/lib/sanitizeUrl', () => ({
  sanitizeUrl: (url: string | undefined) => url,
}));

import { VideoPlayer } from './VideoPlayer';

// Regression: compose Preview (and any poster-less remote video) rendered a
// black box with no play control until a frame decoded.
// Found by /qa on 2026-10-28
// Report: compose Preview uploaded video not visible / not playable before posting

describe('VideoPlayer', () => {
  it('shows a play control before the video has decoded a frame', () => {
    render(<VideoPlayer src="https://cdn.example/clip.mp4" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});
