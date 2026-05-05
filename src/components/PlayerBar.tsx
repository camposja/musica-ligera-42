"use client";

import { useNowPlaying } from "@/components/PlayerProvider";
import YouTubePlayer, { VIDEO_ID_RE } from "@/components/YouTubePlayer";

export function PlayerBar() {
  const { song, stop } = useNowPlaying();

  if (!song) return null;

  const playable = song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId);

  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{song.title}</div>
          <div className="truncate text-sm text-muted">{song.artist}</div>
        </div>
        {playable ? (
          <YouTubePlayer videoId={song.youtubeId} width={320} height={180} />
        ) : (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted">
            Auto-matching YouTube video for &ldquo;{song.title}&rdquo;…
          </div>
        )}
        <button
          type="button"
          onClick={stop}
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}
