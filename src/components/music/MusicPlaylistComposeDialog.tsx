/**
 * Create / edit a music playlist or album (kind 34139).
 *
 * Playlists/albums are ordered lists of `a` references to kind 36787 tracks.
 * Albums are a playlist with a `t=album` tag (+ optional `released`/`label`).
 * Editing re-publishes the same `d` (with `prev`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListMusic, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { parseMusicPlaylist, parseMusicTrack } from '@/lib/musicHelpers';
import { cn } from '@/lib/utils';

const PLAYLIST_KIND = 34139;
const TRACK_KIND = 36787;

interface TrackEntry {
  /** `36787:<pubkey>:<d>` reference. */
  ref: string;
  title: string;
  artist: string;
}

interface MusicPlaylistComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing playlist/album to edit. Omit to create. */
  playlist?: NostrEvent | null;
  onSuccess?: () => void;
}

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || 'playlist';
}

export function MusicPlaylistComposeDialog({ open, onOpenChange, playlist, onSuccess }: MusicPlaylistComposeDialogProps) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const coverInputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (playlist ? parseMusicPlaylist(playlist) : null), [playlist]);
  const isEdit = !!playlist;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [isAlbum, setIsAlbum] = useState(false);
  const [released, setReleased] = useState('');
  const [label, setLabel] = useState('');
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // The signed-in user's own tracks — the pool we pick playlist entries from.
  const { data: myTracks = [] } = useQuery<NostrEvent[]>({
    queryKey: ['music', 'my-tracks', user?.pubkey ?? ''],
    enabled: open && !!user,
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query([{ kinds: [TRACK_KIND], authors: [user.pubkey], limit: 300 }], { signal });
      return events.filter((e) => parseMusicTrack(e) !== null);
    },
  });

  const trackByRef = useMemo(() => {
    const map = new Map<string, { title: string; artist: string }>();
    for (const e of myTracks) {
      const p = parseMusicTrack(e);
      const d = e.tags.find(([n]) => n === 'd')?.[1] ?? '';
      if (p) map.set(`${TRACK_KIND}:${e.pubkey}:${d}`, { title: p.title, artist: p.artist });
    }
    return map;
  }, [myTracks]);

  useEffect(() => {
    if (!open) return;
    if (parsed && playlist) {
      setTitle(parsed.title);
      setDescription(parsed.description);
      setCoverUrl(parsed.artwork ?? '');
      setIsAlbum(parsed.isAlbum);
      setReleased(parsed.released ?? '');
      setLabel(parsed.label ?? '');
      setTracks(parsed.trackRefs.map((ref) => {
        const known = trackByRef.get(ref);
        const d = ref.split(':')[2] ?? ref;
        return { ref, title: known?.title ?? d, artist: known?.artist ?? '' };
      }));
    } else {
      setTitle(''); setDescription(''); setCoverUrl(''); setIsAlbum(false);
      setReleased(''); setLabel(''); setTracks([]);
    }
  // trackByRef intentionally omitted: only seed once on open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parsed, playlist]);

  const handleCoverFile = useCallback(async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    try {
      const tags = await uploadFile(file);
      const url = tags.find(([k]) => k === 'url')?.[1];
      if (url) setCoverUrl(url);
    } catch {
      toast({ title: 'Upload failed', description: file.name, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [uploadFile, toast]);

  const addTrack = useCallback((e: NostrEvent) => {
    const d = e.tags.find(([n]) => n === 'd')?.[1] ?? '';
    const ref = `${TRACK_KIND}:${e.pubkey}:${d}`;
    const p = parseMusicTrack(e);
    setTracks((prev) => prev.some((t) => t.ref === ref) ? prev : [...prev, { ref, title: p?.title ?? d, artist: p?.artist ?? '' }]);
  }, []);

  const move = useCallback((index: number, dir: -1 | 1) => {
    setTracks((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const canPublish = !!user && title.trim().length > 0 && tracks.length > 0 && !busy && !isUploading && !isPublishing;

  const handleSubmit = async () => {
    if (!canPublish || !user) return;
    const d = playlist?.tags.find(([n]) => n === 'd')?.[1] ?? `${slugify(title)}-${Math.random().toString(36).slice(2, 8)}`;
    const cover = sanitizeUrl(coverUrl);

    const tags: string[][] = [
      ['d', d],
      ['title', title.trim()],
      ['t', 'music'],
    ];
    if (isAlbum) tags.push(['t', 'album']);
    if (cover) tags.push(['image', cover]);
    if (isAlbum && released.trim()) tags.push(['released', released.trim()]);
    if (isAlbum && label.trim()) tags.push(['label', label.trim()]);
    for (const t of tracks) tags.push(['a', t.ref]);
    tags.push(['alt', `${isAlbum ? 'Album' : 'Playlist'}: ${title.trim()}`]);

    try {
      await publishEvent({
        kind: PLAYLIST_KIND,
        content: description.trim(),
        tags,
        ...(playlist ? { prev: playlist } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['music'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      toast({ title: isEdit ? 'Playlist updated' : 'Playlist published' });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to publish playlist.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-0 gap-0 border-border [&>button]:hidden">
        <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-border/50">
          <DialogTitle className="text-base font-semibold">{isEdit ? 'Edit' : 'New'} {isAlbum ? 'album' : 'playlist'}</DialogTitle>
          <button onClick={() => onOpenChange(false)} className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsAlbum(false)}
              className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors', !isAlbum ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40')}
            >
              Playlist
            </button>
            <button
              type="button"
              onClick={() => setIsAlbum(true)}
              className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors', isAlbum ? 'bg-primary/10 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40')}
            >
              Album
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-title">Title</Label>
            <Input id="mp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isAlbum ? 'Album title' : 'Playlist title'} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-desc">Description</Label>
            <Textarea id="mp-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1.5">
            <Label>Cover art</Label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => coverInputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 transition-colors disabled:opacity-50">
                <Upload className="size-4" /> Upload
              </button>
              {coverUrl && <img src={sanitizeUrl(coverUrl)} alt="" className="size-10 rounded object-cover" />}
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleCoverFile(e.target.files?.[0]); e.target.value = ''; }} />
            <Input placeholder="https://…/cover.jpg" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
          </div>

          {isAlbum && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mp-released">Released</Label>
                <Input id="mp-released" type="date" value={released} onChange={(e) => setReleased(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mp-label">Label</Label>
                <Input id="mp-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Record label" />
              </div>
            </div>
          )}

          {/* Track list */}
          <div className="space-y-2">
            <Label>Tracks ({tracks.length})</Label>
            {tracks.length > 0 && (
              <ul className="space-y-1">
                {tracks.map((t, i) => (
                  <li key={t.ref} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                    <span className="text-xs text-muted-foreground tabular-nums w-5 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{t.title}</p>
                      {t.artist && <p className="text-[11px] text-muted-foreground truncate">{t.artist}</p>}
                    </div>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === tracks.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                    <button type="button" onClick={() => setTracks((prev) => prev.filter((_, j) => j !== i))} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}

            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                <Plus className="inline size-3.5 mr-1" />Add from your tracks
              </summary>
              <div className="max-h-48 overflow-y-auto border-t border-border">
                {myTracks.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">You haven't uploaded any tracks yet.</p>
                ) : myTracks.map((e) => {
                  const p = parseMusicTrack(e);
                  const d = e.tags.find(([n]) => n === 'd')?.[1] ?? '';
                  const ref = `${TRACK_KIND}:${e.pubkey}:${d}`;
                  const added = tracks.some((t) => t.ref === ref);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => addTrack(e)}
                      disabled={added}
                      className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-secondary/40 transition-colors', added && 'opacity-40')}
                    >
                      {p?.artwork
                        ? <img src={sanitizeUrl(p.artwork)} alt="" className="size-8 rounded object-cover shrink-0" />
                        : <div className="size-8 rounded bg-muted shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{p?.title ?? d}</p>
                        {p?.artist && <p className="text-[11px] text-muted-foreground truncate">{p.artist}</p>}
                      </div>
                      {added && <span className="text-[11px] text-muted-foreground">added</span>}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canPublish}>
              {isPublishing ? <Loader2 className="size-4 animate-spin" /> : <ListMusic className="size-4" />}
              {isEdit ? 'Save' : 'Publish'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
