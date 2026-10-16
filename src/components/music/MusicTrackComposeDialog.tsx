/**
 * Create / edit a music track (kind 36787).
 *
 * Music publishing lives in dedicated apps (Nostr), so 2140.wtf had no
 * composer/editor for tracks. This dialog adds both:
 *  - **Create**: upload an audio file to Blossom (or paste a hosted URL) and
 *    publish a kind 36787 track.
 *  - **Edit**: re-publish an existing track (same `d`) to fix/replace its
 *    metadata or audio URL — e.g. swap in a live mirror when the original blob
 *    has been evicted.
 *
 * Either way the signed-in user's own key signs the event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Music, Upload, X } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';
import { parseMusicTrack } from '@/lib/musicHelpers';

const MUSIC_TRACK_KIND = 36787;

interface MusicTrackComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing track to edit. Omit to create a new one. */
  track?: NostrEvent | null;
  onSuccess?: () => void;
}

/** Slugify a title into a stable d-tag fragment. */
function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || 'track';
}

/** Infer an audio MIME type from a URL or filename extension. */
function audioMimeFromName(name: string): string {
  const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'm4a': case 'mp4': case 'aac': return 'audio/mp4';
    case 'wav': return 'audio/wav';
    case 'ogg': case 'oga': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    case 'opus': return 'audio/opus';
    default: return 'audio/mpeg';
  }
}

/** The file extension (without dot) from a name/URL, defaulting to mp3. */
function formatFromName(name: string): string {
  const ext = name.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return ext && ext.length <= 5 ? ext : 'mp3';
}

