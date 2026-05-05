"use client";

import { useNowPlaying } from "@/components/PlayerProvider";
import YouTubePlayer, { VIDEO_ID_RE } from "@/components/YouTubePlayer";

export function PlayerBar() {
  const { song, stop } = useNowPlaying();

  if (!song) return null;

  const playable = song.youtubeId !== null && VIDEO_ID_RE.test(song.youtubeId);

  return (
    <div className="border-b border-border bg-surface px-3 py-2 sm:px-4 sm:py-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium sm:text-base">
              {song.title}
            </div>
            <div className="truncate text-xs text-muted sm:text-sm">
              {song.artist}
            </div>
          </div>
          <button
            type="button"
            onClick={stop}
            aria-label="Close player"
            className="shrink-0 rounded border border-border px-2 py-1 text-sm leading-none text-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
        {playable ? (
          <div className="flex justify-center">
            <YouTubePlayer videoId={song.youtubeId} width={320} height={180} />
          </div>
        ) : (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted">
            Auto-matching YouTube video for &ldquo;{song.title}&rdquo;…
          </div>
        )}
      </div>
    </div>
  );
}