export function MusicTrackComposeDialog({ open, onOpenChange, track, onSuccess }: MusicTrackComposeDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (track ? parseMusicTrack(track) : null), [track]);
  const isEdit = !!track;

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [genres, setGenres] = useState('');
  const [description, setDescription] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [audioName, setAudioName] = useState('');
  const [audioSize, setAudioSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<string>('');
  const [coverUrl, setCoverUrl] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [syncedLyrics, setSyncedLyrics] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed the form when opening (edit) or clear it (create).
  useEffect(() => {
    if (!open) return;
    if (parsed) {
      setTitle(parsed.title ?? '');
      setArtist(parsed.artist ?? '');
      setAlbum(parsed.album ?? '');
      const genreTags = (track?.tags ?? [])
        .filter(([n, v]) => n === 't' && v !== 'music' && v !== 'album')
        .map(([, v]) => v);
      setGenres([...new Set(genreTags)].join(', '));
      setDescription(track?.content ?? '');
      setAudioUrl(parsed.url ?? '');
      setAudioName(parsed.url ?? '');
      setDuration(parsed.duration ? String(Math.round(parsed.duration)) : '');
      setCoverUrl(parsed.artwork ?? '');
      setLyrics(track?.tags.find(([n]) => n === 'lyrics')?.[1] ?? '');
      setSyncedLyrics(track?.tags.find(([n]) => n === 'synced_lyrics')?.[1] ?? '');
      setAudioSize(track?.tags.find(([n]) => n === 'size')?.[1] ? Number(track.tags.find(([n]) => n === 'size')![1]) : null);
    } else {
      setTitle(''); setArtist(''); setAlbum(''); setGenres(''); setDescription('');
      setAudioUrl(''); setAudioName(''); setDuration(''); setCoverUrl(''); setAudioSize(null);
      setLyrics(''); setSyncedLyrics('');
    }
  }, [open, parsed, track]);

  // Auto-detect duration from the audio source (uploaded file object URL or a
  // pasted remote URL) when the user hasn't typed one.
  useEffect(() => {
    if (!audioUrl) return;
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.src = audioUrl;
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration((prev) => (prev ? prev : String(Math.round(el.duration))));
      }
    };
    el.addEventListener('loadedmetadata', onMeta);
    return () => { el.removeEventListener('loadedmetadata', onMeta); el.src = ''; };
  }, [audioUrl]);

  const handleAudioFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      toast({ title: 'Not an audio file', description: file.name, variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const tags = await uploadFile(file);
      const url = tags.find(([k]) => k === 'url')?.[1];
      if (!url) throw new Error('no url');
      setAudioUrl(url);
      setAudioName(file.name);
      setAudioSize(file.size);
    } catch {
      toast({ title: 'Upload failed', description: `Could not upload ${file.name}.`, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [uploadFile, toast]);

  const handleCoverFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Not an image', description: file.name, variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const tags = await uploadFile(file);
      const url = tags.find(([k]) => k === 'url')?.[1];
      if (url) setCoverUrl(url);
    } catch {
      toast({ title: 'Upload failed', description: `Could not upload ${file.name}.`, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [uploadFile, toast]);

  const safeUrl = sanitizeUrl(audioUrl) ?? '';
  const canPublish = !!user && title.trim().length > 0 && !!safeUrl && !busy && !isUploading && !isPublishing;

  const handleSubmit = async () => {
    if (!canPublish || !user) return;

    const d = track?.tags.find(([n]) => n === 'd')?.[1] ?? `${slugify(title)}-${Math.random().toString(36).slice(2, 8)}`;
    const mime = audioName ? audioMimeFromName(audioName) : audioMimeFromName(safeUrl);
    const format = formatFromName(audioName || safeUrl);
    const genreList = genres.split(/[,\s]+/).map((g) => g.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);

    const tags: string[][] = [
      ['d', d],
      ['title', title.trim()],
      ['url', safeUrl],
      ['m', mime],
      ['format', format],
      ['t', 'music'],
    ];
    if (artist.trim()) tags.push(['artist', artist.trim()]);
    if (album.trim()) tags.push(['album', album.trim()]);
    const cover = sanitizeUrl(coverUrl);
    if (cover) tags.push(['image', cover]);
    const dur = Number.parseInt(duration, 10);
    if (Number.isFinite(dur) && dur > 0) tags.push(['duration', String(dur)]);
    if (audioSize && audioSize > 0) tags.push(['size', String(audioSize)]);
    if (lyrics.trim()) tags.push(['lyrics', lyrics.trim()]);
    if (syncedLyrics.trim()) tags.push(['synced_lyrics', syncedLyrics.trim()]);
    for (const g of new Set(genreList)) tags.push(['t', g]);
    tags.push(['alt', `Song: ${title.trim()}${artist.trim() ? ` - ${artist.trim()}` : ''}`]);

    try {
      await publishEvent({
        kind: MUSIC_TRACK_KIND,
        content: description.trim(),
        tags,
        ...(track ? { prev: track } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['event'] });
      queryClient.invalidateQueries({ queryKey: ['featured-music'] });
      toast({ title: isEdit ? 'Track updated' : 'Track published' });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to publish track.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-0 gap-0 border-border [&>button]:hidden">
        <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-border/50">
          <DialogTitle className="text-base font-semibold">{isEdit ? 'Edit track' : 'Upload track'}</DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Audio */}
          <div className="space-y-1.5">
            <Label>Audio</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                Upload file
              </button>
              <span className="text-xs text-muted-foreground truncate min-w-0">{audioName || 'or paste a URL below'}</span>
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,video/mp4,video/webm"
              className="hidden"
              onChange={(e) => { void handleAudioFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <Input
              placeholder="https://…/track.mp3 (hosted audio URL)"
              value={audioUrl}
              onChange={(e) => { setAudioUrl(e.target.value); setAudioSize(null); setAudioName(e.target.value); }}
            />
            <p className="text-[11px] text-muted-foreground">
              Files over 100 MB can't be uploaded here — host them elsewhere and paste the URL.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-title">Title</Label>
            <Input id="mt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track title" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mt-artist">Artist</Label>
              <Input id="mt-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-album">Album</Label>
              <Input id="mt-album" value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Album / mixtape" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mt-duration">Duration (sec)</Label>
              <Input id="mt-duration" type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="185" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-genres">Genres</Label>
              <Input id="mt-genres" value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="jungle, electronic" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Cover art</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                <Upload className="size-4" /> Upload
              </button>
              {coverUrl && (
                <img src={sanitizeUrl(coverUrl)} alt="" className="size-10 rounded object-cover" />
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { void handleCoverFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <Input placeholder="https://…/cover.jpg" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-lyrics">Lyrics</Label>
            <Textarea id="mt-lyrics" value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} placeholder="Plain lyrics…" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-synced">Synced lyrics (LRC, optional)</Label>
            <Textarea
              id="mt-synced"
              value={syncedLyrics}
              onChange={(e) => setSyncedLyrics(e.target.value)}
              rows={4}
              placeholder={'[00:12.00] first line\n[00:18.50] next line'}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Timed lines highlight in sync on the track page.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-desc">Description</Label>
            <Textarea id="mt-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Liner notes, credits, lyrics…" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canPublish} className={cn(!canPublish && 'opacity-60')}>
              {isPublishing ? <Loader2 className="size-4 animate-spin" /> : <Music className="size-4" />}
              {isEdit ? 'Save' : 'Publish'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
